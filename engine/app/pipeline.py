"""The triage pipeline: ordered stages, per-stage timing, and failure isolation.

Order (the real flow, see "Retrieval flow per ticket" in the root README):

    language -> global_search -> classify -> route_and_search -> draft -> validate -> gate

* global_search embeds the query once and runs the unfiltered top-10 search. The classifier
  uses those neighbours for its vote; route_and_search uses them as the fallback.
* The gate runs once, after validation, because it needs the draft's grounding result and
  because the burst detector must see each ticket exactly once.
* A stage that raises never fails the request. Its fallback fills in a safe value, a warning
  is added to the response, and the gate routes the ticket to a human.

To replace a stub, point its Stage.run at the real function (same signature:
``fn(state: TicketState) -> None``) and keep the fallback.
"""

from __future__ import annotations

import logging
import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

from pydantic import ValidationError

from engine.app import stubs
from engine.app.generate.fallbacks import fallback_draft
from engine.app.policy.gate import EscalationGate
from engine.app.schemas import (
    CONTRACT_VERSION,
    REASON_SEVERITY,
    EngineTriageRequest,
    EngineTriageResponse,
    Precedent,
)
from engine.app.state import TicketState

log = logging.getLogger("sentineldesk.pipeline")

LATENCY_KEYS = ("language", "classify", "retrieve", "gate", "draft", "validate")
_PRECEDENT_FIELDS = tuple(Precedent.model_fields)


class ContractViolation(RuntimeError):
    """The assembled response does not match contract v1. Always a bug in a stage."""


@dataclass(frozen=True)
class Stage:
    name: str  # shown in /healthz and in warnings
    latency_key: str  # latency_ms key this stage's time is added to
    run: Callable[[TicketState], None]
    fallback: Callable[[TicketState], None]
    owner: str


# --------------------------------------------------------------------------- fallbacks


def _fallback_language(s: TicketState) -> None:
    s.language = {"code": "en", "confidence": 0.0, "supported": True}


def _fallback_global_search(s: TicketState) -> None:
    s.query_embedding = None
    s.global_neighbours = []


def _fallback_classify(s: TicketState) -> None:
    stubs.classify(s)  # flat prior -> LOW_CONFIDENCE -> human review


def _fallback_route_and_search(s: TicketState) -> None:
    s.retrieval = {"route": {"queues": [], "searched": [], "fallback_global": True}, "top_similarity": 0.0, "k": 5}
    s.precedents = []
    s.evidence = {}


def _fallback_draft(s: TicketState) -> None:
    s.llm_failed = True
    s.draft = fallback_draft(s.reply_language, s.precedents, s.evidence)


def _fallback_validate(s: TicketState) -> None:
    d = s.draft or fallback_draft(s.reply_language, s.precedents, s.evidence)
    ok = d["mode"] != "generated"  # holding and extractive drafts are built without the LLM
    d["validation"] = {
        "passed": ok,
        "citations_ok": ok,
        "numbers_ok": ok,
        "language_ok": ok,
        "retries": 0,
        "issues": [] if ok else ["The validator failed, so the draft is treated as ungrounded."],
    }
    s.draft = d


def _fallback_gate(s: TicketState) -> None:
    s.gate = {
        "decision": "HUMAN_REVIEW",
        "reasons": [{"code": "ENGINE_DEGRADED", "severity": "P2", "detail": "The escalation gate failed; routed to human review."}],
    }
    s.burst = None


# --------------------------------------------------------------------------- gate (data analyst's module)

_gate_lock = threading.Lock()  # the burst detector keeps state across requests
_gate = EscalationGate()


def reset_gate(**kwargs: Any) -> None:
    """Fresh gate and burst window. Used by tests; thresholds will come from policy.yaml."""
    global _gate
    with _gate_lock:
        _gate = EscalationGate(**kwargs)


