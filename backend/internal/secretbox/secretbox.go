// Package secretbox encrypts small secrets (for example connector configs)
// with AES-256-GCM before they are stored.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

// Box encrypts and decrypts byte slices with one key. It is safe for
// concurrent use.
type Box struct {
	aead cipher.AEAD
}

// New returns a Box whose AES-256 key is the SHA-256 hash of secret. The
// same secret is needed to decrypt the data again.
func New(secret string) (*Box, error) {
	if secret == "" {
		return nil, errors.New("secretbox: empty secret")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("secretbox: create cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("secretbox: create GCM: %w", err)
	}
	return &Box{aead: aead}, nil
}

// Encrypt returns base64(nonce ‖ ciphertext) of plaintext. Each call uses a
// new random nonce.
func (b *Box) Encrypt(plaintext []byte) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("secretbox: make nonce: %w", err)
	}
	sealed := b.aead.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt reverses Encrypt. It fails if the data was changed or was
// encrypted with another secret.
func (b *Box) Decrypt(encoded string) ([]byte, error) {
	sealed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("secretbox: decode base64: %w", err)
	}
	nonceSize := b.aead.NonceSize()
	if len(sealed) < nonceSize+b.aead.Overhead() {
		return nil, errors.New("secretbox: data too short")
	}
	plaintext, err := b.aead.Open(nil, sealed[:nonceSize], sealed[nonceSize:], nil)
	if err != nil {
		return nil, fmt.Errorf("secretbox: decrypt (wrong secret or changed data): %w", err)
	}
	return plaintext, nil
}
