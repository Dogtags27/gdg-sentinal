# SentinelDesk console (frontend)

React + Vite (JavaScript), Tailwind v4, Recharts, lucide-react icons. Owner: Full-stack dev.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm test           # gate, PII masking, language detection, response checks (node --test)
```

In `npm run dev` the console runs on a built-in **mock engine** (`src/api/mockEngine.js`), so it works with no backend.
To use the Go gateway instead, create `.env.local`:

```
VITE_USE_MOCK=false
```

**Production builds (`npm run build`) always call the gateway.** Demo mode for a deploy is the gateway's
`MOCK_ENGINE` switch (H-06), not the browser mock. Setting `VITE_USE_MOCK=true` at build time is only for an
offline demo build.

Vite proxies `/api/*` to `http://localhost:8080`. To point it elsewhere, set `GATEWAY_URL` in the shell that
runs `npm run dev` (it is read by `vite.config.js`, not from `.env.local`). If you set `VITE_API_BASE` to a full
URL instead, the gateway must allow CORS from the console's origin.

## Views

| Route | View | Tasks |
|---|---|---|
| `#/` | Triage dashboard: KPIs, tabs (Needs action / Escalated / Auto-drafted / Accepted / Rejected / Degraded), sortable table, accept/reject suggestions, bulk actions, "why" details modal | FS-02, FS-05 |
| `#/board` | Kanban board: Incoming → Escalated → Human review → Draft ready → Resolved, drag-and-drop plus a keyboard "move" menu | FS-05 |
| `#/ticket/:id` | Ticket detail: triage suggestions with Apply, escalation gate reasons, text-only draft with citation chips and validation, precedents, latency strip, PII summary | FS-06, FS-07, FS-08 |
| `#/insights` | Insights shell (`pages/InsightsPage.jsx`): live session charts plus the Data analyst's dataset and model view (`features/insights/InsightsTab.jsx`, DA-10). Shared chart components are in `components/charts/` | FS-13 |
| `+` in top bar | New ticket form with sample menu (demo scenarios) | FS-03 |
| Clock in top bar | History drawer | FS-11 |
| "Simulate outage" | Burst of VPN tickets → major-incident banner | FS-10 |

## API (provisional, until `contracts/` v1 is frozen)

All network calls are in `src/api/client.js` (timeouts plus readable `ApiError` messages).

- `GET /api/health` → `{ status: "ok", ... }`
- `POST /api/triage` with `{ subject, body }` → a `TriageResult`. The shape the UI reads is produced by `analyze()` in `mockEngine.js`: `language`, `classification.{type,queue,priority}`, `precedents[]`, `gate.{decision,reasons[]}`, `draft.{text,citations,mode,validation}`, `latency_ms`, `pii.masked`.

When the contract lands, adapt it in `client.js` and keep field names in `lib/constants.js`.