def _iso(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


def run_gate(s: TicketState) -> None:
    cls = s.classification or {}
    draft = s.draft or {}
    with _gate_lock:
        result = _gate.evaluate(
            ticket_id=s.ticket_id,
            text=s.text,
            detected_language=(s.language or {}).get("code", "unknown"),
            pred_type=cls["type"]["label"],
            pred_queue=cls["queue"]["label"],
            prob_high_priority=cls["priority"]["p_high"],
            overall_confidence=min(cls["type"]["confidence"], cls["priority"]["confidence"]),
            top_precedent_similarity=(s.retrieval or {}).get("top_similarity", 0.0),
            is_ungrounded=draft.get("mode") == "generated" and not draft.get("validation", {}).get("passed", False),
            engine_degraded=s.llm_failed,
        )
    details = list(result.explanations) + [""] * (len(result.reasons) - len(result.explanations))
    s.gate = {
        "decision": result.action.value,
        "reasons": [
            {"code": r.value, "severity": REASON_SEVERITY[r.value], "detail": detail}
            for r, detail in zip(result.reasons, details)
        ],
    }
    c = result.burst_cluster
    s.burst = (
        None
        if c is None
        else {
            "cluster_id": c.cluster_id,
            "queue": c.queue,
            "lead_term": c.lead_term,
            "ticket_count": c.ticket_count,
            "first_seen": _iso(c.first_seen),
            "last_seen": _iso(c.last_seen),
        }
    )


# --------------------------------------------------------------------------- stage table

STAGES: tuple[Stage, ...] = (
    Stage("language", "language", stubs.detect_language, _fallback_language, "ML engineer"),
    Stage("global_search", "retrieve", stubs.global_search, _fallback_global_search, "ML engineer"),
    Stage("classify", "classify", stubs.classify, _fallback_classify, "ML engineer"),
    Stage("route_and_search", "retrieve", stubs.route_and_search, _fallback_route_and_search, "ML engineer"),
    Stage("draft", "draft", stubs.draft, _fallback_draft, "Hriday"),
    Stage("validate", "validate", stubs.validate, _fallback_validate, "Hriday"),
    Stage("gate", "gate", run_gate, _fallback_gate, "Data analyst"),
)


def stage_status() -> dict[str, str]:
    return {st.name: "stub" if getattr(st.run, "is_stub", False) else "real" for st in STAGES}


# --------------------------------------------------------------------------- run


def new_request_id() -> str:
    return f"req_{secrets.token_hex(6)}"


def new_ticket_id() -> str:
    return f"LIVE-{secrets.token_hex(4).upper()}"


def run_triage(req: EngineTriageRequest) -> EngineTriageResponse:
    started = perf_counter()
    s = TicketState(
        request_id=req.request_id or new_request_id(),
        ticket_id=req.ticket_id or new_ticket_id(),
        subject=req.subject or "",
        body=req.body,
        created_at=req.created_at or datetime.now(timezone.utc),
    )
    stubbed = [name for name, status in stage_status().items() if status == "stub"]
    if stubbed:
        s.warn("engine", "STUB_STAGES", "These stages are stubs: " + ", ".join(stubbed))

    for stage in STAGES:
        t0 = perf_counter()
        try:
            stage.run(s)
        except Exception as exc:  # noqa: BLE001 - one broken stage must not fail the request
            log.exception("stage %s failed (request_id=%s)", stage.name, s.request_id)
            s.warn(stage.name, "STAGE_FAILED", f"{type(exc).__name__}: {exc}")
            stage.fallback(s)
        s.latency_ms[stage.latency_key] = s.latency_ms.get(stage.latency_key, 0.0) + (perf_counter() - t0) * 1000

    total = (perf_counter() - started) * 1000
    return _assemble(s, total)


def _assemble(s: TicketState, total_ms: float) -> EngineTriageResponse:
    latency = {k: round(s.latency_ms.get(k, 0.0), 1) for k in LATENCY_KEYS}
    latency["total"] = round(max(total_ms, sum(latency.values())), 1)
    payload = {
        "contract_version": CONTRACT_VERSION,
        "request_id": s.request_id,
        "ticket_id": s.ticket_id,
        "subject": s.subject,
        "body": s.body,
        "created_at": s.created_at,
        "processed_at": max(datetime.now(timezone.utc), s.created_at),
        "language": s.language,
        "classification": s.classification,
        "retrieval": s.retrieval,
        "precedents": [{k: p[k] for k in _PRECEDENT_FIELDS if k in p} for p in s.precedents],
        "gate": s.gate,
        "draft": s.draft,
        "burst": s.burst,
        "latency_ms": latency,
        "warnings": s.warnings,
    }
    try:
        return EngineTriageResponse.model_validate(payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        log.error("response breaks contract v1 (request_id=%s): %s", s.request_id, exc)
        raise ContractViolation(f"Engine response breaks contract v1 at {where}: {first['msg']}") from exc
