package googlephotos

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
	"collageomat/internal/photo"
)

const (
	// defaultPollInterval is used if Google gives no poll interval.
	defaultPollInterval = 3 * time.Second
	// minPollInterval and maxPollInterval clamp Google's poll interval.
	minPollInterval = time.Second
	maxPollInterval = 10 * time.Second
	// exchangeTimeout limits the token exchange of the OAuth callback.
	exchangeTimeout = 30 * time.Second
	// deleteTimeout limits the best-effort deletion of a Google session.
	deleteTimeout = 10 * time.Second
)

// User-safe messages of pick and import errors.
const (
	msgSigninExpired    = "Google sign-in expired. Start again."
	msgSigninTimeout    = "The Google sign-in was not finished in time. Start again."
	msgSelectionExpired = "The Google Photos selection expired. Pick the photos again."
	msgImportSignin     = "The Google sign-in expired. Pick the photos again."
	msgPickerTimeout    = "The Google Photos picker timed out. Start again."
	msgPickerExpired    = "The Google Photos picker session expired. Start again."
	msgStateInvalid     = "the sign-in link is invalid or expired"
	msgSigninCancelled  = "the sign-in was cancelled"
)

// originalTypes are the Content-Types of originals that the photo import
// can decode (see imaging). Other originals (HEIC, RAW, ...) are replaced
// by the preview.
var originalTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// Connectors loads connectors of a user (implemented by
// *connector.Service).
type Connectors interface {
	// LoadConfig returns apperr.ErrNotFound if the connector does not exist
	// or belongs to another user.
	LoadConfig(ctx context.Context, userID, id uint) (connector.Connector, json.RawMessage, error)
}

// Service contains the Google Photos use cases: the OAuth sign-in per
// import, picks (Google picker sessions and the picked photos), the
// thumbnail proxy and the import source (it implements photo.Sources).
// Its state lives in memory only (see state).
type Service struct {
	connectors Connectors
	client     *Client
	// http is used for the OAuth token exchange.
	http  *http.Client
	state *state
}

var _ photo.Sources = (*Service)(nil)

// NewService returns the Google Photos service with an empty in-memory
// state.
func NewService(connectors Connectors) *Service {
	return &Service{
		connectors: connectors,
		client:     NewClient(),
		http:       newHTTPClient(),
		state:      newState(time.Now),
	}
}

// PickStatus is the state of a pick as shown to the client.
type PickStatus struct {
	Status        string
	PollInterval  time.Duration
	Error         string
	Items         []Item
	SkippedVideos int
}

// Item is a picked photo as shown to the client.
type Item struct {
	ID       string
	FileName string
	Width    int
	Height   int
	MimeType string
}

// CreatePick starts a new pick for a connector of the user and returns its
// id and the URL that the browser opens: the Google picker page (with
// "/autoclose") if a token is cached, else the Google sign-in page.
func (s *Service) CreatePick(ctx context.Context, userID, connectorID uint) (string, string, error) {
	s.sweep()
	cfg, hash, err := s.config(ctx, userID, connectorID)
	if err != nil {
		return "", "", err
	}
	if token, ok := s.state.token(connectorID, hash); ok {
		sess, err := s.client.createSession(ctx, token)
		switch {
		case err == nil:
			pickID, _, err := s.state.addPick(userID, connectorID, &sess)
			if err != nil {
				s.deleteSession(ctx, token, sess.ID)
				return "", "", err
			}
			return pickID, autocloseURL(sess.PickerURI), nil
		case isStatus(err, http.StatusUnauthorized):
			// The token was revoked: sign in again.
			s.state.dropToken(connectorID, token)
		default:
			return "", "", upstream(err)
		}
	}
	pickID, oauthState, err := s.state.addPick(userID, connectorID, nil)
	if err != nil {
		return "", "", err
	}
	return pickID, OAuthConfig(cfg).AuthCodeURL(oauthState), nil
}

// Callback handles the OAuth redirect of a sign-in of the user: it checks
// and consumes the state, exchanges the code, caches the token, creates
// the picker session and returns the URL of the picker page. oauthError is
// Google's "error" parameter ("" on success).
//
// Errors are apperr validation or upstream errors with a user-safe
// message; the pick of a valid state is then set to status error.
func (s *Service) Callback(ctx context.Context, userID uint, oauthState, code, oauthError string) (string, error) {
	s.sweep()
	st, ok := s.state.consumeState(oauthState, userID)
	if !ok {
		return "", apperr.Validation(msgStateInvalid)
	}
	url, err := s.finishSignin(ctx, st, code, oauthError)
	if err != nil {
		reason, _ := signinFailureReason(err)
		s.state.failPick(st.pickID, "Sign-in failed: "+reason+".")
		return "", err
	}
	return url, nil
}

