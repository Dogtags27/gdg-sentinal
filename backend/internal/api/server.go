// Package api is the gateway's HTTP surface: the console talks only to these routes.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Dogtags27/gdg-sentinal/backend/internal/engine"
	"github.com/Dogtags27/gdg-sentinal/backend/internal/pii"
	"github.com/Dogtags27/gdg-sentinal/backend/internal/ratelimit"
)

// Input limits match the console's ticket form.
const (
	maxRequestBytes = 64 << 10
	maxSubjectRunes = 300
	maxBodyRunes    = 8000
)

// Insights files the console may request; anything else is a 404, so no path ever reaches the disk.
var insightsFiles = map[string]string{
	"operations": "operations_insights.json",
	"model":      "model_insights.json",
}

type Server struct {
	Engine      engine.Engine
	Limiter     *ratelimit.Limiter
	StaticDir   string
	InsightsDir string
	TrustProxy  bool
	Log         *slog.Logger
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("POST /api/triage", s.triage)
	mux.HandleFunc("GET /api/insights/{name}", s.insights)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "No such API route.")
	})
	mux.Handle("/", s.static())
	return s.middleware(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"status": "ok", "mode": s.Engine.Mode(), "engine": "ok", "pii_masking": "on"}
	if s.Engine.Mode() == "mock" {
		out["engine"] = "mock"
	} else if err := s.Engine.Health(r.Context()); err != nil {
		out["status"], out["engine"] = "degraded", "down"
	}
	writeJSON(w, http.StatusOK, out)
}

type triageRequest struct {
	Subject *string `json:"subject"`
	Body    *string `json:"body"`
}

func (s *Server) triage(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	if ok, wait := s.Limiter.Allow(s.clientIP(r)); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many triage requests. Wait a moment and try again.")
		return
	}

	var in triageRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBytes))
	if err := dec.Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "TOO_LARGE", "The ticket is too large.")
			return
		}
		writeError(w, http.StatusBadRequest, "BAD_JSON", `Send JSON like {"subject": "...", "body": "..."}.`)
		return
	}
	subject, body := strings.TrimSpace(deref(in.Subject)), strings.TrimSpace(deref(in.Body))
	switch {
	case !utf8.ValidString(subject) || !utf8.ValidString(body):
		writeError(w, http.StatusBadRequest, "VALIDATION", "The ticket text is not valid UTF-8.")
		return
	case subject == "" && body == "":
		writeError(w, http.StatusBadRequest, "VALIDATION", "Add a subject or a body.")
		return
	case utf8.RuneCountInString(subject) > maxSubjectRunes:
		writeError(w, http.StatusBadRequest, "VALIDATION", "The subject is longer than 300 characters.")
		return
	case utf8.RuneCountInString(body) > maxBodyRunes:
		writeError(w, http.StatusBadRequest, "VALIDATION", "The body is longer than 8,000 characters.")
		return
	}

	// PII never leaves the gateway: the engine, its logs and the LLM only see the masked text.
	subject, se := pii.Mask(subject)
	body, be := pii.Mask(body)
	masked := pii.Merge(se, be)

	engineStart := time.Now()
	res, err := s.Engine.Triage(r.Context(), engine.Request{Subject: subject, Body: body})
	engineTime := time.Since(engineStart)
	if err != nil {
		s.engineError(w, r, err)
		return
	}

	if id, _ := res["ticket_id"].(string); id == "" {
		res["ticket_id"] = "GW-" + requestID(r)
	}
	res["subject"], res["body"] = subject, body
	res["pii"] = map[string]any{"masked": masked}
	gatewayMS := float64(time.Since(start)-engineTime) / float64(time.Millisecond)
	lat, _ := res["latency_ms"].(map[string]any)
	if lat == nil {
		lat = map[string]any{}
	}
	lat["gateway"] = gatewayMS
	if total, ok := lat["total"].(float64); ok {
		lat["total"] = total + gatewayMS
	} else {
		lat["total"] = float64(time.Since(start)) / float64(time.Millisecond)
	}
	res["latency_ms"] = lat
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) engineError(w http.ResponseWriter, r *http.Request, err error) {
	if e, ok := engine.AsError(err); ok {
		if e.Status >= 500 {
			s.Log.Warn("engine error", "request_id", requestID(r), "code", e.Code, "err", err)
		}
		writeError(w, e.Status, e.Code, e.Message)
		return
	}
	s.Log.Error("triage failed", "request_id", requestID(r), "err", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL", "The gateway hit an internal error.")
}

func (s *Server) insights(w http.ResponseWriter, r *http.Request) {
	file, ok := insightsFiles[r.PathValue("name")]
	if !ok {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "Unknown insights export.")
		return
	}
	raw, err := os.ReadFile(filepath.Join(s.InsightsDir, file))
	if err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "That insights export has not been generated yet.")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(raw)
}

// static serves the built console. Hashed files under /assets/ are cached for a year; everything else,
// including index.html, is revalidated so a deploy shows up on the next load.
func (s *Server) static() http.Handler {
	if s.StaticDir == "" {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "Static serving is off (STATIC_DIR is empty).")
		})
	}
	files := http.FileServer(http.Dir(s.StaticDir))
	index := filepath.Join(s.StaticDir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(index); err != nil {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "The console is not built. Run npm run build in frontend/.")
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		clean := filepath.Join(s.StaticDir, filepath.FromSlash(filepath.Clean("/"+r.URL.Path)))
		if info, err := os.Stat(clean); err != nil || info.IsDir() && r.URL.Path != "/" {
			// Unknown paths get the app shell (the console routes with #/ so this is rare).
			http.ServeFile(w, r, index)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func (s *Server) clientIP(r *http.Request) string {
	if s.TrustProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError uses the {"error": {"code", "message"}} shape the console's API client reads.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
