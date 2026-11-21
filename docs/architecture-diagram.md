# DA-11: SentinelDesk Architecture Diagrams & Slide Visuals
**Owner**: Data Analyst  
**Project**: SentinelDesk (Hackathon 5-Hour Build)  
**Repository**: `Dogtags27/gdg-sentinal`

---

## 1. End-to-End System Architecture

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        UI["React + Vite Operator Console<br>(Tailwind + Recharts)"]
    end

    subgraph Gateway ["Gateway Layer (Go 1.22)"]
        GW["Go Gateway (ServeMux)<br>:8080"]
        PII["PII Guardrail Filter<br>(Masks IPs, emails, cards)"]
        GW --> PII
    end

    subgraph Engine ["Python AI Engine (FastAPI :8000)"]
        LANG["Language Detector<br>(EN / DE)"]
        TRIAGE["Multi-Task Classifier<br>(Type, Queue, Priority)"]
        BURST["DA-08: Outage Burst Detector<br>(Rolling window cluster)"]
        GATE["DA-06: Escalation Gate<br>(P1 / P2 / Auto-Draft)"]
        RAG["Grounded RAG Synthesizer<br>(Citing [TKT-XXXXX])"]
    end

    subgraph DataStore ["Data & Vector Layer"]
        QDRANT["Qdrant Vector DB (:6333)<br>16,000 Historical Precedents"]
        R2["Cloudflare R2 Bucket<br>sentineldesk-artifacts/"]
    end

    UI -->|"POST /api/v1/triage"| GW
    PII -->|"Forward Clean Ticket"| LANG
    LANG --> TRIAGE & BURST
    TRIAGE --> QDRANT
    QDRANT --> RAG
    TRIAGE & BURST & QDRANT --> GATE
    GATE -->|"P1: ESCALATE_ONCALL"| UI
    GATE -->|"P2: HUMAN_REVIEW"| UI
    GATE -->|"P0: AUTO_DRAFT"| RAG --> UI
```

---

## 2. Zero-Leakage Data Partition Flow (ML-03 / DA-01)

```mermaid
flowchart LR
    RAW["Raw HuggingFace CSV<br>(20,000 Tickets)"] --> SPLIT["Deterministic 80/20 Partition<br>(Seed: 42 | TKT-XXXXX)"]
    SPLIT --> KB["80% KB Training Split<br>(16,000 records)"]
    SPLIT --> TEST["20% Holdout Test Set<br>(4,000 records)"]
    
    KB --> VECTOR["Qdrant Vector DB<br>(Precedent Resolutions Indexed)"]
    KB --> TRAIN["Triage Classifier Training<br>(Type Macro-F1: 83.1%)"]
    
    TEST --> BLIND["Blind Inference Test<br>(Answers Dropped & Quarantined)"]
    BLIND --> BENCHMARK["Holdout Evaluation Report<br>(P1 Recall: 85.2% | Latency: 1.11ms)"]
```

---

## 3. Escalation Policy State Machine (DA-06 / DA-07)

```mermaid
stateDiagram-v2
    [*] --> EvaluatingTicket

    state EvaluatingTicket {
        [*] --> CheckP1
        CheckP1 --> ESCALATE_ONCALL : High-Priority Incident Outage
        CheckP1 --> ESCALATE_ONCALL : Security Incident (Ransomware/Breach)
        CheckP1 --> ESCALATE_ONCALL : Active Burst Cluster (ACTIVE_OUTAGE)
        
        CheckP1 --> CheckP2 : No P1 Detected
        CheckP2 --> HUMAN_REVIEW : Prompt Injection
        CheckP2 --> HUMAN_REVIEW : Legal / GDPR Lawsuit
        CheckP2 --> HUMAN_REVIEW : Unsupported Request (100% Refund/Bitcoin)
        CheckP2 --> HUMAN_REVIEW : Low Model Confidence (< 42%)
        CheckP2 --> HUMAN_REVIEW : No Precedent Similarity (< 28%)
        
        CheckP2 --> AUTO_DRAFT : Clean Ticket
    }

    ESCALATE_ONCALL --> [*]
    HUMAN_REVIEW --> [*]
    AUTO_DRAFT --> [*]
```

---

## 4. 5-Minute Live Judge Presentation Deck Outline

| Slide / Segment | Visual / Graphic | Talking Point (30s each) |
| :--- | :--- | :--- |
| **1. The Problem (0:00 - 0:30)** | Hospital VPN outage ticket lost in queue | Operations struggle with triage bottlenecks and generative AI hallucinations. |
| **2. Architecture (0:30 - 1:00)** | Slide 1 Architecture Diagram | Series-circuit pipeline: Go Gateway $\rightarrow$ Python Engine $\rightarrow$ Qdrant RAG $\rightarrow$ Escalation Gate. |
| **3. Live Outage Demo (1:00 - 2:00)** | React Console: Red P1 Banner | German Telemedicine VPN failure: triggers `ESCALATE_ONCALL` with cluster burst detection. |
| **4. Grounded Auto-Draft (2:00 - 3:00)** | React Console: Green Auto-Draft | Routine password reset: Instant grounded resolution citing precedent `[TKT-14714]`. |
| **5. Defense & Benchmarks (3:00 - 4:30)** | Insights Tab (DA-10 charts) | Zero data leakage, **83.1% Macro-F1**, **85.2% Outage Recall**, **1.11 ms** latency. |
| **6. Wrap-up (4:30 - 5:00)** | Team Q&A slide | Commercial alignment with SentinelDeskHQ principles. |
EOF