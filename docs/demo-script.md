# SentinelDesk 5-minute demo script (QA-10)

**Length:** 5:00, then 3 minutes of judge Q&A
**Presenters:** Speaker 1 (product and safety), Speaker 2 (system and data)
**Surface:** the deployed console, or `http://localhost:8080` (gateway serving the built console). Fallbacks are at the end.

Open the app, choose **I resolve incidents** on the landing page, then use **Live triage** (`#/lab`) in the side rail. Every scenario below is a built-in sample there, so nothing needs to be typed under pressure. Judges paste their own tickets on the same page. To show the customer side, choose **I need help** on the landing page: a plain form, a confirmation, and the customer's own ticket history.

```
0:00-0:30  Problem and architecture
0:30-1:30  German hospital VPN outage -> escalated to on-call, German draft held
1:30-2:20  English password reset -> grounded auto-draft with citations
2:20-3:00  Refund demand with a prompt injection -> human review, nothing promised
3:00-3:30  Outage drill -> major-incident banner
3:30-4:30  Holdout metrics on the Reports page
4:30-5:00  Safeguards and close
```

---

### 0:00-0:30 Problem and architecture

**Screen:** Overview (`#/`).

> **Speaker 1:** "Helpdesks get outages and password questions in the same inbox, and off-the-shelf chatbots make up refund policies. SentinelDesk triages every ticket, decides whether a reply is safe to draft, and only drafts from how past tickets were actually solved, citing them by ID."
>
> **Speaker 2:** "The React console talks to a Go gateway that masks personal data. A private Python engine detects the language, classifies type, queue and priority, searches 32,000 past tickets in Redis, runs an 11-rule safety gate, and drafts a reply that a validator checks before anyone sees it."

### 0:30-1:30 German hospital VPN outage

**Screen:** Live triage → sample **DE · Hospital VPN outage** → Run.

> **Speaker 1:** "A German clinic has lost its VPN, so telemedicine and the patient records system are down. Watch each step."
>
> - **Language:** detected as German from the text alone.
> - **Classify:** Incident, high priority, with calibrated confidence.
> - **Similar past tickets:** the top matches, each with its ticket ID, similarity and how it was solved.
> - **Safety gate:** *Escalated to on-call*, reason `HIGH_PRIORITY_INCIDENT`.
> - **Draft:** written in German, citing the past tickets, and **held** until a person accepts the triage.
>
> "The step timings are real; the console slows the animation down so you can follow it. The total engine time is shown under the steps."

### 1:30-2:20 English password reset

**Screen:** sample **EN · Password reset** → Run.

> **Speaker 2:** "A routine request. No rule fires, so the gate says *Auto-draft ready*. Every sentence that uses a past ticket cites it as `[TKT-xxxxx]`, and the check card shows the validator passed: every citation is one of the retrieved tickets, every number appears in the evidence, and the reply is in English."

### 2:20-3:00 Refund demand with a prompt injection

**Screen:** sample **EN · Refund + prompt injection** → Run.

> **Speaker 1:** "This customer demands a full refund and tells the model to ignore its instructions. The gate raises `PROMPT_INJECTION` and `UNSUPPORTED_REQUEST`, so a person reviews it. The draft does not promise a refund: the prompt forbids amounts or guarantees that aren't in the evidence, and the validator rejects any number the evidence doesn't contain."
>
> Optional, if time allows: **EN · Charged twice, full of personal data** shows `[EMAIL_1]`, `[CARD_1]`, `[IBAN_1]` placeholders. The masking happens in the gateway, so the engine and the LLM never see the originals.

### 3:00-3:30 Outage drill

**Screen:** Overview → **Outage drill**.

> **Speaker 2:** "Four VPN tickets arrive within seconds, in English and German. The burst detector counts distinct new tickets that share an outage term, such as 'vpn', inside a rolling 5-minute window. Drill and test tickets run in their own window, so a demo can never mark a real ticket as an outage. From the third one on it raises `ACTIVE_OUTAGE`, those tickets go to on-call, and the major-incident banner appears with the ticket count."

### 3:30-4:30 Holdout metrics

**Screen:** Reports (`#/insights`) → *Dataset & model*.

> **Speaker 1:** "All numbers are on 8,034 held-out tickets the model never saw. We split the data exactly as the brief says, seed 42, 80/20, and our leakage audit checks the two sets share no ticket IDs, no ticket text, and that no holdout answer is saved anywhere."
>
> - **High-priority incident recall:** the gate escalates 87 of every 100 true high-priority incidents (precision 0.534). A recall-tuned rule, one setting away, catches 93 of 100 at the cost of sending about 39% of all tickets to on-call. Either way, everything the gate does not auto-draft is read by a person.
> - **Macro-F1:** type 0.894, priority 0.704, queue 0.639 across 10 queues, with the classifier blended with the votes of the 5 most similar past tickets. Queue is the hardest call, which is why low confidence goes to a person.
> - **Calibration:** the classifier alone has an expected calibration error of 0.008 to 0.015. The neighbour vote adds 4 to 11 points of F1 but loosens calibration (0.06 to 0.13), so the gate's thresholds are tuned on the blended scores.

### 4:30-5:00 Safeguards and close

> **Speaker 2:** "If the LLM fails, OpenAI falls back to Gemini, then to quoting the best past answer verbatim, flagged `ENGINE_DEGRADED`. Nothing generated is sent without passing the validator."
>
> **Speaker 1:** "SentinelDesk escalates what's dangerous, drafts only what history supports, and shows its evidence every time. Try it with your own ticket."

---

## Checklist and fallbacks

- [ ] Deployed stack healthy: `curl <host>/api/v1/health` shows the engine `ok`, and two warm-up tickets have run (`infra/warmup.py`).
- [ ] Browser zoom at 110% for the projector.
- [ ] **Fallback 1, LLM or Redis down:** the engine still answers (extractive or holding drafts, `ENGINE_DEGRADED`). Say so; it is a feature.
- [ ] **Fallback 2, engine down:** restart the gateway with `MOCK_ENGINE=true`. It answers with the contract's example responses.
- [ ] **Fallback 3, no network:** `cd frontend && npm run dev` runs the console on the in-browser mock engine.
- [ ] Backup screen recording on the presenter laptop, if one was recorded.
