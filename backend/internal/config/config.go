// Package config reads the COLLAGEOMAT_* environment variables.
package config

import (
	"errors"
	"fmt"
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
)

// Config holds the runtime configuration of the server.
type Config struct {
	Listen       string // COLLAGEOMAT_LISTEN
	DataDir      string // COLLAGEOMAT_DATA_DIR
	Secret       string // COLLAGEOMAT_SECRET
	CookieSecure bool   // COLLAGEOMAT_COOKIE_SECURE
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

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
