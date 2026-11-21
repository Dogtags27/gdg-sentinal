# SentinelDesk gateway (backend)

Go 1.22+, standard library only. Owner: Full-stack dev. The console talks only to this gateway; the Python
engine (:8000) and Redis stay private.

```bash
cd backend
go test ./...
go run ./cmd/gateway            # http://localhost:8080, mock engine by default
```

To get the whole app from the gateway, build the console first (`cd frontend && npm run build`); the
gateway serves `../frontend/dist`. For the Vite dev server instead, put `VITE_USE_MOCK=false` in
`frontend/.env.local`; Vite proxies `/api/*` to :8080.

## What it does

| Task | Where |
|---|---|
| FS-02 skeleton: routing, validation, request IDs, JSON logs, panic recovery, graceful shutdown | `cmd/gateway`, `internal/api` |
| FS-03 mock mode (`MOCK_ENGINE=true`): deterministic results in the console's shape, burst detection like `engine/app/policy/burst.py` | `internal/engine/mock.go` |
| FS-08 real engine (`MOCK_ENGINE=false`): forwards masked tickets to `ENGINE_URL` with a timeout and readable errors | `internal/engine/client.go` |
| FS-15 PII guardrail: emails, IBANs, card and phone numbers are masked before the engine sees the text | `internal/pii` |
| FS-16 serves the built console and the Insights JSON | `internal/api/server.go` |
| FS-17 per-client rate limit on triage | `internal/ratelimit` |

## API (provisional until `contracts/` v1)

| Route | Notes |
|---|---|
| `GET /api/health` | `{"status":"ok"\|"degraded","mode":"mock"\|"engine","engine":"mock"\|"ok"\|"down","pii_masking":"on"}` |
| `POST /api/triage` | Body `{"subject","body"}`, at least one non-empty, subject ≤ 300 and body ≤ 8,000 characters, request ≤ 64 KB. Returns the engine's TriageResult with `subject`/`body` replaced by the masked text, `pii.masked` and `latency_ms.gateway` added, and a `ticket_id` (`GW-…`) if the engine sent none |
| `GET /api/insights/{operations\|model}` | `operations_insights.json` / `model_insights.json` from `INSIGHTS_DIR` |
| everything else | the built console; unknown paths get `index.html` |

Errors are always `{"error":{"code","message"}}`, which the console shows as-is:

| Status | Code | When |
|---|---|---|
| 400 | `BAD_JSON`, `VALIDATION` | malformed body, empty ticket, too long |
| 413 | `TOO_LARGE` | request over 64 KB |
| 429 | `RATE_LIMITED` | over the limit; `Retry-After` is set |
| 502 | `ENGINE_ERROR`, `ENGINE_BAD_RESPONSE` | engine returned an error or non-JSON |
| 503 | `ENGINE_UNAVAILABLE` | engine not reachable |
| 504 | `ENGINE_TIMEOUT` | engine slower than `ENGINE_TIMEOUT` |

The gateway calls the engine at `POST {ENGINE_URL}/triage` with `{"subject","body"}` (already masked) and
`GET {ENGINE_URL}/health`. These paths are provisional; change them in `internal/engine/client.go` when the
contract is frozen.

## Settings

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `MOCK_ENGINE` | `true` | `false` to call the Python engine |
| `ENGINE_URL` | `http://localhost:8000` | `http://engine:8000` in docker-compose |
| `ENGINE_TIMEOUT` | `18s` | kept under the console's 20 s timeout |
| `STATIC_DIR` | `../frontend/dist` | empty string turns static serving off |
| `INSIGHTS_DIR` | `../analytics/insights` | |
| `RATE_LIMIT_PER_MIN` | `60` | per client IP; `0` turns it off |
| `RATE_LIMIT_BURST` | `10` | requests allowed at once |
| `TRUST_PROXY` | `false` | `true` only behind our own reverse proxy, to read `X-Forwarded-For` |

Ticket text is never logged; log lines carry the request ID, path, status and timing.
