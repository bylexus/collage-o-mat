package googlephotos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/endpoints"

	"collageomat/internal/apperr"
	"collageomat/internal/connector"
)

// Type is the connector type name of Google Photos connectors.
const Type = "googlephotos"

// CallbackPath is the path of the OAuth redirect URI. The redirect URI of
// every connector must have exactly this path.
const CallbackPath = "/api/googlephotos/oauth/callback"

// Scope is the OAuth scope of the Google Photos Picker API (create, read and
// delete picker sessions, list the picked media items).
const Scope = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"

// testTimeout limits the connection test (one token request).
const testTimeout = 15 * time.Second

// testCode is the dummy authorization code that the connection test sends
// to the token endpoint. Google cannot know it, so a correct client gives
// "invalid_grant".
const testCode = "collageomat-connection-test"

// Config is the stored (decrypted) config of a Google Photos connector.
type Config struct {
	// ClientID and ClientSecret are the OAuth client ("Web application")
	// of the user's own Google Cloud project.
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	// RedirectURI is the OAuth redirect URI, e.g.
	// "https://collages.example.com/api/googlephotos/oauth/callback". It
	// comes from the browser (origin + CallbackPath) and must be registered
	// in the Google OAuth client.
	RedirectURI string `json:"redirectUri"`
}

// publicConfig is the config as shown to the client.
type publicConfig struct {
	ClientID        string `json:"clientId"`
	ClientSecretSet bool   `json:"clientSecretSet"`
	RedirectURI     string `json:"redirectUri"`
}

// Kind is the connector.Kind of Google Photos connectors.
type Kind struct {
	http *http.Client
}

// NewKind returns the Google Photos kind.
func NewKind() *Kind {
	return &Kind{http: &http.Client{Timeout: testTimeout}}
}

var _ connector.Kind = (*Kind)(nil)

// Type implements connector.Kind.
func (k *Kind) Type() string { return Type }

// BuildConfig implements connector.Kind. input is {"clientId": "...",
// "clientSecret": "...", "redirectUri": "..."}. The client ID is required.
// The client secret is required on create; on update an empty secret keeps
// the stored one. The redirect URI must be an absolute URL with the path
// CallbackPath, scheme https (http only for localhost / 127.0.0.1) and no
// user info, query or fragment.
func (k *Kind) BuildConfig(input, stored json.RawMessage) (json.RawMessage, error) {
	in, err := decodeInput(input)
	if err != nil {
		return nil, err
	}
	cfg := Config{
		ClientID:     strings.TrimSpace(in.ClientID),
		ClientSecret: strings.TrimSpace(in.ClientSecret),
	}
	if cfg.ClientID == "" {
		return nil, apperr.Validation("client ID is required")
	}
	if cfg.RedirectURI, err = validateRedirectURI(in.RedirectURI); err != nil {
		return nil, err
	}
	if cfg.ClientSecret == "" && stored != nil {
		old, err := ParseConfig(stored)
		if err != nil {
			return nil, err
		}
		cfg.ClientSecret = old.ClientSecret
	}
	if cfg.ClientSecret == "" {
		return nil, apperr.Validation("client secret is required")
	}
	out, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("encode googlephotos config: %w", err)
	}
	return out, nil
}

// PublicConfig implements connector.Kind: {"clientId": "...",
// "clientSecretSet": true, "redirectUri": "..."}.
func (k *Kind) PublicConfig(stored json.RawMessage) (json.RawMessage, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(publicConfig{
		ClientID:        cfg.ClientID,
		ClientSecretSet: cfg.ClientSecret != "",
		RedirectURI:     cfg.RedirectURI,
	})
	if err != nil {
		return nil, fmt.Errorf("encode googlephotos public config: %w", err)
	}
	return out, nil
}

