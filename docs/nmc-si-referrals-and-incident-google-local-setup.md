# MOEI NMC: Incoming Smart Inspection cases and Incident Google Sheet (17 Oct 2026)

## Business behavior
- Supervisor-approved **Smart Inspection → Forward to NMC** produces a real, persisted NMC Case through `syncSiSupervisorReviewToNmc` and `caseWorkspace.fromSiInspection`, or links the approved report to the existing active case for the same IMO. No synthetic alert, new regulatory decision, automatic detention, or fabricated AI result.
- For NMC-origin inspections, the matching approved `inspectionReviewHistory` event is used instead of inventing a second case. Only approved (not returned) reports show in the Command Center incoming list.
- The **Vessels forwarded from Inspections** panel shows one card per persisted NMC Case ID, ordered by saved inspection forwarding time. It displays IMO, vessel name from the POC catalogue **only when known**, case/report IDs, status, and verified `operationalRisk` where saved. No new risk value is shown while pending/failed.
- Clicking **Open NMC Case** opens `/moei/nmc/vessel/:imo/case`. For an IMO outside the 99-vessel demo catalogue, the case page must keep the exact IMO, show unknown vessel metadata and avoid substituting a different demo vessel.
- Case list API `GET /api/ai/cases` includes centrally saved SI-origin cases outside the demo 99 fleet cohort **only when** there is an approved SI report event with valid inspection ID and report ID. The map's synthetic vessel universe is unchanged.

## Local Google Incident Sheet source
The regular `compose.yaml` now defines:
- `NMC_INCIDENT_SHEET_ID`: `1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8` unless overridden.
- `NMC_INCIDENT_CREDENTIALS_PATH=/run/secrets/nmc-psc-google.json`.
- `NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false` by default: this is the **background billable scheduler**, not the AI agent availability flags. Existing A01/A02 and user-requested event-driven reassessment are independent. The optional `compose.incident-google.yaml` enables the periodic incident job by its own setting only when approved and the source grants access.

The service account JSON must still be mounted via `compose.google-psc.yaml` from the current worktree's `./secrets/nmc-psc-google.json`. The Google service account `client_email` must be explicitly shared on the Incident Sheet with Editor permission for append-only AI review tabs. Credential existence does **not** prove access to Google. Never commit, print or send the JSON, OAuth secrets, API keys or access tokens.

Safe pre-deploy verification (PowerShell):
```powershell
cd C:\Users\Admin\MOEI-PR189
git status -sb
Test-Path .env
Test-Path .\secrets\nmc-psc-google.json
$files=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml')
$cfg=docker compose -p moei-nmc-poc @files config --format json | ConvertFrom-Json
$cfg.services.'ai-proxy'.environment.NMC_DB_MODE   # oracle
[bool]$cfg.services.'ai-proxy'.environment.NMC_INCIDENT_SHEET_ID
$cfg.services.'ai-proxy'.environment.NMC_INCIDENT_AUTO_TRIAGE_ENABLED
```
Do NOT run `docker compose down -v`. Deploy only after CI and safety checks.

After safely recreating `ai-proxy`:
```powershell
docker exec moei-nmc-poc-ai-proxy-1 node -e "const fs=require('node:fs');console.log('SHEET_CONFIGURED',!!process.env.NMC_INCIDENT_SHEET_ID);console.log('CREDENTIALS_MOUNTED',fs.existsSync('/run/secrets/nmc-psc-google.json'));console.log('AUTO_TRIAGE',process.env.NMC_INCIDENT_AUTO_TRIAGE_ENABLED)"
```
And review `/api/ai/nmc/incidents/health` **from an authenticated NMC session**. A healthy configured/mounted state is not proof that Google token exchange and Sheets read/write are authorized.

## Oracle prerequisite for new SI-origin cases
**Manual DBA migration 020** `ai-proxy/migrations/020_si_forwarded_nmc_case_audit.sql` must be reviewed, backed up and applied on the existing Oracle schema before attempting to open a **new** SI-origin NMC Case without a prior alert. It relaxes `SOURCE_ALERT_ID` nullability without removing the foreign key, and expands the audit action length/allowlist. Never auto-run during image startup or drop/recreate tables. Inspect the existing constraints and existing audit action names; the documented SQL expects V2. Record migration completion and verify row counts unchanged.

Without 020, an approved SI-origin forward may return `RETRY_REQUIRED/CASE_SI_SOURCE_ALERT_NULL_MIGRATION_REQUIRED`, so the UI correctly shows **no new NMC Case**. Clicking Forward or repeatedly running paid AI cannot fix a missing Oracle DDL prerequisite. Existing cases carrying NMC-origin approval history may already show before 020.

## UAT checklist
1. Google Sheet configured and credentials mounted; distinguish source permission errors from missing configuration.
2. Supervisor approves one inspection and chooses Forward to NMC. Confirm `nmcSync.status=RECORDED`, a single central Case ID, and one corresponding Command Center card.
3. Repeat the same reporting event: no duplicate case/card.
4. Open NMC Case from card: same IMO, same Case ID. Verify out-of-demo IMO does not display another demo vessel.
5. Where AI A01/A02 reassessment is saved and validated, show old vs new risk and source evidence; otherwise state that no verified risk was saved.
6. Check NMC's human-only regulatory workflow remains unchanged and no AI calls occur just by opening/refreshing the Command Center.
