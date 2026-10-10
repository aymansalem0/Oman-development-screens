# MOEI Smart Inspection — STEP 05-08 A04 Pre-Inspection Dossier Deployment

**Branch:** `feature/si-preinspection-a04-dossier-v1`
**Parent:** Smart Inspection PR #49 (`feature/si-dynamic-candidate-targeting-v1`).
**Dependencies:** NMC Risk PR #48, Oracle migrations 007 → 008 → 009 already deployed.

This PR adds the **deterministic evidence preparation snapshot**, **explicit opt-in A04 dossier**,
strict structured-response/evidence-ID validation, and **human supervisor review**.
Existing 8 base checklist IDs are never removed, altered or automatically expanded.
Airia-generated hypotheses **are not actual inspection findings**.
There is **no automatic AI call** on GET, page load, preparation, or human review.

## A. Windows PowerShell — checkout PR without GitHub CLI
```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# STOP if there are local modifications; save or stash before switching.
git fetch origin pull/50/head:pr-50-si-preparation
git switch pr-50-si-preparation
git branch --show-current
```
Use the actual PR number if GitHub assigned a different number; confirm the PR link.
Check `.env` **locally**; never commit secrets.

## B. Database Migration 010 — schema only (run ONCE, after backup)

**Target:** existing `oracle-free-23` container, user `NMC_AI`, PDB `FREEPDB1`.
`010_si_preinspection_a04_dossier.sql` adds only
`SI_PREPARATION_DOSSIER` and `SI_PREPARATION_AUDIT`, plus one index.
No data migration/backfill. It **does not** alter NMC assessment, NMC risk,
NMC case, or earlier SI event/decision/case tables.

Before ANY Oracle DDL: verify recoverable Oracle backup independently of Git/Docker,
DBA approval and a testable restore plan. Oracle DDL auto-commits; `ROLLBACK`
will not reverse partial DDL.

1. Copy migration; copy does **not** run SQL:
```powershell
docker ps --filter "name=oracle-free-23"
docker cp .\ai-proxy\migrations\010_si_preinspection_a04_dossier.sql oracle-free-23:/tmp/si-prep-010.sql
docker exec -it oracle-free-23 bash
```
2. Inside Oracle container: `sqlplus -L /nolog`. At SQL prompt:
```sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SELECT USER AS USERNAME, SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN (
  'NMC_RISK_POLICY_DRAFT','SI_CANDIDATE_EVENT','SI_CANDIDATE_DECISION',
  'SI_INSPECTION_CASE','SI_TARGETING_RULE_VERSION',
  'SI_PREPARATION_DOSSIER','SI_PREPARATION_AUDIT'
) ORDER BY TABLE_NAME;
SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME='NMC_RISK_POLICY_PROJECTION'
 AND COLUMN_NAME='FACTOR_SNAPSHOT_JSON';
SELECT COUNT(*) AS NMC_AI_BEFORE FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS NMC_RISK_BEFORE FROM NMC_RISK_POLICY_PROJECTION;
SELECT COUNT(*) AS SI_CASES_BEFORE FROM SI_INSPECTION_CASE;
```
**Preflight rule:** 008 and 009 tables must exist; the two 010 tables must both be ABSENT.
If one 010 table exists, STOP and investigate partial migration; do NOT rerun blindly.
Capture baseline counts.

3. With backup verified and preflight passed, execute **exactly once**:
```sql
@/tmp/si-prep-010.sql
```
Expected: two `Table created.` and one `Index created.` (plus SELECT outputs).
Stop at any `ORA-` error and inspect DB state; don't rerun.

4. Verify table presence and unchanged existing source counts:
```sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
 ('SI_PREPARATION_DOSSIER','SI_PREPARATION_AUDIT') ORDER BY TABLE_NAME;
SELECT COUNT(*) AS NMC_AI_AFTER FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS NMC_RISK_AFTER FROM NMC_RISK_POLICY_PROJECTION;
SELECT COUNT(*) AS SI_CASES_AFTER FROM SI_INSPECTION_CASE;
SELECT COUNT(*) AS NEW_DOSSIERS FROM SI_PREPARATION_DOSSIER;
SELECT COUNT(*) AS NEW_AUDIT FROM SI_PREPARATION_AUDIT;
EXIT
```
Before any new user operation, previous counts must match and dossier/audit new-table
counts should initially be zero.