// Test implements connector.Kind. A real test needs a Google sign-in, so it
// exchanges a dummy authorization code at Google's token endpoint instead.
// Google checks the client and the redirect URI before the code: a correct
// config gives "invalid_grant" (the code is unknown), a wrong one gives an
// error for the client or the redirect URI. The messages never contain the
// client secret.
func (k *Kind) Test(ctx context.Context, stored json.RawMessage) (connector.TestResult, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return connector.TestResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, testTimeout)
	defer cancel()
	ctx = context.WithValue(ctx, oauth2.HTTPClient, k.http)

	_, err = OAuthConfig(cfg).Exchange(ctx, testCode)
	if err == nil {
		// Not expected: Google accepted the dummy code. The client works.
		return connector.TestResult{OK: true}, nil
	}
	var re *oauth2.RetrieveError
	if !errors.As(err, &re) {
		return connector.TestResult{OK: false, Error: unreachableMessage(err)}, nil
	}
	switch re.ErrorCode {
	case "invalid_grant":
		return connector.TestResult{OK: true}, nil
	case "invalid_client", "unauthorized_client":
		return connector.TestResult{OK: false, Error: "Client ID or client secret is wrong"}, nil
	case "redirect_uri_mismatch":
		return connector.TestResult{OK: false, Error: "Redirect URI is not registered in Google Cloud"}, nil
	case "":
		status := 0
		if re.Response != nil {
			status = re.Response.StatusCode
		}
		return connector.TestResult{OK: false, Error: fmt.Sprintf("Google answered with HTTP status %d", status)}, nil
	default:
		return connector.TestResult{OK: false, Error: "Google answered: " + re.ErrorCode}, nil
	}
}

// unreachableMessage returns a user-safe message for a token request that
// got no OAuth answer (network error, timeout). The request body (with the
// client secret) is never part of err; only the URL error is used.
func unreachableMessage(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "Google cannot be reached: timeout"
	}
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		return "Google cannot be reached: " + ue.Err.Error()
	}
	return "Google cannot be reached"
}

// OAuthConfig returns the OAuth 2.0 config (Google endpoints, Picker scope)
// of a connector config.
func OAuthConfig(cfg Config) *oauth2.Config {
	endpoint := endpoints.Google
	// Google wants the client credentials in the form body (same as
	// golang.org/x/oauth2/google.Endpoint); no auto-detect round trip.
	endpoint.AuthStyle = oauth2.AuthStyleInParams
	return &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		Endpoint:     endpoint,
		RedirectURL:  cfg.RedirectURI,
		Scopes:       []string{Scope},
	}
}

// ParseConfig decodes a stored (decrypted) Google Photos config.
func ParseConfig(stored json.RawMessage) (Config, error) {
	var cfg Config
	if err := json.Unmarshal(stored, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode googlephotos config: %w", err)
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
			"invalid Google Photos config: expected {\"clientId\": \"...\", \"clientSecret\": \"...\", \"redirectUri\": \"...\"}")
	}
	return in, nil
}

// validateRedirectURI checks the redirect URI and returns it trimmed: an
// absolute URL without user info, query or fragment, with the path
// CallbackPath and the scheme https, or http only for the hosts localhost
// and 127.0.0.1 (any port). These are Google's rules for web clients.
func validateRedirectURI(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", apperr.Validation("redirect URI is required")
	}
	u, err := url.Parse(s)
	if err != nil || !u.IsAbs() || u.Host == "" || u.Opaque != "" {
		return "", apperr.Validation("redirect URI must be an absolute URL")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(s, "#") {
		return "", apperr.Validation("redirect URI must not contain a user name, query or fragment")
	}
	if u.Path != CallbackPath || (u.RawPath != "" && u.RawPath != CallbackPath) {
		return "", apperr.Validation("redirect URI must have the path " + CallbackPath)
	}
	switch u.Scheme {
	case "https":
	case "http":
		if host := u.Hostname(); host != "localhost" && host != "127.0.0.1" {
			return "", apperr.Validation("redirect URI must use https (http only for localhost)")
		}
	default:
		return "", apperr.Validation("redirect URI must use https (http only for localhost)")
	}
	return s, nil
}
