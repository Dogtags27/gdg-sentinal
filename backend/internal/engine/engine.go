// Package engine is the gateway's view of the triage engine: the private Python service or the mock.
package engine

import (
	"context"
	"errors"
)

// Request is what the engine receives. Subject and body are already PII-masked.
// PROVISIONAL until contracts/ v1 (H-02) is frozen.
type Request struct {
	TicketID string `json:"ticket_id,omitempty"`
	Subject  string `json:"subject"`
	Body     string `json:"body"`
}

// Result is the engine's TriageResult as a JSON object. The gateway passes fields it doesn't own through
// unchanged and only sets ticket_id, subject, body, pii and latency_ms.gateway.
type Result = map[string]any

type Engine interface {
	Triage(ctx context.Context, req Request) (Result, error)
	// Health reports whether the engine can take requests.
	Health(ctx context.Context) error
	Mode() string // "mock" or "engine"
}

// Error is an engine failure the gateway turns into an HTTP response.
type Error struct {
	Status  int    // HTTP status the gateway returns
	Code    string // stable code for the console, e.g. ENGINE_TIMEOUT
	Message string // readable by an operator
	Err     error
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Err }

func AsError(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}
