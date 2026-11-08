package connector

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
)

// Kind implements the type-specific behaviour of one connector type (for
// example "immich"). The Service handles everything that is the same for
// all types (ownership, name, encryption, storage) and delegates the config
// to the Kind. A new connector type is a new Kind registered in main.go; the
// Service does not change.
//
// All config values are plain (decrypted) JSON documents.
type Kind interface {
	// Type returns the type name stored in Connector.Type, e.g. "immich".
	Type() string

	// BuildConfig validates the config sent by the client and returns the
	// normalized config to store. stored is nil when a connector is created;
	// on update it is the current config, so that the Kind can keep values
	// the client did not send again (for example an empty API key keeps the
	// stored one). Invalid input gives an apperr validation error.
	BuildConfig(input, stored json.RawMessage) (json.RawMessage, error)

	// PublicConfig returns the config as shown to the client, without
	// secrets.
	PublicConfig(stored json.RawMessage) (json.RawMessage, error)

	// Test checks that the source can be reached with the stored config.
	// A failed check is a TestResult with OK=false, not an error; the error
	// is only for internal failures (for example an unreadable config).
	Test(ctx context.Context, stored json.RawMessage) (TestResult, error)
}

// TestResult is the result of a connection test.
type TestResult struct {
	OK bool `json:"ok"`
	// ServerVersion is the version of the remote server, if known.
	ServerVersion string `json:"serverVersion,omitempty"`
	// Error is a message for the user when OK is false.
	Error string `json:"error,omitempty"`
}

// Registry maps connector type names to their Kind.
type Registry struct {
	kinds map[string]Kind
}

// NewRegistry returns a registry with the given kinds. Two kinds with the
// same type name are a programming error and give an error.
func NewRegistry(kinds ...Kind) (*Registry, error) {
	r := &Registry{kinds: make(map[string]Kind, len(kinds))}
	for _, k := range kinds {
		if _, dup := r.kinds[k.Type()]; dup {
			return nil, fmt.Errorf("connector kind %q registered twice", k.Type())
		}
		r.kinds[k.Type()] = k
	}
	return r, nil
}

// Lookup returns the Kind for a type name.
func (r *Registry) Lookup(typeName string) (Kind, bool) {
	k, ok := r.kinds[typeName]
	return k, ok
}

// Types returns the registered type names in sorted order.
func (r *Registry) Types() []string {
	return slices.Sorted(maps.Keys(r.kinds))
}
