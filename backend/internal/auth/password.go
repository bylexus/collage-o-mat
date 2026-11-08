package auth

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	maxUsernameLen = 64
	minPasswordLen = 8
	maxPasswordLen = 72 // bcrypt uses only the first 72 bytes
)

// NormalizeUsername trims the username and checks that it is not empty and
// at most 64 characters long.
func NormalizeUsername(username string) (string, error) {
	u := strings.TrimSpace(username)
	if u == "" {
		return "", errors.New("username must not be empty")
	}
	if utf8.RuneCountInString(u) > maxUsernameLen {
		return "", fmt.Errorf("username must be at most %d characters", maxUsernameLen)
	}
	return u, nil
}

// ValidatePassword checks the password length rules.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < minPasswordLen {
		return fmt.Errorf("password must be at least %d characters", minPasswordLen)
	}
	if len(password) > maxPasswordLen {
		return fmt.Errorf("password must be at most %d bytes", maxPasswordLen)
	}
	return nil
}

func hashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(h), nil
}

func checkPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
