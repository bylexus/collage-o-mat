package googlephotos

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"sync"
	"time"

	"collageomat/internal/apperr"
)

const (
	// tokenTTL is the longest time an access token is cached after the
	// sign-in (decision log: 30 min).
	tokenTTL = 30 * time.Minute
	// tokenExpiryMargin is subtracted from the token's own expiry.
	tokenExpiryMargin = time.Minute
	// stateTTL is the lifetime of a pending OAuth state.
	stateTTL = 10 * time.Minute
	// pickTTL is the lifetime of a pick before its items are listed (a
	// Google picker session lives about one hour).
	pickTTL = time.Hour
	// pickItemsTTL is the lifetime of a pick after its items are listed:
	// the baseUrls of the items are valid for 60 minutes.
	pickItemsTTL = 55 * time.Minute
	// maxPicksPerUser limits the open picks of one user.
	maxPicksPerUser = 20
)

// pickStatus is the state of a pick.
type pickStatus string

// Pick states.
const (
	// statusSignin: waiting for the OAuth callback.
	statusSignin pickStatus = "signin"
	// statusPicking: the Google picker session exists; the user picks.
	statusPicking pickStatus = "picking"
	// statusDone: the items are listed.
	statusDone pickStatus = "done"
	// statusError: the pick failed (errMsg says why).
	statusError pickStatus = "error"
)

// configHash identifies a stored connector config. A cached token is only
// used for the config it was obtained with.
type configHash [sha256.Size]byte

// hashConfig returns the hash of a stored (decrypted) connector config.
func hashConfig(stored json.RawMessage) configHash {
	return sha256.Sum256(stored)
}

// cachedToken is a cached access token of a connector.
type cachedToken struct {
	config     configHash
	token      string
	validUntil time.Time
}

// pendingState is an OAuth state that waits for the callback.
type pendingState struct {
	userID      uint
	connectorID uint
	pickID      string
	expires     time.Time
}

// mediaItem is a picked photo.
type mediaItem struct {
	ID       string
	FileName string
	Width    int
	Height   int
	MimeType string
	// BaseURL needs the access token and a size suffix.
	BaseURL string
}

// pick is one selection round: one Google picker session and its items.
// All fields are guarded by state.mu.
type pick struct {
	id              string
	userID          uint
	connectorID     uint
	googleSessionID string
	pickerURI       string
	status          pickStatus
	errMsg          string
	pollInterval    time.Duration
	items           []mediaItem
	skippedVideos   int
	// listedAt is the time the items were listed (zero before).
	listedAt time.Time
	expires  time.Time
	// polling is true while a Google poll for this pick runs.
	polling bool
}

// pickView is a copy of the public data of a pick.
type pickView struct {
	Status        pickStatus
	Error         string
	PollInterval  time.Duration
	Items         []mediaItem
	SkippedVideos int
}

func (p *pick) view() pickView {
	return pickView{
		Status:        p.status,
		Error:         p.errMsg,
		PollInterval:  p.pollInterval,
		Items:         p.items, // never changed after done; safe to share
		SkippedVideos: p.skippedVideos,
	}
}

// staleSession is the Google session of an expired pick that should be
// deleted at Google (best effort).
type staleSession struct {
	sessionID string
	token     string
}

// state is the in-memory state of the Google Photos connector: cached
// access tokens, pending OAuth states and picks. It is lost on restart.
// Expired entries are removed lazily (sweep, and every lookup ignores
// expired entries). It is safe for concurrent use.
type state struct {
	mu     sync.Mutex
	now    func() time.Time
	tokens map[uint]cachedToken    // connector id → token
	states map[string]pendingState // OAuth state → pending sign-in
	picks  map[string]*pick        // pick id → pick
}

// newState returns an empty state. now is the clock (time.Now in
// production).
func newState(now func() time.Time) *state {
	return &state{
		now:    now,
		tokens: make(map[uint]cachedToken),
		states: make(map[string]pendingState),
		picks:  make(map[string]*pick),
	}
}

// randomID returns a random base64url string of n bytes.
func randomID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b) // never fails (crypto/rand)
	return base64.RawURLEncoding.EncodeToString(b)
}

