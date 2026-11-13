// Package config reads the COLLAGEOMAT_* environment variables.
package config

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

const (
	// dbFileName is the name of the SQLite file inside the data directory.
	dbFileName = "collageomat.db"
	// photosDirName is the name of the photo directory inside the data
	// directory.
	photosDirName = "photos"
	// DefaultCookieName is the session cookie name if COLLAGEOMAT_COOKIE_NAME is not set.
	DefaultCookieName = "collageomat_session"
)

// Config holds the runtime configuration of the server.
type Config struct {
	Listen       string // COLLAGEOMAT_LISTEN
	DataDir      string // COLLAGEOMAT_DATA_DIR
	Secret       string // COLLAGEOMAT_SECRET
	CookieSecure bool   // COLLAGEOMAT_COOKIE_SECURE
	CookieName   string // COLLAGEOMAT_COOKIE_NAME
}

// FromEnv reads the configuration from the environment and applies defaults.
// It does not require COLLAGEOMAT_SECRET; commands that need it call
// RequireSecret.
func FromEnv() (Config, error) {
	cfg := Config{
		Listen:       envOr("COLLAGEOMAT_LISTEN", ":8080"),
		DataDir:      envOr("COLLAGEOMAT_DATA_DIR", "./data"),
		Secret:       os.Getenv("COLLAGEOMAT_SECRET"),
		CookieSecure: true,
		CookieName:   envOr("COLLAGEOMAT_COOKIE_NAME", DefaultCookieName),
	}
	if err := validCookieName(cfg.CookieName); err != nil {
		return Config{}, err
	}
	if v := os.Getenv("COLLAGEOMAT_COOKIE_SECURE"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("COLLAGEOMAT_COOKIE_SECURE: invalid boolean %q", v)
		}
		cfg.CookieSecure = b
	}
	return cfg, nil
}

// RequireSecret returns an error if COLLAGEOMAT_SECRET is not set.
func (c Config) RequireSecret() error {
	if c.Secret == "" {
		return errors.New("COLLAGEOMAT_SECRET is not set: the server needs a secret to encrypt connector API keys " +
			"(set it to any long random string and keep it; changing it makes stored API keys unreadable)")
	}
	return nil
}

// EnsureDataDir creates the data directory if it does not exist.
func (c Config) EnsureDataDir() error {
	if err := os.MkdirAll(c.DataDir, 0o750); err != nil {
		return fmt.Errorf("create data dir %q: %w", c.DataDir, err)
	}
	return nil
}

// DBPath returns the path of the SQLite database file.
func (c Config) DBPath() string {
	return filepath.Join(c.DataDir, dbFileName)
}

// PhotosDir returns the directory of the imported photo files.
func (c Config) PhotosDir() string {
	return filepath.Join(c.DataDir, photosDirName)
}

// validCookieName checks that name is a valid cookie name (an RFC 6265 token).
func validCookieName(name string) error {
	if err := (&http.Cookie{Name: name}).Valid(); err != nil {
		return fmt.Errorf("COLLAGEOMAT_COOKIE_NAME: invalid cookie name %q", name)
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
