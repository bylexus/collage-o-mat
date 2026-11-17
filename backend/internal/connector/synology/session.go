package synology

import (
	"context"
	"sync"
	"time"
)

// loginCooldown is the time after a failed login in which a session does
// not log in again but returns the error of the failed login. It limits
// failed logins to about one per minute and connector (DSM auto-block
// blocks the server's IP address after repeated failed logins).
const loginCooldown = time.Minute

// session holds the session id (sid) of one login. Only one login runs at
// a time: callers that need a session while a login runs wait for it and
// get its result, also a failed one (no second login attempt). After a
// failed login, the session returns the same error without a new login
// until loginCooldown has passed.
type session struct {
	mu       sync.Mutex
	sid      string
	inflight *loginCall // non-nil while a login runs
	// failErr is the error of the last failed login; it is returned
	// until failUntil.
	failErr   error
	failUntil time.Time
}

// loginCall is a running login. done is closed when sid and err are set.
type loginCall struct {
	done chan struct{}
	sid  string
	err  error
}

// get returns the current session id. Without one it logs in with login
// (or waits for the login that already runs).
func (s *session) get(ctx context.Context, login func(context.Context) (string, error)) (string, error) {
	s.mu.Lock()
	if s.sid != "" {
		sid := s.sid
		s.mu.Unlock()
		return sid, nil
	}
	if s.failErr != nil && time.Now().Before(s.failUntil) {
		err := s.failErr
		s.mu.Unlock()
		return "", err
	}
	if call := s.inflight; call != nil {
		s.mu.Unlock()
		select {
		case <-call.done:
			return call.sid, call.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	call := &loginCall{done: make(chan struct{})}
	s.inflight = call
	s.mu.Unlock()

	// Other callers wait for this login, so it must not stop when only
	// this caller's request is cancelled. The HTTP client timeout limits
	// it.
	call.sid, call.err = login(context.WithoutCancel(ctx))

	s.mu.Lock()
	s.inflight = nil
	if call.err == nil {
		s.sid = call.sid
		s.failErr = nil
	} else {
		s.failErr = call.err
		s.failUntil = time.Now().Add(loginCooldown)
	}
	s.mu.Unlock()
	close(call.done)
	return call.sid, call.err
}

// invalidate removes the session id sid after the NAS reported it as
// expired or invalid. A newer session id (from a login of another caller)
// stays.
func (s *session) invalidate(sid string) {
	s.mu.Lock()
	if s.sid == sid {
		s.sid = ""
	}
	s.mu.Unlock()
}

// take removes the current session id and returns it ("" if there is
// none), e.g. for a logout.
func (s *session) take() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	sid := s.sid
	s.sid = ""
	return sid
}

// passphraseCache maps the ids of the albums shared with the account to
// their share tokens (passphrases). It is filled from the shared-album list
// of the NAS. The tokens stay in memory on the server.
type passphraseCache struct {
	mu      sync.Mutex
	byAlbum map[int64]string
}

// get returns the passphrase of the shared album albumID, if it is known.
func (p *passphraseCache) get(albumID int64) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	pass, ok := p.byAlbum[albumID]
	return pass, ok
}

// replace sets the content of the cache to the albums of a complete
// shared-album list. Albums without id or passphrase are left out.
func (p *passphraseCache) replace(albums []SharedAlbum) {
	m := make(map[int64]string, len(albums))
	for _, a := range albums {
		if a.ID > 0 && a.Passphrase != "" {
			m[a.ID] = a.Passphrase
		}
	}
	p.mu.Lock()
	p.byAlbum = m
	p.mu.Unlock()
}

// sessionCache holds one session and one passphrase cache per connector.
// An entry is replaced when the config of the connector changes (new URL,
// account, password or TLS option), so that a changed config always logs
// in again (this also ends the login cooldown of the old entry) and loads
// the shared albums again.
type sessionCache struct {
	mu      sync.Mutex
	entries map[uint]cachedSession
}

// cachedSession is a session and a passphrase cache together with the
// config they were made for.
type cachedSession struct {
	config      Config
	session     *session
	passphrases *passphraseCache
}

// forConnector returns the session and the passphrase cache of a connector
// for the config cfg.
func (c *sessionCache) forConnector(connectorID uint, cfg Config) (*session, *passphraseCache) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[connectorID]; ok && e.config == cfg {
		return e.session, e.passphrases
	}
	if c.entries == nil {
		c.entries = make(map[uint]cachedSession)
	}
	e := cachedSession{config: cfg, session: &session{}, passphrases: &passphraseCache{}}
	c.entries[connectorID] = e
	return e.session, e.passphrases
}
