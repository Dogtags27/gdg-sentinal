# SentinelDesk: 5-Hour Build Plan

Multilingual (EN/DE) incident triage, escalation gate and precedent-grounded reply drafts, built on the `Tobi-Bueck/customer-support-tickets` dataset.

Live task board with clock: https://claude.ai/artifact/FfMrw1sFKRgkVcVVhUYtX2

## Stack (locked)

| Part | Choice |
|---|---|
| Frontend | React + Vite (JavaScript), Tailwind, Recharts |
| Gateway | Go 1.22+ (stdlib `ServeMux`): validation, PII masking, timing |
| Engine | Python FastAPI: language detection, classify, retrieve, gate, draft, validate |
| Vector DB | **Qdrant** (Docker, next to the engine). Runner-up: pgvector. Fallback: FAISS |
| Embeddings | `gemini-embedding-2`, 768 dims, same settings for KB and live queries |
| Draft model | Current Gemini Flash, set in `GEN_MODEL` |
| Classifier | TF-IDF + logistic regression, blended with retrieval votes, temperature-calibrated |
| Storage | Cloudflare R2 for raw CSV, splits, embeddings, models, Qdrant snapshot, reports |
| Deploy | AWS EC2 + docker-compose. **Hriday only** |

Why Qdrant: payload filters (language, queue, type), snapshot to R2 and restore in seconds, same container on laptops and AWS, built-in dashboard for debugging retrieval.

## Flow

React console → Go gateway (validate, mask PII) → Python engine → language → classify → retrieve top-k from Qdrant → gate → grounded draft → validate citations and numbers → final gate + burst check.

## Team and folders

| Person | Role | Owns |
|---|---|---|
| Hriday | Lead, Go gateway, RAG drafting, **all deploys** | `contracts/`, `infra/`, `backend/`, `engine/app/{main,pipeline,generate}` |
| Full-stack dev | React console, Go PII guardrail | `frontend/`, `backend/internal/pii/` |
| Data analyst | EDA, indexing, escalation policy, Insights charts | `analytics/`, `ml/indexing/`, `engine/app/policy/`, `frontend/src/features/insights/` |
| ML engineer | Split, classifiers, calibration, evaluation | `ml/`, `engine/app/analyze/` |
| QA | Test plan, golden set, audits, demo script (no code) | `qa/`, `docs/demo-script.md` |

Rules:
- Commit only inside your own folders.
- `git pull --rebase` every 30 minutes; push small commits.
- Contract changes go through Hriday.
- Never commit `.env`, data or model files. They live in R2.

## Timeline

| Time | Phase | Check-in |
|---|---|---|
| 0:00–0:25 | Kickoff and contracts | Repo, contract, keys, local Qdrant exist |
| 0:25–1:30 | Foundations | **Sync 1 (1:30):** mock UI through Go, split in R2, KB embedded, first macro-F1, skeleton live on AWS |
| 1:30–3:00 | Core build | **Sync 2 (3:00):** real pipeline end to end |
| 3:00–4:00 | Integrate, evaluate, bonus | **Sync 3 (4:00):** deployed v2, golden-set pass rate, holdout metrics, cut scope |
| 4:00–4:30 | Harden and freeze | Final deploy by 4:15, **code freeze 4:20** |
| 4:30–5:00 | Demo prep | Rehearsal 1 at 4:30, rehearsal 2 at 4:45, demo at 5:00 |

## Tasks

### Everyone
- [ ] ALL-01 Kickoff: walk the plan, contract, folder ownership (0:00)
- [ ] ALL-02 Code freeze at 4:20
- [ ] ALL-03 Rehearsal 1 at 4:30, timed
- [ ] ALL-04 Rehearsal 2 at 4:45, then submit

