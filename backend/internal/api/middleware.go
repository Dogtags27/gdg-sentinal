package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"
)

type ctxKey struct{}

var (
	requestSeq atomic.Uint64
	validReqID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	bootPrefix = fmt.Sprintf("%x", time.Now().Unix()&0xffffff)
)

func requestID(r *http.Request) string {
	id, _ := r.Context().Value(ctxKey{}).(string)
	return id
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

// middleware adds a request ID, security headers, panic recovery and one log line per request.
// Ticket text is never logged.
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get("X-Request-ID")
		if !validReqID.MatchString(id) {
			id = fmt.Sprintf("%s-%d", bootPrefix, requestSeq.Add(1))
		}
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, id))
		sw := &statusWriter{ResponseWriter: w}
		h := sw.Header()
		h.Set("X-Request-ID", id)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")

		defer func() {
			if p := recover(); p != nil {
				s.Log.Error("panic", "request_id", id, "panic", fmt.Sprint(p))
				if sw.status == 0 {
					writeError(sw, http.StatusInternalServerError, "INTERNAL", "The gateway hit an internal error.")
				}
			}
			s.Log.Info("request", "request_id", id, "method", r.Method, "path", r.URL.Path, "status", sw.status,
				"bytes", sw.bytes, "ms", float64(time.Since(start).Microseconds())/1000)
		}()
		next.ServeHTTP(sw, r)
	})
}