// finishSignin is Callback after the state check.
func (s *Service) finishSignin(ctx context.Context, st pendingState, code, oauthError string) (string, error) {
	switch {
	case oauthError == "access_denied":
		return "", apperr.Validation(msgSigninCancelled)
	case oauthError != "":
		return "", apperr.Validation("Google answered %q", truncate(oauthError, 64))
	case code == "":
		return "", apperr.Validation("Google sent no authorization code")
	}
	cfg, hash, err := s.config(ctx, st.userID, st.connectorID)
	if err != nil {
		if errors.Is(err, apperr.ErrNotFound) {
			return "", apperr.Validation("the connector does not exist any more")
		}
		return "", err
	}
	token, err := s.exchange(ctx, cfg, code)
	if err != nil {
		return "", err
	}
	s.state.putToken(st.connectorID, hash, token.AccessToken, token.Expiry)

	sess, err := s.client.createSession(ctx, token.AccessToken)
	if err != nil {
		return "", upstream(err)
	}
	if !s.state.setSession(st.pickID, sess) {
		// The dialog was closed (pick deleted) during the sign-in.
		s.deleteSession(ctx, token.AccessToken, sess.ID)
		return "", apperr.Validation("the selection was closed")
	}
	return autocloseURL(sess.PickerURI), nil
}

// exchange exchanges the authorization code for a token. Errors are
// user-safe (they never contain the client secret or the code).
func (s *Service) exchange(ctx context.Context, cfg Config, code string) (*oauth2.Token, error) {
	ctx, cancel := context.WithTimeout(ctx, exchangeTimeout)
	defer cancel()
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.http)
	token, err := OAuthConfig(cfg).Exchange(ctx, code)
	if err != nil {
		var re *oauth2.RetrieveError
		if errors.As(err, &re) {
			if re.ErrorCode != "" {
				return nil, apperr.Upstream("Google refused the sign-in (%s)", truncate(re.ErrorCode, 64))
			}
			status := 0
			if re.Response != nil {
				status = re.Response.StatusCode
			}
			return nil, apperr.Upstream("Google refused the sign-in (HTTP %d)", status)
		}
		return nil, apperr.Upstream("%s", unreachableMessage(err))
	}
	if token.AccessToken == "" {
		return nil, apperr.Upstream("Google sent no access token")
	}
	return token, nil
}

// Pick returns the state of a pick. While the user picks, it asks Google
// (at most one request per pick at a time); when the user is done, it
// lists the picked photos (videos are dropped and counted).
func (s *Service) Pick(ctx context.Context, userID, connectorID uint, pickID string) (PickStatus, error) {
	s.sweep()
	_, hash, err := s.config(ctx, userID, connectorID)
	if err != nil {
		return PickStatus{}, err
	}
	sessionID, poll, err := s.state.beginPoll(userID, connectorID, pickID)
	if err != nil {
		return PickStatus{}, err
	}
	if poll {
		s.poll(ctx, connectorID, hash, pickID, sessionID)
		s.state.endPoll(pickID)
	}
	v, err := s.state.view(userID, connectorID, pickID)
	if err != nil {
		return PickStatus{}, err
	}
	return toPickStatus(v), nil
}

// poll asks Google for the state of the picker session of a pick in status
// picking and updates the pick. Transient Google failures keep the status
// (the client polls again); other failures set the status error.
func (s *Service) poll(ctx context.Context, connectorID uint, hash configHash, pickID, sessionID string) {
	token, ok := s.state.token(connectorID, hash)
	if !ok {
		s.state.failPick(pickID, msgSigninExpired)
		return
	}
	sess, err := s.client.getSession(ctx, token, sessionID)
	if err != nil {
		s.pollFailed(pickID, err)
		return
	}
	if !sess.MediaItemsSet {
		interval := pollInterval(sess.PollingConfig)
		if sessionTimedOut(sess, time.Now()) {
			s.state.failPick(pickID, msgPickerTimeout)
			return
		}
		s.state.update(pickID, func(p *pick) { p.pollInterval = interval })
		return
	}
	picked, err := s.client.listMediaItems(ctx, token, sessionID)
	if err != nil {
		s.pollFailed(pickID, err)
		return
	}
	items := make([]mediaItem, 0, len(picked))
	skipped := 0
	for _, m := range picked {
		if m.Type != mediaItemTypePhoto || m.ID == "" {
			skipped++
			continue
		}
		items = append(items, mediaItem{
			ID:       m.ID,
			FileName: m.MediaFile.Filename,
			Width:    m.MediaFile.MediaFileMetadata.Width,
			Height:   m.MediaFile.MediaFileMetadata.Height,
			MimeType: m.MediaFile.MimeType,
			BaseURL:  m.MediaFile.BaseURL,
		})
	}
	s.state.setItems(pickID, items, skipped)
}

