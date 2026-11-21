"""
DA-08: Outage Burst Detector (Bonus Feature)
Detects sudden volume spikes of semantically or keyword-correlated incoming tickets
within a rolling time window, automatically raising the ACTIVE_OUTAGE (P1) flag.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from typing import List, Optional, Dict

@dataclass
class TicketEvent:
    ticket_id: str
    text: str
    queue: str
    timestamp: float = field(default_factory=time.time)
    matched_keywords: List[str] = field(default_factory=list)

@dataclass
class BurstCluster:
    cluster_id: str
    queue: str
    lead_term: str
    ticket_ids: List[str]
    first_seen: float
    last_seen: float
    ticket_count: int

class OutageBurstDetector:
    def __init__(self, window_seconds: int = 600, burst_threshold: int = 3):
        """
        :param window_seconds: Rolling time window (default: 10 minutes = 600s).
        :param burst_threshold: Number of correlated tickets to trigger an ACTIVE_OUTAGE.
        """
        self.window_seconds = window_seconds
        self.burst_threshold = burst_threshold
        self.events: deque[TicketEvent] = deque()
        self.active_clusters: Dict[str, BurstCluster] = {}

        # Outage signature terms that cluster together
        self.outage_signatures = [
            "vpn", "gateway", "outage", "timeout", "server down", "datenbank",
            "ausfall", "504", "502", "telemedicine", "hospital", "login failure"
        ]

    def _purge_expired(self, current_time: float):
        cutoff = current_time - self.window_seconds
        while self.events and self.events[0].timestamp < cutoff:
            self.events.popleft()

    def record_and_evaluate(self, ticket_id: str, text: str, queue: str) -> Optional[BurstCluster]:
        now = time.time()
        self._purge_expired(now)

        text_lower = text.lower()
        matched = [sig for sig in self.outage_signatures if sig in text_lower]

        event = TicketEvent(
            ticket_id=ticket_id,
            text=text,
            queue=queue,
            timestamp=now,
            matched_keywords=matched
        )
        self.events.append(event)

        if not matched:
            return None

        # Check for cluster in the current window
        for sig in matched:
            related = [
                e for e in self.events 
                if sig in e.matched_keywords and (e.queue == queue or "Support" in e.queue)
            ]
            
            if len(related) >= self.burst_threshold:
                cluster_id = f"BURST-{sig.upper().replace(' ', '_')}-{queue.split()[0].upper()}"
                cluster = BurstCluster(
                    cluster_id=cluster_id,
                    queue=queue,
                    lead_term=sig,
                    ticket_ids=[e.ticket_id for e in related],
                    first_seen=related[0].timestamp,
                    last_seen=related[-1].timestamp,
                    ticket_count=len(related)
                )
                self.active_clusters[cluster_id] = cluster
                return cluster

        return None

    def get_active_outage_banner(self) -> Optional[Dict]:
        if not self.active_clusters:
            return None
        # Return most critical/largest cluster
        top_cluster = max(self.active_clusters.values(), key=lambda c: c.ticket_count)
        return {
            "cluster_id": top_cluster.cluster_id,
            "headline": f"P1 ACTIVE OUTAGE: Correlated {top_cluster.lead_term.upper()} Failure",
            "impacted_queue": top_cluster.queue,
            "ticket_count": top_cluster.ticket_count,
            "tickets": top_cluster.ticket_ids
        }
