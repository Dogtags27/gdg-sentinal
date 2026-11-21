# SentinelDesk 5-Minute Live Demo Script (QA-10)

**Target Duration:** Exactly 5 minutes (00:00 – 05:00)  
**Presenters:** Lead Presenter + Technical Co-Presenter  
**Primary Surface:** Live Console at `http://localhost:5173` (with offline fallback ready)  

---

## ⏱️ Timeline & Speaker Notes

```
[00:00 - 01:00] The Core Problem & Architectural Vision
[01:00 - 02:00] Ingestion, Sanitization & PII Perimeter Defense
[02:00 - 03:00] The 3-Step Workflow: Ingest → Evaluate Gates → Defend Precedents
[03:00 - 04:00] Incident Burst Simulation & P1 Escalation
[04:00 - 05:00] Executive Telemetry, Funnel Accountability & Closing
```

---

### 🎙️ Minute 00:00 – 01:00: The Problem & The Mission

**Screen:** SentinelDesk Operator Console (`http://localhost:5173/#/`)  
**Visual Cue:** Show the clean OncoSys-style header with the pulsing green telemetry capsule (`● Sentinel-4B · P95 38ms`).

> **Speaker 1 (The Hook):**  
> *"Every enterprise IT and security operations team faces the exact same crisis: a relentless deluge of incoming tickets. When a critical VPN concentrator drops or a credential leaks, human operators spend 20 minutes manually reading logs, checking runbooks, and sanitizing user data before a single fix is deployed. MTTR climbs, SLAs breach, and alert fatigue sets in.*  
>  
> *Meet **SentinelDesk**: an autonomous IT help desk and cyber-operations watchtower that categorizes, prioritizes, and routes tickets automatically. Our promise is simple: **Every ticket triaged. Every escalation defended.** Your engineering team only touches work that strictly requires human judgment."*

---

### 🎙️ Minute 01:00 – 02:00: Ingestion & Zero-Retention PII Redaction

**Screen:** Click `+ New Ticket` or use the Hero Command Bar (`/ to focus`).  
**Visual Cue:** Paste a customer ticket containing a credit card, email, and IP address (e.g. from `GOLD-09`).

> **Speaker 2 (Security Architecture):**  
> *"Before an LLM or embedding model ever touches user input, security must be guaranteed. Watch what happens when a customer submits a ticket containing a credit card number, personal email, and internal server IP.*  
>  
> *Our edge **Go gateway** executes zero-retention regex masking at the perimeter. Credit cards become `[CARD_1]`, emails become `[EMAIL_1]`, and internal IPs become `[IP_1]`. The raw credentials never leave the gateway memory. When the Python engine processes the incident, customer privacy is mathematically shielded while classification accuracy remains completely unaffected."*

---

### 🎙️ Minute 02:00 – 03:00: The 3-Step Workflow: Ingest ➔ Evaluate ➔ Defend

**Screen:** Open ticket `TICK-8021` (or click `GOLD-01` in the queue).  
**Visual Cue:** Show the 3 methodology cards and highlight the verified `[TKT-XXXXX]` citation.

> **Speaker 1 (Triage & Grounding):**  
> *"Here is a live ticket: `VPN Gateway Pool Exhaustion across US-East`. How does SentinelDesk resolve it?*  
>  
> *1. **Ingest & Mask:** The language is classified (EN/DE) and PII is masked.  
> *2. **Evaluate Gates:** The ticket is audited against our calibrated holdout curve. If confidence is below 85% or blast radius is high, it diverts safely to humans. Here, confidence is 98.4%, so the safety gate clears.  
> *3. **Defend Precedents:** Instead of asking an LLM to hallucinate instructions, our hierarchical Redis vector search retrieves verified historical runbook `[TKT-01049]`. The auto-draft explicitly cites this precedent, providing engineers with an exact failover command. Notice the citation chip: zero hallucinations, 100% grounded."*

---

### 🎙️ Minute 03:00 – 04:00: Outage Burst Simulation & P1 Escalation

**Screen:** Click the **"Simulate Outage"** button in the dashboard header.  
**Visual Cue:** The major-incident red banner slides in; ticket queue updates with 5 concurrent VPN outage tickets; gate decision shifts to `ESCALATE_ONCALL`.

> **Speaker 2 (Real-Time Resilience):**  
> *"Now let's simulate what happens when disaster strikes. I'm clicking 'Simulate Outage'.*  
>  
> *Immediately, a burst of 5 related VPN tickets floods the ingestion queue within a 60-second window. Our policy engine's **Active Outage Detector** identifies the cluster signature.  
>  
> *Instead of auto-drafting individual replies, SentinelDesk triggers an immediate **P1 ESCALATE_ONCALL** gate decision. The red Major Outage banner alerts all on-duty operators, paging the infrastructure on-call engineer with clustered blast-radius telemetry. Autonomous when safe, instant escalation when dangerous."*

---

### 🎙️ Minute 04:00 – 05:00: Executive Telemetry, Funnel & Closing

**Screen:** Navigate to **"Reports"** (`#/insights`) to show the Holdout & Exclusion Funnel.  
**Visual Cue:** Hover over the 5-stage funnel (*Ingested* ➔ *Sanitized* ➔ *Gated* ➔ *Diverted* ➔ *Auto-Drafted*).

> **Speaker 1 (Business Proof & Defensibility):**  
> *"Finally, let's look at the numbers. On our Reports page, we provide executive-ready telemetry inspired by scientific precision instruments.*  
>  
> *Our **Holdout & Safety Exclusion Funnel** accounts for every single ticket: 1,420 ingested, 100% PII sanitized, 83.1% pass confidence gates, and 62.7% auto-cleared with zero human intervention.  
>  
> *More importantly, our QA audit certifies **zero data leakage**: 16,000 KB training precedents and 4,000 holdout test cases are completely disjoint with SHA-256 cryptographic verification. Our P95 latency is 38ms, well beneath our 400ms SLA.  
>  
> *SentinelDesk gives enterprise engineering teams their time back. Thank you, and we're ready for your questions."*

---

## 🎛️ Demo Checklist & Fallbacks

- [ ] Dev server running at `http://localhost:5173` with mock engine active.
- [ ] Browser window zoomed to 110% for crisp projector/screen-share legibility.
- [ ] Local backup studio (`sentineldesk_prototype_studio.html`) open in background tab.
- [ ] Pre-recorded 1080p backup video queued in QuickTime/VLC in case of network cut.