// pollFailed handles a failed Google request of poll.
func (s *Service) pollFailed(pickID string, err error) {
	switch {
	case isStatus(err, http.StatusUnauthorized):
		s.state.failPick(pickID, msgSigninExpired)
	case isStatus(err, http.StatusNotFound):
		s.state.failPick(pickID, msgPickerExpired)
	case isTransient(err):
		slog.Warn("googlephotos: poll picker session", "err", err)
	default:
		s.state.failPick(pickID, err.Error())
	}
}

// DeletePick removes a pick of the user and deletes its Google picker
// session (best effort, if a token is cached).
func (s *Service) DeletePick(ctx context.Context, userID, connectorID uint, pickID string) error {
	s.sweep()
	_, hash, err := s.config(ctx, userID, connectorID)
	if err != nil {
		return err
	}
	sessionID, err := s.state.removePick(userID, connectorID, pickID)
	if err != nil {
		return err
	}
	if token, ok := s.state.token(connectorID, hash); ok && sessionID != "" {
		s.deleteSession(ctx, token, sessionID)
	}
	return nil
}

// Thumbnail returns the grid thumbnail (fits in 400×400 px) of a photo of
// a pick and its Content-Type. The caller must close the reader. A response
// that is not an image is rejected, so that the proxy never serves other
// content from the app's origin.
func (s *Service) Thumbnail(ctx context.Context, userID, connectorID uint, pickID, itemID string) (io.ReadCloser, string, error) {
	_, hash, err := s.config(ctx, userID, connectorID)
	if err != nil {
		return nil, "", err
	}
	item, err := s.state.pickItem(userID, connectorID, pickID, itemID)
	if err != nil {
		return nil, "", err
	}
	token, ok := s.state.token(connectorID, hash)
	if !ok {
		return nil, "", apperr.Validation(msgImportSignin)
	}
	body, contentType, err := s.client.download(ctx, token, item.BaseURL, sizeThumbnail)
	if err != nil {
		return nil, "", upstream(err)
	}
	if !isImage(contentType) {
		body.Close()
		return nil, "", apperr.Upstream("Google Photos returned no image (Content-Type %q)", contentType)
	}
	return body, contentType, nil
}

// Source implements photo.Sources: the picked photos of the connector (in
// the done picks of the user that are not expired).
func (s *Service) Source(ctx context.Context, userID, connectorID uint) (photo.Source, error) {
	s.sweep()
	_, hash, err := s.config(ctx, userID, connectorID)
	if err != nil {
		return nil, err
	}
	return imageSource{svc: s, userID: userID, connectorID: connectorID, hash: hash}, nil
}

// config loads a connector of the user and its config. A connector of
// another type gives a validation error.
func (s *Service) config(ctx context.Context, userID, connectorID uint) (Config, configHash, error) {
	c, stored, err := s.connectors.LoadConfig(ctx, userID, connectorID)
	if err != nil {
		return Config{}, configHash{}, err
	}
	if c.Type != Type {
		return Config{}, configHash{}, apperr.Validation("connector %d is not a Google Photos connector", connectorID)
	}
	cfg, err := ParseConfig(stored)
	if err != nil {
		return Config{}, configHash{}, err
	}
	return cfg, hashConfig(stored), nil
}

// sweep removes expired state and deletes the Google sessions of expired
// picks in the background (best effort).
func (s *Service) sweep() {
	stale := s.state.sweep()
	if len(stale) == 0 {
		return
	}
	go func() {
		for _, st := range stale {
			s.deleteSession(context.Background(), st.token, st.sessionID)
		}
	}()
}

// deleteSession deletes a Google picker session (best effort; failures are
// logged without the token).
func (s *Service) deleteSession(ctx context.Context, token, sessionID string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), deleteTimeout)
	defer cancel()
	if err := s.client.deleteSession(ctx, token, sessionID); err != nil {
		slog.Warn("googlephotos: delete picker session", "err", err)
	}
}

// imageSource implements photo.Source for the picked photos of one
// connector of a user: photo.SizePreview is "=w2048-h2048",
// photo.SizeOriginal is "=d" (with the preview as fallback for formats the
// import cannot decode).
type imageSource struct {
	svc         *Service
	userID      uint
	connectorID uint
	hash        configHash
}