### Hriday
- [ ] H-01 Create repo and folder skeleton
- [ ] H-02 Freeze API contract v1 (**critical**)
- [ ] H-03 API keys, billing, R2 bucket (**critical**)
- [ ] H-04 Local Qdrant via docker-compose
- [ ] H-05 Go gateway skeleton (**critical**)
- [ ] H-06 Mock mode so the UI is never blocked
- [ ] H-07 Engine skeleton and pipeline stubs (**critical**)
- [ ] H-08 Walking-skeleton deploy on AWS (by 1:30)
- [ ] H-09 Draft generation with Gemini (**critical**)
- [ ] H-10 Grounding prompt (**critical**)
- [ ] H-11 Draft validator (**critical**)
- [ ] H-12 Degraded mode when the LLM fails
- [ ] H-13 Point the gateway at the real engine
- [ ] H-14 Deploy v2 with the real pipeline (by 3:15, **critical**)
- [ ] H-15 Run the 3:00 sync and cut scope
- [ ] H-16 Final production deploy (by 4:15, **critical**)
- [ ] H-17 Top-level README

### Full-stack dev
- [ ] FS-01 Scaffold the React app
- [ ] FS-02 App shell with health indicator
- [ ] FS-03 Ticket input panel with sample menu
- [ ] FS-04 API client with timeouts and readable errors
- [ ] FS-05 Classification cards and escalation badge
- [ ] FS-06 Precedents panel
- [ ] FS-07 Draft panel (text only, never inject HTML)
- [ ] FS-08 Latency strip
- [ ] FS-09 Integrate with the real gateway (**critical**)
- [ ] FS-10 Major-incident banner and "Simulate outage" button (bonus)
- [ ] FS-11 History drawer
- [ ] FS-12 PII guardrail in the Go gateway (bonus)
- [ ] FS-13 Insights tab shell and shared chart components
- [ ] FS-14 Polish and edge states

### Data analyst
- [ ] DA-01 Pull the raw CSV, open the EDA notebook
- [ ] DA-02 EDA with JSON exports for the Insights tab
- [ ] DA-03 Embed the knowledge base (**critical**, by 1:30)
- [ ] DA-04 Load the Qdrant collection and snapshot it (**critical**)
- [ ] DA-05 Retrieval quality and similarity threshold (**critical**)
- [ ] DA-06 Escalation gate in `engine/app/policy/gate.py` (**critical**)
- [ ] DA-07 Keyword lists for injection, money, security, legal (EN + DE)
- [ ] DA-08 Outage burst detector (bonus)
- [ ] DA-09 Insights exports: model and operations
- [ ] DA-10 Insights charts in React (with Full-stack)
- [ ] DA-11 Slide visuals and architecture diagram

### ML engineer
- [ ] ML-01 Python environments for `ml/` and `engine/`
- [ ] ML-02 Load the exact dataset file, inspect labels (**critical**)
- [ ] ML-03 Lock the 80/20 split as the brief specifies (**critical**, by 0:45)
- [ ] ML-04 Clean text, normalise labels
- [ ] ML-05 Baseline classifiers for type, queue, priority (**critical**)
- [ ] ML-06 Language detection
- [ ] ML-07 Engine: real classify and retrieve stages (**critical**)
- [ ] ML-08 Retrieval-vote ensemble
- [ ] ML-09 Confidence calibration
- [ ] ML-10 Priority threshold tuned for high-priority recall (**critical**)
- [ ] ML-11 Holdout evaluation script (**critical**)
- [ ] ML-12 Latency benchmark
- [ ] ML-13 Generation audit sample (with QA)
- [ ] ML-14 README: metrics and method

### QA
- [ ] QA-01 Bug tracker, labels, shared test sheet
- [ ] QA-02 Golden test set: 30 unseen tickets with expected outcomes (**critical**)
- [ ] QA-03 Test plan
- [ ] QA-04 Review the contract from the operator's side
- [ ] QA-05 Test the deployed mock UI
- [ ] QA-06 Hallucination audit rubric
- [ ] QA-07 Run the golden set on the real pipeline (**critical**)
- [ ] QA-08 Score 15 drafts with the rubric
- [ ] QA-09 Leakage audit sign-off
- [ ] QA-10 Demo script draft
- [ ] QA-11 Final regression and backup video (**critical**)
- [ ] QA-12 Judge Q&A sheet

