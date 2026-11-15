package imaging

import (
	"context"
	"fmt"
)

// DecodeLimiter limits the number of images that are decoded and processed
// at the same time. A decoded image needs a lot of memory, so the server
// uses one shared limiter for all packages that decode images.
type DecodeLimiter struct {
	slots chan struct{}
}

// NewDecodeLimiter returns a limiter that allows n decodes at the same time
// (n < 1 is treated as 1).
func NewDecodeLimiter(n int) *DecodeLimiter {
	return &DecodeLimiter{slots: make(chan struct{}, max(n, 1))}
}

// Do runs fn when a decode slot is free and returns its error. It stops
// waiting when ctx is done and then returns an error that wraps ctx.Err().
func (l *DecodeLimiter) Do(ctx context.Context, fn func() error) error {
	select {
	case l.slots <- struct{}{}:
	case <-ctx.Done():
		return fmt.Errorf("wait for decode slot: %w", ctx.Err())
	}
	defer func() { <-l.slots }()
	return fn()
}