// putToken caches the access token of a connector for the config hash.
// It is valid until min(now + tokenTTL, expiry - tokenExpiryMargin); a zero
// expiry means "unknown".
func (s *state) putToken(connectorID uint, cfg configHash, token string, expiry time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	until := s.now().Add(tokenTTL)
	if !expiry.IsZero() {
		if e := expiry.Add(-tokenExpiryMargin); e.Before(until) {
			until = e
		}
	}
	s.tokens[connectorID] = cachedToken{config: cfg, token: token, validUntil: until}
}

// token returns the cached access token of a connector if it is still valid
// and was obtained with the same config.
func (s *state) token(connectorID uint, cfg configHash) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tokens[connectorID]
	if !ok || t.config != cfg || !s.now().Before(t.validUntil) {
		return "", false
	}
	return t.token, true
}

// dropToken removes the cached token of a connector if it is token (Google
// rejected it).
func (s *state) dropToken(connectorID uint, token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tokens[connectorID]; ok && t.token == token {
		delete(s.tokens, connectorID)
	}
}

// addPick adds a new pick of the user and connector. With sess it is in
// status picking, without it in status signin; then the returned OAuth
// state (non-empty) maps to the pick for stateTTL.
func (s *state) addPick(userID, connectorID uint, sess *pickingSession) (pickID, oauthState string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	n := 0
	for _, p := range s.picks {
		if p.userID == userID && now.Before(p.expires) {
			n++
		}
	}
	if n >= maxPicksPerUser {
		return "", "", apperr.TooManyRequests("Too many open Google Photos selections. Close the import dialog and try again.")
	}
	p := &pick{
		id:           randomID(18),
		userID:       userID,
		connectorID:  connectorID,
		status:       statusSignin,
		pollInterval: defaultPollInterval,
		expires:      now.Add(pickTTL),
	}
	if sess != nil {
		p.setSession(*sess)
	} else {
		oauthState = randomID(32)
		s.states[oauthState] = pendingState{
			userID: userID, connectorID: connectorID, pickID: p.id, expires: now.Add(stateTTL),
		}
	}
	s.picks[p.id] = p
	return p.id, oauthState, nil
}

// setSession stores the Google session in the pick (status picking).
func (p *pick) setSession(sess pickingSession) {
	p.googleSessionID = sess.ID
	p.pickerURI = sess.PickerURI
	p.status = statusPicking
	p.pollInterval = pollInterval(sess.PollingConfig)
}

// consumeState removes and returns a pending OAuth state of the user. An
// unknown or expired state, or one of another user, gives ok = false (the
// state of another user is not removed).
func (s *state) consumeState(oauthState string, userID uint) (pendingState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.states[oauthState]
	if !ok || st.userID != userID {
		return pendingState{}, false
	}
	delete(s.states, oauthState)
	if !s.now().Before(st.expires) {
		return pendingState{}, false
	}
	return st, true
}

// getPick returns the pick if it exists, is not expired and belongs to the
// user and connector; else apperr.ErrNotFound. Callers hold s.mu.
func (s *state) getPickLocked(userID, connectorID uint, pickID string) (*pick, error) {
	p, ok := s.picks[pickID]
	if !ok || p.userID != userID || p.connectorID != connectorID || !s.now().Before(p.expires) {
		return nil, apperr.ErrNotFound
	}
	return p, nil
}

// view returns a copy of the public data of a pick.
func (s *state) view(userID, connectorID uint, pickID string) (pickView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.getPickLocked(userID, connectorID, pickID)
	if err != nil {
		return pickView{}, err
	}
	return p.view(), nil
}

// beginPoll marks a pick in status picking as polled and returns its Google
// session id. ok is false if the pick is not in status picking or another
// poll runs; then the caller does not poll. A successful beginPoll must be
// followed by endPoll.
func (s *state) beginPoll(userID, connectorID uint, pickID string) (sessionID string, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.getPickLocked(userID, connectorID, pickID)
	if err != nil {
		return "", false, err
	}
	if p.status != statusPicking || p.polling {
		return "", false, nil
	}
	p.polling = true
	return p.googleSessionID, true, nil
}

