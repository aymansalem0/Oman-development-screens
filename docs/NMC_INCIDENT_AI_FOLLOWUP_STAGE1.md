# NMC POC — Stage 1: Incident AI Assessment & Human Follow-up

## Requested business flow
Original NMC Business POC, Section 3, item NMC-01 includes incidents in the operational picture, and NMC-05/07/08 cover recommended follow-up, coordination and monitoring. This phase implements **incident description → AI-only incident score → next-step suggestion → human accept/modify/reject → persisted audit**. It does **not** create a real incident response, inspection dispatch, case, detention, closure or port restriction. Those are later milestones.

## Source and result tables
Use the already-connected Sheet:
https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit

**Incident_Registry** (unchanged): report ID, reporting source (ports or reporting platform), original description, status, IMO, source severity, location, source consent `AI_Review_Request=YES/NO`.
Do not overwrite `Source_Incident_Status` or officer-owned `Operational_Status` when AI scores a report.

**AI_Assessments** (27 columns): model response fields, server-scored incident risk, AI route code, officer decision, plus:
- **Y / AI_Suggested_Followup_State** — deterministic mapping from the AI route to the **proposed next-step**, *not actual work executed*.
- **Z / Officer_Approved_Followup_State** — populated only after authorized human review.
- **AA / Officer_Review_Reason** — human-authored reason. The original AI output remains in the previous row (append-only).
These three columns were added to the live Google Sheet, along with dictionary and scoring descriptions.

## Incident risk model (separate from vessel A01/A02)
LLM returns four validated 0–5 integers, and backend computes:
```
IncidentRiskScore = round((35 × Impact + 30 × Urgency +
                           20 × Exposure + 15 × Recurrence) / 5)
LOW 0–24 | MODERATE 25–49 | HIGH 50–74 | CRITICAL 75–100
```
Confidence and missing information are shown. Incident score never replaces or silently modifies the ship's official A01/A02 risk assessment.

| AI recommendation | Proposed next-step status |
|---|---|
| VERIFY_INFORMATION | VERIFICATION_REQUIRED |
| ACTIVE_MONITORING | MONITORING_TO_ASSIGN |
| REFER_SMART_INSPECTION | INSPECTION_REFERRAL_PENDING |
| ESCALATE_TO_AUTHORITY | AUTHORITY_ESCALATION_PENDING |
| INCIDENT_RESPONSE | RESPONSE_COORDINATION_PENDING |
| CLOSE_AFTER_VERIFICATION | CLOSURE_EVIDENCE_REQUIRED |

All statuses explicitly mean **planned/pending**. In particular, `INSPECTION_REFERRAL_PENDING` does **not** claim that a Smart Inspection referral was created.

## Manual assessment (safe default)
1. Start Docker with all four Compose overlays, including `compose.incident-google.yaml`; the incidents service reuses the existing PSC Google service account mount, which needs Editor on this Sheet to append assessments and officer reviews.
2. Configure **one** incident-only model in the local `.env` before starting the backend. This does **not** reuse A01/A02 Airia; no dedicated Airia incident agent or contractual prompt is implied.
3. Open `http://localhost:4200/#/moei/nmc/incidents`. Confirm `http://localhost:4200/api/ai/nmc/incidents/health` includes `"aiConfigured":true`.
4. Choose a report with `AI_Review_Request=YES`. Click **Analyze with AI** and confirm possible API usage. The model receives source description + minimal context, never Google credentials.
5. Backend validates the model output, computes 0–100 risk, appends one AI assessment row and surfaces the proposed follow-up/status in Incident Intelligence and Command Center.
6. An authorized operator enters their name and business justification, chooses Accept/Modify/Reject. The approved next-step state and human reason are appended to a second assessment row. No actual change to the source incident status or actual operational follow-up is fabricated.

**OpenAI example (configure locally, never commit or share API keys):**
```ini
NMC_INCIDENT_AI_PROVIDER=openai
NMC_INCIDENT_AI_MODEL=<your available OpenAI model>
NMC_INCIDENT_OPENAI_API_KEY=<your key>
NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false
```
**Ollama example** (when your local Ollama model is already running):
```ini
NMC_INCIDENT_AI_PROVIDER=ollama
NMC_INCIDENT_AI_MODEL=<your installed model>
NMC_INCIDENT_OLLAMA_URL=http://host.docker.internal:11434
NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false
```

## Optional automatic triage of newly received reports
Auto ingestion is **disabled by default**. To enable it deliberately, set these environment values in local `.env` and restart the two relevant containers:
```ini
NMC_INCIDENT_AUTO_TRIAGE_ENABLED=true
NMC_INCIDENT_AUTO_INTERVAL_MINUTES=15
NMC_INCIDENT_AUTO_MAX_PER_CYCLE=2
```
The worker checks the Sheet every 15 minutes, selects only not-yet-assessed (or description-updated), not closed/resolved rows with `AI_Review_Request=YES`, and performs at most 2 billable AI calls per cycle. Cycle interval floor is 5 minutes, cap is 5 calls. Browser refreshes, live map movements and Command Center open do **not** call the model. It is a POC single-instance worker, not production-grade distributed messaging/idempotency.

## Test & demo case
For `INC-POC-0001` (synthetic Fujairah smoke report), read its description, click Analyze, then review the AI factors, computed score, rationale, missing evidence, proposed next-step state, source `RECEIVED` state, and original vessel risk. Change follow-up to another allowed path and click Modify with justification. Confirm **AI_Assessments** has original AI row plus a separate human review row with fields Y/Z/AA. Refresh Command Center: the Incident details in **Requires Attention Now** should display the approved next-step, while the map highlights incident severity separately from saved vessel risk.

## Explicit limitations
- The same Google PSC service account may read; **Editor sharing permission is required for appending**. No second key file is required.
- A real AI assessment has **not** been run by the assistant because no incident-model configuration/credentials are available within this environment.
- No user-environment Docker build or complete Angular test has been verified. A V8 in-memory smoke test passed with three actual synthetic Sheet rows and stubbed AI output; the backend test suite has additional automated assertions.
- No autonomous maritime incident confirmation, vessel detention, port restrictions, incident closure, actual Smart Inspection or authority escalation.
- Future phase 3 links officer-approved follow-up to NMC Case / Alerts / Smart Inspection and tracks actual executed outcomes with audit and governance.
