# ml/ — split, classifiers, RAG index (ML-01..14, DA-03/04/05)

Run from the repo root (`pip install -r ml/requirements.txt`). Artifacts go to `ml/artifacts/` (gitignored; mirrors the R2 layout).

| Step | Command | Task |
|---|---|---|
| 1. Split (downloads 3 public CSVs from the pinned HF revision) | `python -m ml.split` | ML-02/03/04 |
| 2. Embed KB + test inputs (`GEMINI_API_KEY`; `--backend hash` for offline) | `python -m ml.indexing.embed` | DA-03 |
| 3. Train, calibrate, tune priority threshold | `python -m ml.train` | ML-05/09/10 |
| 4. Retrieval-vote blend weight | `python -m ml.tune_blend` | ML-08 |
| 5. Hierarchical retrieval quality, routing weight, similarity threshold | `python -m ml.indexing.retrieval_quality` | ML-14 |
| 6. Load Redis (idx:chunks + queue nodes), snapshot | `python -m ml.indexing.build_index --url redis://:<pw>@localhost:6379 --snapshot` | ML-08 |
| 7. Holdout metrics (only reader of test labels) | `python -m ml.evaluate --blend` | ML-11 |
| 8. Latency | `python -m ml.latency` | ML-12 |

Offline check: `python -m pytest ml/tests -q` (synthetic data, hash embeddings; the live Redis test runs only when `REDIS_URL` points at a Redis Stack).

## RAG index (Redis, per the root README)
- **Level 2:** one hash per ticket, `chunk:<ticket_id>`, indexed by `idx:chunks` (HNSW, cosine, 768d). Fields: ticket_id, queue, type, priority, subject, body, tags (csv), language, answer, queried_count, vector_embedding (+ `precedent`).
- **Level 1:** one hash per queue, `queue:<slug>` (centroid vector, chunk_count, type_mix, top_tags). Built from KB chunks only.
- **German topic rows** have no answer or type: stored under queue `Miscellaneous` with `precedent=0`; every citation search filters `@precedent:{1}` and routing skips that node.
- **Search** (`engine/app/retrieval/search.py`): global top-10 → route (0.6·classifier prob + 0.4·centroid cosine; top-2 queues, or top-1 if ≥ 0.80) → filtered KNN k=5 → global fallback if routed top-1 is below `min_top1_similarity` or > 0.05 under global top-1.
- **queried_count:** atomic `HINCRBY` on returned chunks and their queue nodes, only with `count=True`. Eval, benchmark and golden runs use `count=False` (`UPDATE_QUERIED_COUNT=false`). Telemetry only, no ranking effect.

Metrics and method (ML-18): see `ml/artifacts/reports/v1/` after a run; summary to be pasted here.
