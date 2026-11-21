package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Dogtags27/gdg-sentinal/backend/internal/engine"
	"github.com/Dogtags27/gdg-sentinal/backend/internal/ratelimit"
)

type fakeEngine struct {
	got  engine.Request
	res  engine.Result
	err  error
	mode string
	down bool
}

func (f *fakeEngine) Triage(ctx context.Context, req engine.Request) (engine.Result, error) {
	f.got = req
	if f.err != nil {
		return nil, f.err
	}
	out := engine.Result{}
	for k, v := range f.res {
		out[k] = v
	}
	return out, nil
}

func (f *fakeEngine) Health(context.Context) error {
	if f.down {
		return io.EOF
	}
	return nil
}

func (f *fakeEngine) Mode() string {
	if f.mode == "" {
		return "engine"
	}
	return f.mode
}

func newServer(t *testing.T, eng engine.Engine) *Server {
	t.Helper()
	return &Server{Engine: eng, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), StaticDir: t.TempDir(), InsightsDir: t.TempDir()}
}

func do(t *testing.T, h http.Handler, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func errCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	s, _ := e["code"].(string)
	return s
}

func TestTriageMasksPIIBeforeTheEngine(t *testing.T) {
	f := &fakeEngine{res: engine.Result{"ticket_id": "TKT-1", "gate": map[string]any{"decision": "AUTO_DRAFT"}, "latency_ms": map[string]any{"total": 100.0}}}
	h := newServer(t, f).Handler()
	rec, out := do(t, h, "POST", "/api/triage", `{"subject":"Reset for anna@example.com","body":"Call me on +49 30 1234 5678"}`)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if strings.Contains(f.got.Subject+f.got.Body, "anna@") || strings.Contains(f.got.Body, "1234") {
		t.Fatalf("engine saw raw PII: %+v", f.got)
	}
	if out["subject"] != f.got.Subject || out["body"] != f.got.Body {
		t.Errorf("response should echo the masked text the engine saw, got %v / %v", out["subject"], out["body"])
	}
	if masked, _ := out["pii"].(map[string]any)["masked"].([]any); len(masked) != 2 {
		t.Errorf("pii.masked = %v", out["pii"])
	}
	lat := out["latency_ms"].(map[string]any)
	if _, ok := lat["gateway"].(float64); !ok || lat["total"].(float64) < 100 {
		t.Errorf("latency_ms = %v", lat)
	}
	if rec.Header().Get("X-Request-ID") == "" {
		t.Error("missing X-Request-ID")
	}
}

func TestTriageAssignsTicketIDWhenEngineOmitsIt(t *testing.T) {
	f := &fakeEngine{res: engine.Result{"gate": map[string]any{"decision": "AUTO_DRAFT"}}}
	_, out := do(t, newServer(t, f).Handler(), "POST", "/api/triage", `{"subject":"hi"}`)
	if id, _ := out["ticket_id"].(string); !strings.HasPrefix(id, "GW-") {
		t.Errorf("ticket_id = %v", out["ticket_id"])
	}
	if _, ok := out["pii"].(map[string]any)["masked"].([]any); !ok {
		t.Errorf("pii.masked should be a JSON array, got %v", out["pii"])
	}
}

func TestTriageValidation(t *testing.T) {
	h := newServer(t, &fakeEngine{}).Handler()
	cases := []struct {
		name, body string
		status     int
		code       string
	}{
		{"not json", `hello`, 400, "BAD_JSON"},
		{"wrong types", `{"subject": 5}`, 400, "BAD_JSON"},
		{"empty", `{"subject":"  ","body":""}`, 400, "VALIDATION"},
		{"subject too long", `{"subject":"` + strings.Repeat("a", 301) + `"}`, 400, "VALIDATION"},
		{"body too long", `{"body":"` + strings.Repeat("ä", 8001) + `"}`, 400, "VALIDATION"},
		{"request too large", `{"body":"` + strings.Repeat("a", 70<<10) + `"}`, 413, "TOO_LARGE"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec, out := do(t, h, "POST", "/api/triage", c.body)
			if rec.Code != c.status || errCode(out) != c.code {
				t.Errorf("got %d %q, want %d %q (%s)", rec.Code, errCode(out), c.status, c.code, rec.Body)
			}
		})
	}
}

