package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Paths on the Python engine. PROVISIONAL until contracts/ v1 (H-02).
const (
	triagePath = "/triage"
	healthPath = "/health"
	maxReply   = 2 << 20
)

// Client calls the private Python engine over HTTP.
type Client struct {
	base    string
	timeout time.Duration
	http    *http.Client
}

func NewClient(baseURL string, timeout time.Duration) *Client {
	return &Client{base: baseURL, timeout: timeout, http: &http.Client{}}
}

func (c *Client) Mode() string { return "engine" }

func (c *Client) Triage(ctx context.Context, req Request) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+triagePath, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	hr.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(hr)
	if err != nil {
		return nil, c.transportError(ctx, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxReply))
	if err != nil {
		return nil, c.transportError(ctx, err)
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, &Error{
			Status:  http.StatusBadGateway,
			Code:    "ENGINE_ERROR",
			Message: fmt.Sprintf("The triage engine failed (%d): %s", res.StatusCode, engineMessage(raw)),
		}
	}
	var out Result
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return nil, &Error{Status: http.StatusBadGateway, Code: "ENGINE_BAD_RESPONSE", Message: "The triage engine sent a response that is not a JSON object.", Err: err}
	}
	return out, nil
}

func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	hr, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+healthPath, nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(hr)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("engine health returned %d", res.StatusCode)
	}
	return nil
}

func (c *Client) transportError(ctx context.Context, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &Error{Status: http.StatusGatewayTimeout, Code: "ENGINE_TIMEOUT", Message: fmt.Sprintf("The triage engine did not answer within %s.", c.timeout), Err: err}
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return &Error{Status: 499, Code: "CANCELLED", Message: "The request was cancelled.", Err: err}
	}
	return &Error{Status: http.StatusServiceUnavailable, Code: "ENGINE_UNAVAILABLE", Message: "The triage engine is not reachable right now.", Err: err}
}

// engineMessage pulls a readable message out of FastAPI ({"detail": ...}) or gateway-style errors.
func engineMessage(raw []byte) string {
	var v struct {
		Detail any `json:"detail"`
		Error  struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &v) == nil {
		switch d := v.Detail.(type) {
		case string:
			return d
		case []any:
			if m, ok := firstMsg(d); ok {
				return m
			}
		}
		if v.Error.Message != "" {
			return v.Error.Message
		}
	}
	if len(raw) == 0 {
		return "no details"
	}
	if len(raw) > 200 {
		raw = raw[:200]
	}
	return string(raw)
}

func firstMsg(items []any) (string, bool) {
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			if s, ok := m["msg"].(string); ok {
				return s, true
			}
		}
	}
	return "", false
}