## C. Docker Compose deployment (preserve ALL volumes)

**Default safe setting:** `SI_A04_ENABLED=false`. With `.env` configured:
```dotenv
NMC_DB_MODE=oracle
NMC_FLEET_AUTO_ENABLED=false
SI_A04_ENABLED=false
# Only opt in after verifying partner pipeline, cost/usage and schema:
# SI_A04_ENABLED=true
# AIRIA_MENA_KEY=<server-side-secret>
```
Do not paste actual passwords/API keys into chat or Git. Existing `.env` database
and role keys are reused. A04 uses existing Airia A04 pipeline configuration
`AIRIA_A04_PIPELINE_ID` and existing proxy `fleetAgentCall('a04',…)`.

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy
```
If running the Google PSC override already, insert
`-f compose.google-psc.yaml` **between** `compose.yaml` and `compose.oracle.yaml`
in every command. Never run `docker compose down --volumes`.

## D. Readiness & UI acceptance

```powershell
Invoke-RestMethod http://localhost:4200/api/ai/health
(Invoke-RestMethod http://localhost:4200/api/si/v1/candidates/dashboard).summary
```

1. Open `http://localhost:4200/moei/smart-inspection/candidates`.
2. Review an approved SI Inspection Case (not a pending candidate).
3. Click **Open Preparation & A04 Dossier**.
4. Enter Editor key & officer name, load the approved case.
5. Check full evidence manifest and **all eight** unchanged checklist IDs.
6. Click **Prepare Case — No AI Call**; verify new record in `SI_PREPARATION_DOSSIER`.
7. If source NMC risk missing, AI generation must be blocked (no fabricated risk).
8. With A04 still disabled, Generate must remain disabled. For **one explicitly
   approved test** enable `SI_A04_ENABLED=true` and configure Airia API key
   server-side; recreate ai-proxy. A04 may incur paid calls.
9. Confirm Generate in the UI; output stays DRAFT_REVIEW until supervisor
   publisher-key decision. Invalid evidence IDs or unknown checklist IDs must
   fail closed and record `FAILED` rather than fabricating a dossier.
10. Approve or Reject advisory overlay with publisher key, actor and reason.
    Verify persisted `SI_PREPARATION_AUDIT`, version history and restart durability.
11. Publish a new central Risk version in NMC: older unapproved preparation
    should display STALE and require an explicit new snapshot, never silently change.
12. Verify existing `NMC_AI_ASSESSMENT` and
    `NMC_RISK_POLICY_PROJECTION` values untouched by A04.

### API summary (all require X-NMC-DASHBOARD-KEY)
- `GET /api/si/v1/preparations/:caseId` (EDITOR or higher)
- `POST /api/si/v1/preparations/:caseId/prepare` (EDITOR)
  `{"actor":"Officer","expectedVersion":0}`
- `POST /api/si/v1/preparations/:caseId/generate` (EDITOR; explicit and gated)
  `{"actor":"Officer","expectedVersion":1,"confirmCost":true,"language":"en"}`
- `POST /api/si/v1/preparations/:caseId/review` (PUBLISHER)
  `{"actor":"Supervisor","decision":"APPROVE","reason":"Evidence checked","expectedVersion":3}`

**A04 contract:** aligned to the partner A04 agent / dossier endpoint and detailed
SI v2.0 example. The partner guide establishes the pipeline and request pattern,
but the exact live response wrapper/format has NOT been integration-tested with the
user's Airia tenant. Runtime rejects incompatible responses safely.

## E. Rollback

Rollback app by checkout of a verified earlier ref and rebuild after assessing
compatibility. Never auto-drop Oracle 010 objects or previous data. A rollback
of database changes requires a DBA-approved restore procedure. Any outbound
A04 invocation may incur irreversible usage cost even when result validation fails.

## Deliberately out of this PR

- A03 verified PDF extraction (requires real document access)
- Real statutory checklist publishing / effective-dated regulatory policy
- New SI case booking into ERP beyond existing NMC referral scheduler
- Inspector evidence upload, field findings, report drafts, corrective actions
- Live Airia tenant acceptance (requires explicit API key & approved test)
