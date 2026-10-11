# NMC POC — Maritime Incident Intake, Google Sheet, and AI Triage
**Business basis:** original NMC POC Section 3, Requirement 1: display of maritime incidents in operational view. This implementation is a POC mock integration, not an MOEI live incident-reporting or safety enforcement system.

## Created native Google Sheet
[MOEI NMC POC — Maritime Incident Sources & AI Triage (Synthetic)](https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit)

Tabs:
1. `Incident_Registry` — two intake source types `PORT_AUTHORITY` and `REPORTING_PLATFORM`, original incident descriptions, source status, officer-owned `Operational_Status`, date/time, IMO, location, evidence reference and AI opt-in.
2. `AI_Assessments` — separate incident AI scoring and follow-up, AI rationale/confidence; new rows appended on AI analysis and human review, without overwriting original output.
3. `Source_Catalogue` — traceable proposed intake adapters and source limitations.
4. `Scoring_Policy` — **incident-specific risk model**.
5. `Data_Dictionary` — field ownership and allowed values.

Three synthetic sample reports are provided. They are **not actual incidents involving named ships or ports**.

## Incident-specific scoring and human review
An incident description is sent **only when an officer explicitly clicks Analyze with AI**, after confirming the possible call cost, to an independently configured OpenAI-compatible chat endpoint (OpenAI provider) or Ollama. This is **not** a modification to any Airia A01/A02 request or response.

The AI must propose four integers from 0 to 5: `impact`, `urgency`, `exposure` and `recurrence`. The NMC backend, **not the model**, computes:

`IncidentRisk = round((35×impact + 30×urgency + 20×exposure + 15×recurrence) / 5)`

Classification: LOW 0–24, MODERATE 25–49, HIGH 50–74, CRITICAL 75–100.

An AI follow-up must be one of:
`VERIFY_INFORMATION`, `ACTIVE_MONITORING`,
`REFER_SMART_INSPECTION`, `ESCALATE_TO_AUTHORITY`,
`INCIDENT_RESPONSE`, `CLOSE_AFTER_VERIFICATION`.

No automatic legal detention, port ban, vessel risk change or actual incident response follows the recommendation. An officer can **Accept, Modify, or Reject** the follow-up, with mandatory evidence-based justification. That decision is recorded in a subsequent `AI_Assessments` row with original AI recommendation preserved. **An approved inspection referral remains advisory for the time being; it does not automatically invoke the existing Smart Inspection workflow.**

### Distinction from official vessel risk
An incident-specific score of 77/100 does not change the official vessel score of 60/100. The original A01/A02 vessel risk engine and historical records remain unchanged; incidents have different severity criteria.

## Setup (local Docker)
1. Open the Google Sheet above.
2. Create or reuse a **dedicated** Google service account with the Sheets API enabled; share the Sheet with its `client_email` as **Editor** (backend reads rows and appends AI assessment/review rows). The separate PSC service account is read-only and is **not automatically authorized** for this workbook.
3. Place your own JSON key at `./secrets/nmc-incident-google.json` (do not commit keys or paste them in chat). Set your local `.env` values, e.g.:

```ini
NMC_INCIDENT_SHEET_ID=1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8
# Choose one AI mode only when ready (disabled is safe default):
NMC_INCIDENT_AI_PROVIDER=openai
NMC_INCIDENT_AI_MODEL=gpt-4o-mini
NMC_INCIDENT_OPENAI_API_KEY=<set locally; do not commit>
# Or use:
# NMC_INCIDENT_AI_PROVIDER=ollama
# NMC_INCIDENT_AI_MODEL=<installed-ollama-model>
```
4. Build and run existing POC + the **additional overlay**, without deleting Docker volumes:

```powershell
git fetch origin
git switch --track origin/feat/nmc-incident-google-sheet-ai-triage-20261011
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml up -d --build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml ps
```

5. Visit **http://localhost:4200/#/moei/nmc/incidents**; also see the new Incident ribbon on **http://localhost:4200/#/moei/nmc**.
6. Click **Analyze with AI** on a synthetic report with `AI_Review_Request = YES`. You will be asked for the existing POC **Editor key** and explicit confirmation before a billable model call. Read-only page loads never call AI.
7. The AI response is validated before being appended to the `AI_Assessments` tab. To test human changes, enter officer name, rationale and alternate follow-up and choose **Modify**.

### Important limitations
- Google Drive ChatGPT connector and a server-side Google service account are **different** authenticated contexts. The spreadsheet was created; local Docker connection **needs your service-account credentials and sharing**.
- No confirmed live AI calls, local Docker build, Angular compilation, or acceptance tests were executed by the assistant in the user's environment.
- If a description changes after AI analysis, results are marked stale; a new explicit call is required.
- Source-of-truth `Operational_Status` is maintained in `Incident_Registry` by the reporting/NMC staff. AI review `Approved_Followup_Status` is separate and is not a regulatory/incident-system status change.
- Future production integration requires approval of actual incident sources, jurisdiction/competence, authority controls, a proper event queue and case linkage.
