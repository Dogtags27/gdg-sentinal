"""
DA-09: Merge holdout_metrics.json into model_insights.json for the Insights tab.

After running holdout eval with --export-insights:
  python3 ../src/evaluate_holdout.py --export-insights
  python3 analytics/export_model_insights.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
INSIGHTS_DIR = BASE_DIR / "analytics" / "insights"
FRONTEND_INSIGHTS_DIR = BASE_DIR / "frontend" / "src" / "features" / "insights" / "data"
HOLDOUT_METRICS = INSIGHTS_DIR / "holdout_metrics.json"

DEFAULT_MODEL = {
    "architecture": {
        "classifier": "Sublinear Multilingual TF-IDF (35k dim) + Calibrated Logistic Regression",
        "embeddings": "all-MiniLM-L6-v2 (384 dim, normalized)",
        "vector_store": "Serialized NumPy Cosine Index / Qdrant Snapshot",
        "llm_draft_model": "Gemini 1.5 Flash (Deterministic Precedent Fallback)",
    },
    "holdout_benchmark": {
        "eval_sample_size": 4000,
        "metrics": {
            "type_macro_f1": 0.8306,
            "type_weighted_f1": 0.8205,
            "queue_macro_f1": 0.4247,
            "queue_weighted_f1": 0.4585,
            "priority_macro_f1": 0.5384,
            "priority_weighted_f1": 0.5516,
            "high_priority_incident_recall": 0.8520,
            "high_priority_incident_precision": 0.5027,
        },
        "latency": {
            "triage_inference_per_ticket_ms": 1.11,
            "precedent_retrieval_ms": 270.9,
            "grounded_synthesis_ms": 0.04,
            "total_e2e_latency_ms": 272.05,
        },
    },
    "safety_gate_policy": {
        "high_priority_threshold": 0.38,
        "confidence_floor": 0.42,
        "precedent_similarity_threshold": 0.28,
        "p1_codes": ["HIGH_PRIORITY_INCIDENT", "SECURITY_INCIDENT", "ACTIVE_OUTAGE"],
        "p2_codes": [
            "LEGAL_OR_COMPLIANCE",
            "PROMPT_INJECTION",
            "NO_PRECEDENT",
            "LOW_CONFIDENCE",
            "UNSUPPORTED_REQUEST",
            "UNGROUNDED_DRAFT",
            "UNSUPPORTED_LANGUAGE",
            "ENGINE_DEGRADED",
        ],
    },
}


def load_existing_model() -> dict:
    path = FRONTEND_INSIGHTS_DIR / "model_insights.json"
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    return json.loads(json.dumps(DEFAULT_MODEL))


def merge_holdout(base: dict, holdout: dict) -> dict:
    out = json.loads(json.dumps(base))
    out["metrics_source"] = "holdout_eval"
    out["generated_at"] = holdout.get("generated_at")
    out["holdout_benchmark"]["eval_sample_size"] = holdout.get("eval_sample_size", out["holdout_benchmark"]["eval_sample_size"])
    out["holdout_benchmark"]["metrics"].update(holdout.get("metrics", {}))
    if "latency" in holdout:
        triage = holdout["latency"].get("triage_inference_per_ticket_ms")
        if triage is not None:
            out["holdout_benchmark"]["latency"]["triage_inference_per_ticket_ms"] = triage
    return out


def write_mirrors(model: dict) -> None:
    for target in (INSIGHTS_DIR, FRONTEND_INSIGHTS_DIR):
        target.mkdir(parents=True, exist_ok=True)
        path = target / "model_insights.json"
        path.write_text(json.dumps(model, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {path}")


def main() -> int:
    if not HOLDOUT_METRICS.is_file():
        print(f"Missing {HOLDOUT_METRICS}")
        print("Run: python3 5-AProject-SSC/00_SentinelDesk/src/evaluate_holdout.py --export-insights")
        return 1
    holdout = json.loads(HOLDOUT_METRICS.read_text(encoding="utf-8"))
    model = merge_holdout(load_existing_model(), holdout)
    write_mirrors(model)
    print("model_insights.json updated from holdout eval.")
    return 0


if __name__ == "__main__":
    sys.exit(main())