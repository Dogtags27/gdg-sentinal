# SentinelDesk Final Regression Checklist & Backup Runbook (QA-11)

**Phase:** Harden & Freeze (4:00 – 4:30)  
**Target:** 100% verification across all sub-systems prior to 4:20 code freeze.  
**Auditor:** QA Lead  

---

## ✅ 1. The 10-Point Pre-Freeze Regression Checklist

| # | Inspection Point | Expected Result | Verified Command / Evidence | Status |
| :-: | :--- | :--- | :--- | :-: |
| **1** | **Frontend Unit Tests** | 15/15 Node tests passing | `cd frontend && npm test` | ✅ PASS |
| **2** | **Frontend Build** | Zero Vite build errors/warnings | `cd frontend && npm run build` (284ms) | ✅ PASS |
| **3** | **Golden Set Runner** | 30/30 tickets pass expected gates | `python3 qa/run_golden_set.py` (100%) | ✅ PASS |
| **4** | **Data Leakage Certification** | 0 overlapping IDs, 0 blind answers | `python3 qa/audit_leakage.py` | ✅ PASS |
| **5** | **Hallucination Scoring** | Average score ≥ 4.50, 0 penalties | `python3 qa/score_drafts.py` (4.87/5.0) | ✅ PASS |
| **6** | **Cloud Credentials** | Gemini API & Cloudflare R2 reachable | `python3 infra/check_access.py` | ✅ PASS |
| **7** | **Zero Secrets in Git** | `.env` ignored by git tracking | `git status` (clean, untracked ignored) | ✅ PASS |
| **8** | **Mock UI Offline Fallback** | Runs without external network | `VITE_USE_MOCK=true npm run dev` | ✅ PASS |
| **9** | **Simulate Outage Trigger** | Red banner displays & P1 burst fires | Click "Simulate Outage" in dashboard | ✅ PASS |
| **10** | **Keyboard Navigation** | `J/K/A/E` hotkeys function smoothly | Press `J`, `K`, `A`, `/` in console | ✅ PASS |

---

## 🛡️ 2. Disaster Recovery & Offline Backup Plan

In live hackathons and high-stakes judge presentations, network drops, rate-limit bans, or port collisions can occur. SentinelDesk maintains a **3-tier defense-in-depth redundancy**:

### Tier 1: Local Mock Engine (Zero-Cloud Mode)
- **Mechanism:** In `frontend/src/api/mockEngine.js`, the console has a complete in-browser mock engine that replicates the exact Go gateway and Python engine contract.
- **Activation:** Set `VITE_USE_MOCK=true` (default during local demo).
- **Benefit:** If Wi-Fi cuts out completely, the entire demo runs 100% locally with zero latency spikes.

### Tier 2: Standalone Zero-Dependency HTML Studio
- **File:** `5-AProject-SSC/00_SentinelDesk/sentineldesk_prototype_studio.html`
- **Activation:** Can be opened directly in Chrome/Safari from disk (`file:///...`) without running Node or Vite.
- **Benefit:** If Node.js crashes or ports 5173/8080 are killed by OS updates, the HTML studio provides the identical OncoSys visual workflow, keyboard hotkeys, and scenario launcher.

### Tier 3: Pre-Recorded 1080p Fallback Video
- **File:** `docs/assets/sentineldesk-backup-demo-1080p.mp4`
- **Specification:** Clean 5-minute screencast recording showing every action in `docs/demo-script.md` without audio, allowing the presenter to narrate live over the video if hardware fails.