func TestTriageEngineErrors(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{&engine.Error{Status: 504, Code: "ENGINE_TIMEOUT", Message: "slow"}, 504, "ENGINE_TIMEOUT"},
		{&engine.Error{Status: 503, Code: "ENGINE_UNAVAILABLE", Message: "down"}, 503, "ENGINE_UNAVAILABLE"},
		{io.ErrUnexpectedEOF, 500, "INTERNAL"},
	}
	for _, c := range cases {
		rec, out := do(t, newServer(t, &fakeEngine{err: c.err}).Handler(), "POST", "/api/triage", `{"subject":"x"}`)
		if rec.Code != c.status || errCode(out) != c.code {
			t.Errorf("%v: got %d %q", c.err, rec.Code, errCode(out))
		}
		if msg, _ := out["error"].(map[string]any)["message"].(string); msg == "" || strings.Contains(msg, "EOF") {
			t.Errorf("message should be readable and not leak internals: %q", msg)
		}
	}
}

func TestRateLimit(t *testing.T) {
	s := newServer(t, &fakeEngine{res: engine.Result{"ticket_id": "T"}})
	s.Limiter = ratelimit.New(60, 2)
	h := s.Handler()
	for i := 0; i < 2; i++ {
		if rec, _ := do(t, h, "POST", "/api/triage", `{"subject":"x"}`); rec.Code != 200 {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
	}
	rec, out := do(t, h, "POST", "/api/triage", `{"subject":"x"}`)
	if rec.Code != 429 || errCode(out) != "RATE_LIMITED" || rec.Header().Get("Retry-After") == "" {
		t.Errorf("got %d %q retry-after=%q", rec.Code, errCode(out), rec.Header().Get("Retry-After"))
	}
	if rec, _ := do(t, h, "GET", "/api/health", ""); rec.Code != 200 {
		t.Errorf("health should not be rate limited, got %d", rec.Code)
	}
}

func TestHealth(t *testing.T) {
	_, out := do(t, newServer(t, &fakeEngine{mode: "mock"}).Handler(), "GET", "/api/health", "")
	if out["status"] != "ok" || out["mode"] != "mock" || out["engine"] != "mock" {
		t.Errorf("mock health = %v", out)
	}
	_, out = do(t, newServer(t, &fakeEngine{down: true}).Handler(), "GET", "/api/health", "")
	if out["status"] != "degraded" || out["engine"] != "down" {
		t.Errorf("engine-down health = %v", out)
	}
}

func TestInsights(t *testing.T) {
	s := newServer(t, &fakeEngine{})
	os.WriteFile(filepath.Join(s.InsightsDir, "model_insights.json"), []byte(`{"ok":true}`), 0o644)
	os.WriteFile(filepath.Join(s.InsightsDir, "secret.json"), []byte(`{"secret":true}`), 0o644)
	h := s.Handler()
	if rec, out := do(t, h, "GET", "/api/insights/model", ""); rec.Code != 200 || out["ok"] != true {
		t.Errorf("model: %d %s", rec.Code, rec.Body)
	}
	for _, p := range []string{"/api/insights/operations", "/api/insights/secret", "/api/insights/..%2fsecret", "/api/insights/"} {
		if rec, _ := do(t, h, "GET", p, ""); rec.Code != 404 {
			t.Errorf("%s: got %d, want 404", p, rec.Code)
		}
	}
}

func TestStatic(t *testing.T) {
	s := newServer(t, &fakeEngine{})
	h := s.Handler()
	if rec, out := do(t, h, "GET", "/", ""); rec.Code != 404 || errCode(out) != "NOT_FOUND" {
		t.Errorf("unbuilt console: %d %s", rec.Code, rec.Body)
	}
	os.WriteFile(filepath.Join(s.StaticDir, "index.html"), []byte("<html>console</html>"), 0o644)
	os.MkdirAll(filepath.Join(s.StaticDir, "assets"), 0o755)
	os.WriteFile(filepath.Join(s.StaticDir, "assets", "app-123.js"), []byte("js"), 0o644)
	for path, want := range map[string]string{"/": "console", "/board": "console", "/assets/": "console", "/assets/app-123.js": "js"} {
		rec, _ := do(t, h, "GET", path, "")
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("%s: %d %q", path, rec.Code, rec.Body)
		}
	}
	rec, _ := do(t, h, "GET", "/assets/app-123.js", "")
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("assets cache = %q", rec.Header().Get("Cache-Control"))
	}
	if rec, _ := do(t, h, "GET", "/api/nope", ""); rec.Code != 404 || !strings.Contains(rec.Header().Get("Content-Type"), "json") {
		t.Errorf("unknown api route: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestPanicIsRecovered(t *testing.T) {
	s := newServer(t, &fakeEngine{})
	h := s.middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec, out := do(t, h, "GET", "/", "")
	if rec.Code != 500 || errCode(out) != "INTERNAL" {
		t.Errorf("got %d %s", rec.Code, rec.Body)
	}
}
