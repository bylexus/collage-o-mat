package auth

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// maxLoginFailures is the number of failed logins for one key (username,
	// client IP) within loginFailureWindow that blocks the key.
	maxLoginFailures = 3
	// loginFailureWindow is the time a failed login counts. Older failures
	// are ignored.
	loginFailureWindow = 15 * time.Minute
	// loginBlockDuration is how long a key stays blocked, starting at the
	// failure that reached maxLoginFailures.
	loginBlockDuration = 15 * time.Minute
	// loginPruneInterval is the minimum time between two removals of
	// expired entries.
	loginPruneInterval = time.Minute
)

// loginEntry holds the state of one key.
type loginEntry struct {
	failures     []time.Time // failures within loginFailureWindow, oldest first
	blockedUntil time.Time   // zero if not blocked
}

// LoginLimiter counts failed logins per key in memory and blocks a key after
// maxLoginFailures failures. It is safe for concurrent use. The state is lost
// on restart and is not shared between instances.
type LoginLimiter struct {
	mu        sync.Mutex
	now       func() time.Time
	entries   map[string]*loginEntry
	nextPrune time.Time
}

// NewLoginLimiter returns an empty limiter. now is the clock (time.Now in
// production).
func NewLoginLimiter(now func() time.Time) *LoginLimiter {
	return &LoginLimiter{now: now, entries: make(map[string]*loginEntry)}
}

// LoginKey builds the limiter key from the username (trimmed, lower-case)
// and the client IP.
func LoginKey(username, clientIP string) string {
	return strings.ToLower(strings.TrimSpace(username)) + "\x00" + clientIP
}

// Blocked tells if the key is blocked and, if so, how long the block lasts.
func (l *LoginLimiter) Blocked(key string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.pruneIfDue(now)
	e, ok := l.entries[key]
	if !ok || !now.Before(e.blockedUntil) {
		return 0, false
	}
	return e.blockedUntil.Sub(now), true
}

// Fail records a failed login for the key. The failure that reaches
// maxLoginFailures within loginFailureWindow blocks the key for
// loginBlockDuration.
func (l *LoginLimiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.pruneIfDue(now)
	e, ok := l.entries[key]
	if !ok {
		e = &loginEntry{}
		l.entries[key] = e
	}
	e.failures = append(recentFailures(e.failures, now), now)
	if len(e.failures) >= maxLoginFailures {
		e.blockedUntil = now.Add(loginBlockDuration)
		e.failures = nil
	}
}

// Reset removes the key (after a successful login).
func (l *LoginLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

// pruneIfDue removes expired entries, at most once per loginPruneInterval.
// The caller holds l.mu.
func (l *LoginLimiter) pruneIfDue(now time.Time) {
	if now.Before(l.nextPrune) {
		return
	}
	l.nextPrune = now.Add(loginPruneInterval)
	for key, e := range l.entries {
		e.failures = recentFailures(e.failures, now)
		if len(e.failures) == 0 && !now.Before(e.blockedUntil) {
			delete(l.entries, key)
		}
	}
}

// recentFailures returns the failures that are younger than
// loginFailureWindow. failures is sorted, oldest first.
func recentFailures(failures []time.Time, now time.Time) []time.Time {
	cutoff := now.Add(-loginFailureWindow)
	i := 0
	for i < len(failures) && !failures[i].After(cutoff) {
		i++
	}
	return failures[i:]
}

// ClientIP returns the client address of the request: the right-most
// non-empty address of the X-Forwarded-For header (the address the reverse
// proxy appended), else the host of the TCP peer address.
func ClientIP(r *http.Request) string {
	values := r.Header.Values("X-Forwarded-For")
	for i := len(values) - 1; i >= 0; i-- {
		parts := strings.Split(values[i], ",")
		for j := len(parts) - 1; j >= 0; j-- {
			if ip := strings.TrimSpace(parts[j]); ip != "" {
				return ip
			}
		}
	}
	addr := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}