// Image implements photo.Source. assetID is the media item id. A photo that
// is in no open pick, or a sign-in that expired, gives a validation error
// that asks the user to pick the photos again.
func (p imageSource) Image(ctx context.Context, assetID string, size photo.ImageSize) (photo.SourceImage, error) {
	item, ok := p.svc.state.item(p.userID, p.connectorID, assetID)
	if !ok {
		return photo.SourceImage{}, apperr.Validation(msgSelectionExpired)
	}
	token, ok := p.svc.state.token(p.connectorID, p.hash)
	if !ok {
		return photo.SourceImage{}, apperr.Validation(msgImportSignin)
	}
	if size != photo.SizeOriginal {
		return p.download(ctx, token, item, sizePreview)
	}
	if mediaType, _, _ := mime.ParseMediaType(item.MimeType); originalTypes[mediaType] {
		img, err := p.download(ctx, token, item, sizeOriginal)
		if err != nil {
			return photo.SourceImage{}, err
		}
		if mediaType, _, _ := mime.ParseMediaType(img.ContentType); originalTypes[mediaType] {
			return img, nil
		}
		img.Body.Close()
	}
	img, err := p.download(ctx, token, item, sizePreview)
	img.Fallback = true
	return img, err
}

// download downloads a media item in a size and checks that the answer is
// an image.
func (p imageSource) download(ctx context.Context, token string, item mediaItem, size string) (photo.SourceImage, error) {
	body, contentType, err := p.svc.client.download(ctx, token, item.BaseURL, size)
	if err != nil {
		if isStatus(err, http.StatusUnauthorized) {
			return photo.SourceImage{}, apperr.Validation(msgImportSignin)
		}
		return photo.SourceImage{}, upstream(err)
	}
	if !isImage(contentType) {
		body.Close()
		return photo.SourceImage{}, apperr.Upstream("Google Photos returned no image (Content-Type %q)", contentType)
	}
	return photo.SourceImage{Body: body, ContentType: contentType}, nil
}

// toPickStatus converts a pick view to the client DTO. Items are shown
// only in status done.
func toPickStatus(v pickView) PickStatus {
	ps := PickStatus{
		Status:        string(v.Status),
		PollInterval:  v.PollInterval,
		Error:         v.Error,
		Items:         []Item{},
		SkippedVideos: v.SkippedVideos,
	}
	if v.Status == statusDone {
		ps.Items = make([]Item, len(v.Items))
		for i, it := range v.Items {
			ps.Items[i] = Item{ID: it.ID, FileName: it.FileName, Width: it.Width, Height: it.Height, MimeType: it.MimeType}
		}
	}
	return ps
}

// pollInterval returns Google's poll interval (a duration like "3.5s"),
// clamped to minPollInterval..maxPollInterval; defaultPollInterval if it
// is missing or invalid.
func pollInterval(pc *pollingConfig) time.Duration {
	if pc == nil || pc.PollInterval == "" {
		return defaultPollInterval
	}
	d, err := time.ParseDuration(pc.PollInterval)
	if err != nil {
		return defaultPollInterval
	}
	return min(max(d, minPollInterval), maxPollInterval)
}

// sessionTimedOut reports whether Google stopped waiting for the user's
// pick: pollingConfig.timeoutIn is zero, or the session's expireTime has
// passed.
func sessionTimedOut(sess pickingSession, now time.Time) bool {
	if sess.PollingConfig != nil && sess.PollingConfig.TimeoutIn != "" {
		if d, err := time.ParseDuration(sess.PollingConfig.TimeoutIn); err == nil && d <= 0 {
			return true
		}
	}
	if sess.ExpireTime != "" {
		if t, err := time.Parse(time.RFC3339Nano, sess.ExpireTime); err == nil && !now.Before(t) {
			return true
		}
	}
	return false
}

// autocloseURL returns the picker URL that closes the window after "Done".
func autocloseURL(pickerURI string) string {
	return strings.TrimRight(pickerURI, "/") + "/autoclose"
}

// isImage reports whether contentType is an image type.
func isImage(contentType string) bool {
	mediaType, _, _ := mime.ParseMediaType(contentType)
	return strings.HasPrefix(mediaType, "image/")
}

// signinFailureReason returns the user-safe reason of a Callback error
// (without a final period). known is false for an unexpected error (not an
// apperr validation or upstream error); its reason is generic.
func signinFailureReason(err error) (reason string, known bool) {
	if v, ok := apperr.AsValidation(err); ok {
		return strings.TrimRight(v.Message, "."), true
	}
	if u, ok := apperr.AsUpstream(err); ok {
		return strings.TrimRight(u.Error(), "."), true
	}
	return "internal error", false
}

// truncate shortens s to at most n bytes (for values from the query
// string that end up in messages).
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// upstream marks an error of the client as an upstream error. The client's
// messages are safe to show (they never contain the token).
func upstream(err error) error {
	return apperr.Upstream("%w", err)
}
