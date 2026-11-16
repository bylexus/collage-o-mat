package synology

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
)

// Type is the connector type name of Synology connectors.
const Type = "synology"

// Config is the stored (decrypted) config of a Synology connector.
type Config struct {
	// URL is the DSM address of the NAS as "scheme://host[:port]", without
	// path, e.g. "https://nas.example.com:5001".
	URL      string `json:"url"`
	Account  string `json:"account"`
	Password string `json:"password"`
	// SkipTLSVerify disables the check of the NAS's TLS certificate (for
	// self-signed certificates).
	SkipTLSVerify bool `json:"skipTlsVerify"`
}

// publicConfig is the config as shown to the client.
type publicConfig struct {
	URL           string `json:"url"`
	Account       string `json:"account"`
	PasswordSet   bool   `json:"passwordSet"`
	SkipTLSVerify bool   `json:"skipTlsVerify"`
}

// Kind is the connector.Kind of Synology connectors. It also creates
// Clients from a stored config for the Synology-specific routes and keeps
// their sessions (one per connector, in memory).
type Kind struct {
	http     *http.Client // TLS certificate checked
	insecure *http.Client // TLS certificate not checked
	sessions sessionCache
}

// NewKind returns the Synology kind. All its clients share two HTTP
// clients: one that checks the TLS certificate and one that does not.
func NewKind() *Kind {
	return &Kind{http: NewHTTPClient(false), insecure: NewHTTPClient(true)}
}

var _ connector.Kind = (*Kind)(nil)

// Type implements connector.Kind.
func (k *Kind) Type() string { return Type }

// BuildConfig implements connector.Kind. input is {"url": "...",
// "account": "...", "password": "...", "skipTlsVerify": false}. The URL
// must be an http(s) URL; it is stored as "scheme://host[:port]" (a path
// such as "/photo/" is removed). The account is required. The password is
// required on create; on update an empty password keeps the stored one.
func (k *Kind) BuildConfig(input, stored json.RawMessage) (json.RawMessage, error) {
	in, err := decodeInput(input)
	if err != nil {
		return nil, err
	}
	cfg := Config{
		Account:       strings.TrimSpace(in.Account),
		Password:      in.Password,
		SkipTLSVerify: in.SkipTLSVerify,
	}
	if cfg.URL, err = normalizeURL(in.URL); err != nil {
		return nil, err
	}
	if cfg.Account == "" {
		return nil, apperr.Validation("account is required")
	}
	if cfg.Password == "" && stored != nil {
		old, err := ParseConfig(stored)
		if err != nil {
			return nil, err
		}
		cfg.Password = old.Password
	}
	if cfg.Password == "" {
		return nil, apperr.Validation("password is required")
	}
	out, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("encode synology config: %w", err)
	}
	return out, nil
}

// PublicConfig implements connector.Kind: {"url": "...", "account": "...",
// "passwordSet": true, "skipTlsVerify": false}.
func (k *Kind) PublicConfig(stored json.RawMessage) (json.RawMessage, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(publicConfig{
		URL:           cfg.URL,
		Account:       cfg.Account,
		PasswordSet:   cfg.Password != "",
		SkipTLSVerify: cfg.SkipTLSVerify,
	})
	if err != nil {
		return nil, fmt.Errorf("encode synology public config: %w", err)
	}
	return out, nil
}

// Test implements connector.Kind. It logs in and reads one album (checks
// the access to Synology Photos), then logs out. It uses its own session,
// not the cached session of the connector (connector.Kind.Test gets no
// connector id), so every test checks the stored password. The NAS has no
// version in the answer; ServerVersion stays empty.
func (k *Kind) Test(ctx context.Context, stored json.RawMessage) (connector.TestResult, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return connector.TestResult{}, err
	}
	client := newClient(cfg, k.httpClient(cfg), &session{})
	defer client.Logout(context.WithoutCancel(ctx))
	if err := client.probeAlbums(ctx); err != nil {
		return connector.TestResult{OK: false, Error: err.Error()}, nil
	}
	return connector.TestResult{OK: true}, nil
}

// Client returns a client for a stored (decrypted) config of the connector
// connectorID, e.g. from connector.Service.LoadConfig. Clients of the same
// connector share one session as long as its config does not change.
func (k *Kind) Client(connectorID uint, stored json.RawMessage) (*Client, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return nil, err
	}
	return newClient(cfg, k.httpClient(cfg), k.sessions.forConnector(connectorID, cfg)), nil
}

// httpClient returns the shared HTTP client for the TLS option of cfg.
func (k *Kind) httpClient(cfg Config) *http.Client {
	if cfg.SkipTLSVerify {
		return k.insecure
	}
	return k.http
}

// ParseConfig decodes a stored (decrypted) Synology config.
func ParseConfig(stored json.RawMessage) (Config, error) {
	var cfg Config
	if err := json.Unmarshal(stored, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode synology config: %w", err)
	}
	return cfg, nil
}

// decodeInput decodes the config sent by the client. Unknown fields are
// rejected, like in the rest of the API.
func decodeInput(input json.RawMessage) (Config, error) {
	trimmed := bytes.TrimSpace(input)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return Config{}, apperr.Validation("config is required")
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var in Config
	if err := dec.Decode(&in); err != nil {
		return Config{}, apperr.Validation(
			"invalid Synology config: expected {\"url\": \"...\", \"account\": \"...\", \"password\": \"...\", \"skipTlsVerify\": false}")
	}
	return in, nil
}

// normalizeURL checks that s is an absolute http(s) URL without user info,
// query or fragment and returns only "scheme://host[:port]" (any path, e.g.
// "/photo/", is removed: the Web API is always at /webapi/entry.cgi).
func normalizeURL(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", apperr.Validation("URL is required")
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", apperr.Validation("URL must be an http or https URL, e.g. https://nas.example.com:5001")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", apperr.Validation("URL must not contain a user name, query or fragment")
	}
	return u.Scheme + "://" + u.Host, nil
}