### Stretch (only if ahead)
- [ ] SX-01 Stream results with server-sent events (Hriday)
- [ ] SX-02 Hybrid retrieval, BM25 + dense (ML)
- [ ] SX-03 UMAP ticket map (Data analyst)
- [ ] SX-04 Operator feedback on drafts (Full-stack)
- [ ] SX-05 Fine-tuned multilingual encoder (ML)
- [ ] SX-06 Cost per ticket (Hriday)

Full details, "done when" checks and dependencies for each task are on the live board.

## Escalation gate

Any P1 reason → **ESCALATE_ONCALL**. Else any P2 reason → **HUMAN_REVIEW**. No reasons → **AUTO_DRAFT**. All matching reasons are returned.

| Code | Severity | Fires when |
|---|---|---|
| HIGH_PRIORITY_INCIDENT | P1 | Type is Incident and P(high) is above the recall-tuned threshold |
| SECURITY_INCIDENT | P1 | Breach, ransomware, hacked terms (EN/DE) |
| ACTIVE_OUTAGE | P1 | Ticket joins an active burst cluster |
| LEGAL_OR_COMPLIANCE | P2 | Lawyer, lawsuit, GDPR/DSGVO, deletion requests |
| PROMPT_INJECTION | P2 | Injection patterns in subject or body |
| NO_PRECEDENT | P2 | Top-1 similarity below threshold |
| LOW_CONFIDENCE | P2 | Calibrated confidence below floor |
| UNSUPPORTED_REQUEST | P2 | Refund, compensation, pricing, contract terms, or model flags it |
| UNGROUNDED_DRAFT | P2 | Validator still fails after one retry |
| UNSUPPORTED_LANGUAGE | P2 | Language is not English or German |
| ENGINE_DEGRADED | P2 | LLM failed; extractive fallback used |

## Data and leakage rules

- Use the brief's split exactly: `sample(frac=1.0, random_state=42)`, IDs `TKT-{i:05d}`, first 80% is the KB.
- Only the 80% KB gets indexed or trained on. `kb_val` (last 10% of KB) is used for tuning and calibration.
- The 20% test set keeps only `ticket_id`, `subject`, `body` for inference. Its `answer` column is dropped and never saved. Labels are read only by the final scorer.
- Some dataset copies have 5 priority levels. Map them to high/medium/low and document the mapping.

## R2 layout

```
sentineldesk-artifacts/
  raw/        original CSV
  splits/v1/  kb_train, test_inputs, test_labels, split_manifest.json
  embeddings/v1/  kb_768, test_768
  models/v1/  classifiers, labels, calibration, thresholds
  qdrant/     kb_tickets_v1.snapshot
  reports/v1/ metrics, latency, insights JSON
```

## Ports

5173 React dev, 8080 Go gateway, 8000 Python engine (private), 6333 Qdrant (private).

## Env vars

```
GEMINI_API_KEY=
EMBED_MODEL=gemini-embedding-2
EMBED_DIM=768
GEN_MODEL=
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=kb_tickets_v1
POLICY_PATH=config/policy.yaml
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=sentineldesk-artifacts
ENGINE_URL=http://engine:8000
MOCK_ENGINE=true
PORT=8080
```

## Top risks

- **Embedding quota:** turn on Gemini billing before kickoff; checkpoint embeddings every ~2,000 rows; fall back to `gemini-embedding-001`.
- **Data leakage:** one split script, QA audit (QA-09).
- **Gemini down on stage:** 8 s timeout, extractive fallback, backup demo video.
- **Cold start:** load models at boot; warm-up request after every deploy.
- **Merge conflicts:** folder ownership, pull every 30 minutes.

## 5-minute demo

| Time | Segment |
|---|---|
| 0:00–0:30 | Problem and architecture |
| 0:30–1:30 | German hospital VPN outage → escalate to on-call, German draft held for review |
| 1:30–2:20 | English password reset → auto-draft with citations and latency |
| 2:20–3:00 | Refund demand with prompt injection → human review, no promised refund |
| 3:00–3:30 | Simulate outage → major-incident banner |
| 3:30–4:30 | Holdout metrics: macro-F1, high-priority incident recall, calibration, latency |
| 4:30–5:00 | Safeguards and next steps |
