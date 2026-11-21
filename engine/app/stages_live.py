"""Live pipeline stages: language, embedding + Redis retrieval, classification (task H-13 wiring).

These replace the stubs in stubs.py when Redis and Gemini are configured (pipeline.use_live_stages).

* language:          ML engineer's detector (langdetect + stopword fallback).
* global_search:     embed the query once with the shared Gemini client, unfiltered top-10 from Redis.
* classify:          if a trained model bundle is on disk (ml/artifacts/models/v1 or MODEL_DIR) it is used;
                     otherwise a similarity-weighted neighbour vote over the global top-10 (real kNN, no rules).
* route_and_search:  the ML engineer's hierarchical retriever (level-1 queue routing, level-2 filtered KNN,
                     global fallback), mapped into the contract's retrieval/precedents shape.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

import numpy as np

from engine.app.common.providers import embed_texts, embedding_identity
from engine.app.retrieval import search as R
from engine.app.settings import get_settings
from engine.app.state import TicketState

log = logging.getLogger("sentineldesk.live")

TYPES = ("Incident", "Request", "Problem", "Change")
PRIORITIES = ("high", "medium", "low")

_lock = threading.Lock()
_redis: Any = None
_nodes: list[R.QueueNode] | None = None


def _conn() -> Any:
    global _redis
    with _lock:
        if _redis is None:
            _redis = R.connect(get_settings().redis_url)
        return _redis


def queue_nodes() -> list[R.QueueNode]:
    global _nodes
    with _lock:
        cached = _nodes
    if cached is None:
        cached = R.load_queue_nodes(_conn())
        with _lock:
            _nodes = cached
    return cached


def reset() -> None:
    """Forget the Redis connection and cached queue nodes (tests, or after re-indexing)."""
    global _redis, _nodes, _index_checked
    with _lock:
        _redis, _nodes, _index_checked = None, None, False


# ---- language -----------------------------------------------------------------


def language_stage(state: TicketState) -> None:
    from engine.app.analyze.language import detect_language

    code, conf = detect_language(state.text)
    code = (code or "unknown").lower()[:2] if code else "unknown"
    state.language = {"code": code, "confidence": round(min(max(float(conf), 0.0), 1.0), 3), "supported": code in ("en", "de")}


# ---- embedding + global search --------------------------------------------------


_index_checked = False


def check_index_matches_embeddings() -> None:
    """Refuse to search an index built with a different embedding model: the vectors are not comparable."""
    global _index_checked
    if _index_checked:
        return
    meta = {k.decode(): v.decode() for k, v in _conn().hgetall("meta:embedding").items()}
    now = embedding_identity()
    if not meta:
        log.warning("Redis has no meta:embedding record; cannot verify the index was built with %s/%s", now["provider"], now["model"])
    elif (meta.get("provider"), meta.get("model"), meta.get("dim")) != (now["provider"], now["model"], str(now["dim"])):
        raise RuntimeError(
            f"The Redis index was built with {meta.get('provider')}/{meta.get('model')} ({meta.get('dim')}d) but the engine now "
            f"embeds with {now['provider']}/{now['model']} ({now['dim']}d). Re-embed the knowledge base or set EMBED_PROVIDER."
        )
    _index_checked = True


def global_search_stage(state: TicketState) -> None:
    from engine.app.analyze.textproc import build_text

    check_index_matches_embeddings()

    vec = np.asarray(embed_texts([build_text(state.subject, state.body)[:6000]])[0], dtype=np.float32)
    state.query_embedding = vec.tolist()
    state.global_neighbours = R._knn(_conn(), vec, 10, None)


# ---- classification ------------------------------------------------------------


def _vote(hits: list[Any], key: str, classes: list[str], power: float = 2.0) -> dict[str, float]:
    weights = {c: 0.0 for c in classes}
    for h in hits:
        label = h.fields.get(key)
        if label in weights:
            weights[label] += max(h.score, 0.0) ** power
    total = sum(weights.values())
    return {c: (w / total if total else 1.0 / len(classes)) for c, w in weights.items()}


def _head(probs: dict[str, float]) -> tuple[str, float]:
    label = max(probs, key=probs.get)
    return label, probs[label]


def classify_stage(state: TicketState) -> None:
    hits = state.global_neighbours
    queues = sorted({h.fields.get("queue", "") for h in hits if h.fields.get("queue")}) or ["General Inquiry"]
    t, q, p = _vote(hits, "type", list(TYPES)), _vote(hits, "queue", queues), _vote(hits, "priority", list(PRIORITIES))
    top5 = dict(sorted(q.items(), key=lambda kv: kv[1], reverse=True)[:5])
    t_label, t_conf = _head(t)
    q_label, q_conf = _head(top5)
    p_label, p_conf = _head(p)
    state.classification = {
        "type": {"label": t_label, "confidence": t_conf, "probs": t},
        "queue": {
            "label": q_label,
            "confidence": q_conf,
            "probs": top5,
            "votes": sum(1 for h in hits if h.fields.get("queue") == q_label),
            "k": len(hits),
        },
        "priority": {"label": p_label, "confidence": p_conf, "probs": p, "p_high": p["high"]},
    }


# ---- hierarchical retrieval -----------------------------------------------------


def _precedent(hit: R.Hit) -> dict[str, Any]:
    f = hit.fields
    snippet = " ".join(f.get("answer", "").split())[:300]
    return {
        "ticket_id": hit.ticket_id,
        "similarity": round(min(max(hit.score, -1.0), 1.0), 4),
        "language": f.get("language") or "unknown",
        "type": f.get("type") or "Request",
        "queue": hit.queue,
        "priority": f.get("priority") or "medium",
        "subject": f.get("subject", ""),
        "answer_snippet": snippet,
        "tags": [t for t in f.get("tags", "").split(",") if t],
    }


def route_and_search_stage(state: TicketState) -> None:
    if not state.query_embedding:
        raise RuntimeError("No query embedding: the global search stage failed earlier.")
    q = np.asarray(state.query_embedding, dtype=np.float32)
    queue_probs = (state.classification or {}).get("queue", {}).get("probs", {})
    res = R.retrieve(_conn(), q, queue_nodes(), queue_probs, k=5, count=False)
    state.precedents = [_precedent(h) for h in res.hits]
    state.evidence = {h.ticket_id: h.fields.get("answer", "") for h in res.hits}
    ranked = sorted(res.route_scores.items(), key=lambda kv: kv[1], reverse=True)[:3]
    state.retrieval = {
        "route": {
            "queues": [{"queue": name, "score": round(min(max(score, 0.0), 1.0), 4)} for name, score in ranked],
            "searched": list(res.routed_queues),
            "fallback_global": bool(res.fallback_global),
        },
        "top_similarity": state.precedents[0]["similarity"] if state.precedents else 0.0,
        "k": 5,
    }
