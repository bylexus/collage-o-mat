// Package jsoncol provides a GORM column type for JSON documents stored as
// TEXT. The backend does not interpret the documents; it only checks that
// they are valid JSON.
package jsoncol

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
)

// JSON is a raw JSON document stored in a TEXT column. In API structs it is
// embedded as raw JSON (not as a string).
//
// Null handling: a nil or empty JSON, and the JSON literal null, are all
// "null". They are stored as SQL NULL and written to JSON as null. Columns
// that must have a value use a `not null` constraint and the service sets a
// default document (for example {}).
type JSON []byte

var nullLiteral = []byte("null")

// From marshals v into a JSON document.
func From(v any) (JSON, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal json column: %w", err)
	}
	return JSON(b).normalized(), nil
}

// IsNull reports whether j is empty or the JSON literal null.
func (j JSON) IsNull() bool {
	return len(j) == 0 || string(j) == string(nullLiteral)
}

// IsObject reports whether j is a valid JSON object (for example {} or
// {"a": 1}).
func (j JSON) IsObject() bool {
	trimmed := bytes.TrimLeft(j, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '{' && json.Valid(j)
}

// Decode unmarshals the document into target. A null document leaves target
// unchanged.
func (j JSON) Decode(target any) error {
	if j.IsNull() {
		return nil
	}
	if err := json.Unmarshal(j, target); err != nil {
		return fmt.Errorf("decode json column: %w", err)
	}
	return nil
}

// GormDataType implements GORM's GormDataTypeInterface: the column is TEXT.
func (JSON) GormDataType() string { return "text" }

// Value implements driver.Valuer. A null document is stored as SQL NULL.
func (j JSON) Value() (driver.Value, error) {
	if j.IsNull() {
		return nil, nil
	}
	if !json.Valid(j) {
		return nil, errors.New("json column: invalid JSON")
	}
	return string(j), nil
}

// Scan implements sql.Scanner. It accepts NULL, string and []byte and
// rejects invalid JSON.
func (j *JSON) Scan(src any) error {
	var b []byte
	switch v := src.(type) {
	case nil:
		*j = nil
		return nil
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return fmt.Errorf("json column: cannot scan %T", src)
	}
	return j.set(b)
}

// MarshalJSON implements json.Marshaler. A null document is written as null.
func (j JSON) MarshalJSON() ([]byte, error) {
	if j.IsNull() {
		return nullLiteral, nil
	}
	return j, nil
}

// UnmarshalJSON implements json.Unmarshaler. It stores a copy of data;
// the literal null becomes a null document.
func (j *JSON) UnmarshalJSON(data []byte) error {
	return j.set(data)
}

// set validates b and stores a copy (b may be reused by the caller).
func (j *JSON) set(b []byte) error {
	if len(b) > 0 && !json.Valid(b) {
		return errors.New("json column: invalid JSON")
	}
	*j = JSON(append([]byte(nil), b...)).normalized()
	return nil
}

// normalized returns nil for a null document, else j.
func (j JSON) normalized() JSON {
	if j.IsNull() {
		return nil
	}
	return j
}
