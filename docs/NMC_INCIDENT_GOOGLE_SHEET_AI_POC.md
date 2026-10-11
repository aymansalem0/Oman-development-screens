# NMC POC — Incident Source & Google Sheet

**Important superseding decision (11 Oct 2026):** Incident AI uses the **same existing Airia A01 (Maritime Intelligence) and A02 (Vessel Compliance)** pipeline IDs, shared Airia API key and existing vessel evidence. **There is no new OpenAI/Ollama agent/provider** for incident assessment. See the current detailed implementation guide:
[`NMC_INCIDENT_AI_FOLLOWUP_STAGE1.md`](./NMC_INCIDENT_AI_FOLLOWUP_STAGE1.md).

## Incident Google Sheet
[MOEI NMC POC — Maritime Incident Sources & AI Triage (Synthetic)](https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit)

- `Incident_Registry`: reporting source (`PORT_AUTHORITY` or `REPORTING_PLATFORM`), original incident description, IMO, reported status, NMC operational status and per-row `AI_Review_Request`.
- `AI_Assessments`: **32 columns**, with A01 incident factors/evidence, A02 incident compliance interpretation/evidence, incident-only risk score and officer-reviewed follow-up; append-only separate AI and human review rows.
- `Source_Catalogue`, `Scoring_Policy`, `Data_Dictionary`: integration source references, deterministic incident score rule, field ownership and output extension contract.
- Three explicitly synthetic reports exist. They are not real incidents or verified emergency reports.

## Connection
Share the Sheet with the exact `client_email` of your existing `secrets/nmc-psc-google.json` service account (Editor for saving AI or officer reviews), enable Google Sheets API and start the existing Compose overlays plus `compose.incident-google.yaml`. **No second Google key** is needed.

```powershell
git fetch origin
git switch --track origin/feat/nmc-incident-ai-followup-stage1-20261011
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml up -d --build --force-recreate ai-proxy nmc
```

Operational picture: `http://localhost:4200/#/moei/nmc` (incident summary, severity-highlighted vessel markers, incident action in Requires Attention). Incident triage: `http://localhost:4200/#/moei/nmc/incidents`.

## Agent contract dependency
The currently documented A01/A02 Airia contracts do **not** define `incidentTriage` and `incidentCompliance`. Update the **existing** Airia pipeline prompts/output schemas to support this versioned extension, then test with a real incident response. If missing, the adapter fails closed and **does not fabricate an incident score**. A01/A02 normal vessel risk evaluation is preserved. See the detailed stage-1 guide for exact request/response JSON.

No automated maritime enforcement, incident confirmation, actual Smart Inspection referral or case creation is performed at this stage.