// endPoll ends the poll of beginPoll. The pick may be gone already.
func (s *state) endPoll(pickID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.picks[pickID]; ok {
		p.polling = false
	}
}

// update calls fn with the pick under the lock if the pick still exists.
// It reports whether the pick exists.
func (s *state) update(pickID string, fn func(p *pick)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.picks[pickID]
	if ok {
		fn(p)
	}
	return ok
}

// setSession stores the Google session in a pick in status signin. It
// returns false if the pick is gone or no longer waits for the sign-in.
func (s *state) setSession(pickID string, sess pickingSession) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.picks[pickID]
	if !ok || p.status != statusSignin {
		return false
	}
	p.setSession(sess)
	return true
}

// failPick sets a pick (not done) to status error with a user-safe message.
func (s *state) failPick(pickID, msg string) {
	s.update(pickID, func(p *pick) {
		if p.status != statusDone {
			p.status = statusError
			p.errMsg = msg
		}
	})
}

// setItems stores the listed items of a pick in status picking (status
// done) and sets its expiry to pickItemsTTL from now.
func (s *state) setItems(pickID string, items []mediaItem, skippedVideos int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.picks[pickID]
	if !ok || p.status != statusPicking {
		return
	}
	now := s.now()
	p.items = items
	p.skippedVideos = skippedVideos
	p.status = statusDone
	p.listedAt = now
	p.expires = now.Add(pickItemsTTL)
}

// removePick removes a pick of the user and connector and its pending
// OAuth states. It returns the pick's Google session id ("" if none).
func (s *state) removePick(userID, connectorID uint, pickID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.getPickLocked(userID, connectorID, pickID)
	if err != nil {
		return "", err
	}
	delete(s.picks, pickID)
	for k, st := range s.states {
		if st.pickID == pickID {
			delete(s.states, k)
		}
	}
	return p.googleSessionID, nil
}

// item returns a picked photo of the user and connector from the done,
// unexpired picks. If several picks have it, the latest listed one wins.
func (s *state) item(userID, connectorID uint, itemID string) (mediaItem, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	var (
		found  mediaItem
		ok     bool
		latest time.Time
	)
	for _, p := range s.picks {
		if p.userID != userID || p.connectorID != connectorID || p.status != statusDone || !now.Before(p.expires) {
			continue
		}
		if ok && !p.listedAt.After(latest) {
			continue
		}
		for _, it := range p.items {
			if it.ID == itemID {
				found, ok, latest = it, true, p.listedAt
				break
			}
		}
	}
	return found, ok
}

// pickItem returns a photo of one pick of the user and connector.
func (s *state) pickItem(userID, connectorID uint, pickID, itemID string) (mediaItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.getPickLocked(userID, connectorID, pickID)
	if err != nil {
		return mediaItem{}, err
	}
	for _, it := range p.items {
		if it.ID == itemID {
			return it, nil
		}
	}
	return mediaItem{}, apperr.ErrNotFound
}

// sweep removes expired tokens, states and picks. A pick whose OAuth state
// expired before the callback gets status error. For expired picks with a
// Google session and a still cached token of their connector, it returns
// the sessions so that the caller can delete them at Google.
func (s *state) sweep() []staleSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	var stale []staleSession
	for id, p := range s.picks {
		if now.Before(p.expires) {
			continue
		}
		delete(s.picks, id)
		if t, ok := s.tokens[p.connectorID]; ok && p.googleSessionID != "" && now.Before(t.validUntil) {
			stale = append(stale, staleSession{sessionID: p.googleSessionID, token: t.token})
		}
	}
	for k, st := range s.states {
		if now.Before(st.expires) {
			continue
		}
		delete(s.states, k)
		// The user did not finish the sign-in in time.
		if p, ok := s.picks[st.pickID]; ok && p.status == statusSignin {
			p.status = statusError
			p.errMsg = msgSigninTimeout
		}
	}
	for id, t := range s.tokens {
		if !now.Before(t.validUntil) {
			delete(s.tokens, id)
		}
	}
	return stale
}
