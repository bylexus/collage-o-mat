package immich

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

// Type is the connector type name of Immich connectors.
const Type = "immich"

// Config is the stored (decrypted) config of an Immich connector.
type Config struct {
	// URL is the server URL without "/api" and without trailing slash,
	// e.g. "https://immich.example.com".
	URL    string `json:"url"`
	APIKey string `json:"apiKey"`
}

// publicConfig is the config as shown to the client.
type publicConfig struct {
	URL       string `json:"url"`
	APIKeySet bool   `json:"apiKeySet"`
}

// Kind is the connector.Kind of Immich connectors. It also creates Clients
// from a stored config for the Immich-specific routes.
type Kind struct {
	http *http.Client
}

// NewKind returns the Immich kind. All its clients share httpClient; nil
// means NewHTTPClient().
func NewKind(httpClient *http.Client) *Kind {
	if httpClient == nil {
		httpClient = NewHTTPClient()
	}
	return &Kind{http: httpClient}
}

var _ connector.Kind = (*Kind)(nil)

// Type implements connector.Kind.
func (k *Kind) Type() string { return Type }

// BuildConfig implements connector.Kind. input is {"url": "...", "apiKey":
// "..."}. The URL must be an http(s) URL; it is stored without trailing
// slash. The API key is required on create; on update an empty key keeps the
// stored one.
func (k *Kind) BuildConfig(input, stored json.RawMessage) (json.RawMessage, error) {
	in, err := decodeInput(input)
	if err != nil {
		return nil, err
	}
	cfg := Config{APIKey: strings.TrimSpace(in.APIKey)}
	if cfg.URL, err = normalizeURL(in.URL); err != nil {
		return nil, err
	}
	if cfg.APIKey == "" && stored != nil {
		old, err := ParseConfig(stored)
		if err != nil {
			return nil, err
		}
		cfg.APIKey = old.APIKey
	}
	if cfg.APIKey == "" {
		return nil, apperr.Validation("API key is required")
	}
	out, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("encode immich config: %w", err)
	}
	return out, nil
}

// PublicConfig implements connector.Kind: {"url": "...", "apiKeySet": true}.
func (k *Kind) PublicConfig(stored json.RawMessage) (json.RawMessage, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(publicConfig{URL: cfg.URL, APIKeySet: cfg.APIKey != ""})
	if err != nil {
		return nil, fmt.Errorf("encode immich public config: %w", err)
	}
	return out, nil
}

// Test implements connector.Kind. It reads the server version (public) and
// the album list (checks the API key and the permission album.read).
func (k *Kind) Test(ctx context.Context, stored json.RawMessage) (connector.TestResult, error) {
	client, err := k.Client(stored)
	if err != nil {
		return connector.TestResult{}, err
	}
	version, err := client.ServerVersion(ctx)
	if err != nil {
		return connector.TestResult{OK: false, Error: err.Error()}, nil
	}
	res := connector.TestResult{ServerVersion: version.String()}
	if _, err := client.ListAlbums(ctx); err != nil {
		res.Error = err.Error()
		return res, nil
	}
	res.OK = true
	return res, nil
}

// Client returns an Immich client for a stored (decrypted) config, e.g. from
// connector.Service.LoadConfig.
func (k *Kind) Client(stored json.RawMessage) (*Client, error) {
	cfg, err := ParseConfig(stored)
	if err != nil {
		return nil, err
	}
	return NewClient(cfg.URL, cfg.APIKey, k.http), nil
}

// ParseConfig decodes a stored (decrypted) Immich config.
func ParseConfig(stored json.RawMessage) (Config, error) {
	var cfg Config
	if err := json.Unmarshal(stored, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode immich config: %w", err)
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
		return Config{}, apperr.Validation("invalid Immich config: expected {\"url\": \"...\", \"apiKey\": \"...\"}")
	}
	return in, nil
}

// normalizeURL checks that s is an absolute http(s) URL without user info,
// query or fragment and returns it without trailing slash.
func normalizeURL(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", apperr.Validation("URL is required")
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", apperr.Validation("URL must be an http or https URL, e.g. https://immich.example.com")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return "", apperr.Validation("URL must not contain a user name, query or fragment")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
