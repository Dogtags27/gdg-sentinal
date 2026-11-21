"""Shared ticket store, so incident managers see the tickets creators submit (from any browser).

Each triaged ticket is kept in Redis for 7 days: the engine's response (text is already PII-masked
by the gateway) plus a workflow status the manager can change. Creators only ever get the minimal
status view of their own ticket id; managers get the list.

Keys (separate from the knowledge base's chunk:/queue: keys):
    live:ticket:<id>   JSON triage result          live:status:<id>   workflow status
    live:tickets       sorted set of ids by creation time (newest kept, capped)
Warm-up tickets (WARMUP-...) are never stored.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from typing import Any

from engine.app.common.chunk_stats import get_redis

log = logging.getLogger("sentineldesk.tickets")

TTL_SECONDS = 7 * 24 * 3600
MAX_TICKETS = 2000
STATUSES = ("new", "escalated", "review", "drafted", "resolved")
STATUS_FROM_DECISION = {"ESCALATE_ONCALL": "escalated", "HUMAN_REVIEW": "review", "AUTO_DRAFT": "drafted"}
INDEX = "live:tickets"


class StoreUnavailable(RuntimeError):
    pass


def _key(kind: str, ticket_id: str) -> str:
    return f"live:{kind}:{ticket_id}"


def _client(client: Any = None) -> Any:
    c = client or get_redis()
    if c is None:
        raise StoreUnavailable("The ticket store needs Redis (REDIS_URL).")
    return c


def _text(v: Any) -> str:
    return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)


def save(result: dict[str, Any], client: Any = None) -> bool:
    """Store one triage result. Never raises: the store must not break triage."""
    tid = str(result.get("ticket_id", ""))
    if not tid or tid.upper().startswith("WARMUP-"):
        return False
    try:
        c = _client(client)
        created = datetime.fromisoformat(str(result["created_at"]).replace("Z", "+00:00")).timestamp()
        status = STATUS_FROM_DECISION.get(result.get("gate", {}).get("decision", ""), "new")
        pipe = c.pipeline(transaction=False)
        pipe.set(_key("ticket", tid), json.dumps(result, ensure_ascii=False), ex=TTL_SECONDS)
        pipe.set(_key("status", tid), status, ex=TTL_SECONDS, nx=True)
        pipe.zadd(INDEX, {tid: created})
        pipe.zremrangebyrank(INDEX, 0, -MAX_TICKETS - 1)
        pipe.zremrangebyscore(INDEX, 0, time.time() - TTL_SECONDS)
        pipe.execute()
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("ticket store save failed: %s: %s", type(exc).__name__, exc)
        return False


def recent(limit: int = 200, client: Any = None) -> list[dict[str, Any]]:
    """Newest first, full triage results plus their workflow status (managers)."""
    c = _client(client)
    ids = [_text(i) for i in c.zrevrange(INDEX, 0, max(1, min(limit, MAX_TICKETS)) - 1)]
    if not ids:
        return []
    pipe = c.pipeline(transaction=False)
    for tid in ids:
        pipe.get(_key("ticket", tid))
        pipe.get(_key("status", tid))
    raw = pipe.execute()
    out = []
    for i in range(0, len(raw), 2):
        if raw[i] is None:
            continue  # expired
        item = json.loads(_text(raw[i]))
        item["status"] = _text(raw[i + 1]) if raw[i + 1] is not None else "new"
        out.append(item)
    return out


def status_view(ticket_id: str, client: Any = None) -> dict[str, Any] | None:
    """What a ticket creator may see about their own ticket: no scores, reasons, precedents or drafts."""
    c = _client(client)
    doc, status = c.get(_key("ticket", ticket_id)), c.get(_key("status", ticket_id))
    if doc is None:
        return None
    t = json.loads(_text(doc))
    return {
        "ticket_id": t["ticket_id"],
        "subject": t.get("subject", ""),
        "created_at": t.get("created_at"),
        "status": _text(status) if status is not None else "new",
    }


def set_status(ticket_id: str, status: str, client: Any = None) -> dict[str, Any] | None:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}")
    c = _client(client)
    if c.get(_key("ticket", ticket_id)) is None:
        return None
    c.set(_key("status", ticket_id), status, ex=TTL_SECONDS)
    return status_view(ticket_id, client=c)
