# Smart Inspection Candidate & Targeting — PR deployment (PowerShell + Oracle)

> This branch extends NMC Risk PR #48. It is **not** a production statutory
> PSC targeting ruleset. All external service/PSC intake events use explicitly
> labelled POC simulation. Reading the queue and publishing *priority* rules
> do not invoke Airia, alter NMC risk or write source assessments.

## Git: checkout the PR branch (no GitHub CLI required)

From `C:\Users\Admin\Oman-development-screens`:

```powershell
git status --short
# Review/commit/stash any local edits; STOP if checkout would overwrite them.
git fetch origin pull/<PR_NUMBER>/head:pr-si-targeting
git switch pr-si-targeting
git branch --show-current
```

The branch contains the base PR #48 commits. Do not merge either PR until
the Oracle and business acceptance checks pass.

## Database dependency & safety

Database: existing **oracle-free-23**, **NMC_AI**, **FREEPDB1**. `NMC_DB_MODE=oracle`
must be configured in the local `.env`. **No automatic migration runs at startup**.
A verified, recoverable Oracle database backup and DBA approval are required
**before running DDL**. Backup must be independent of Git and the Docker image.

Run migrations in dependency order: **007 → 008 → 009**. Do not rerun previously
applied migrations. PR #49 introduces exactly **009**:

`ai-proxy/migrations/009_si_candidate_targeting.sql`

Migration 009 creates four new `SI_*` tables and supporting indexes. No
existing NMC tables or assessment rows are altered, updated, or deleted.
The app creates targeting policy version 1 *after* verifying the new tables.
DDL autocommits in Oracle; a partial migration cannot be undone with ROLLBACK.

### 1) Preflight in Oracle SQL*Plus

```powershell
docker ps --filter "name=oracle-free-23"
docker cp .\ai-proxy\migrations\009_si_candidate_targeting.sql oracle-free-23:/tmp/si-targeting-009.sql
docker exec -it oracle-free-23 bash
```

Inside the Oracle container:

```bash
sqlplus -L /nolog
```

Inside SQL*Plus (password entered interactively; do not paste credentials into commands):

```sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SELECT USER AS USERNAME, SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES
 WHERE TABLE_NAME IN ('NMC_RISK_POLICY_VERSION','NMC_RISK_POLICY_ACTIVE',
                      'NMC_RISK_POLICY_PROJECTION','NMC_RISK_POLICY_DRAFT');
SELECT COLUMN_NAME FROM USER_TAB_COLUMNS
 WHERE TABLE_NAME='NMC_RISK_POLICY_PROJECTION' AND COLUMN_NAME='FACTOR_SNAPSHOT_JSON';
SELECT TABLE_NAME FROM USER_TABLES
 WHERE TABLE_NAME IN ('SI_CANDIDATE_EVENT','SI_CANDIDATE_DECISION',
                     'SI_INSPECTION_CASE','SI_TARGETING_RULE_VERSION');
SELECT COUNT(*) AS AI_ASSESSMENTS_BEFORE FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS RISK_PROJECTIONS_BEFORE FROM NMC_RISK_POLICY_PROJECTION;
```

**Required condition to run 009:** all four NMC risk policy tables exist,
`FACTOR_SNAPSHOT_JSON` exists, and **none** of the four SI tables exists.
If any SI object is present, STOP and investigate — do not rerun 009.

### 2) Apply 009 **once** after verified backup

```sql
@/tmp/si-targeting-009.sql
```

Expected: four `Table created.` plus three `Index created.`.
Stop on any Oracle error and check actual object state. Do not blindly rerun.

### 3) Verify unchanged source data

```sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'SI_%' ORDER BY TABLE_NAME;
SELECT COUNT(*) AS AI_ASSESSMENTS_AFTER FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS RISK_PROJECTIONS_AFTER FROM NMC_RISK_POLICY_PROJECTION;
SELECT COUNT(*) AS SI_EVENTS FROM SI_CANDIDATE_EVENT;
SELECT COUNT(*) AS SI_CASES FROM SI_INSPECTION_CASE;
EXIT
```

Source assessment/projection row counts should equal recorded preflight counts,
and new SI event/case tables should be empty before any user decisions.

## Docker deployment (preserve all volumes)

Back in PowerShell:

```powershell
# Check .env settings WITHOUT printing secret values:
$config=docker compose -f compose.yaml -f compose.oracle.yaml config --format json | ConvertFrom-Json
$config.services.'ai-proxy'.environment | Select-Object NMC_DB_MODE,NMC_DB_USER,NMC_FLEET_AUTO_ENABLED
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy
```

Set `NMC_FLEET_AUTO_ENABLED=false` to prevent unrelated paid assessment
runs during inspection acceptance tests. If the current deployment also
uses Google PSC, include `-f compose.google-psc.yaml` between the base
and Oracle override **in all commands**. **Never** run `down --volumes`.

## Functional verification / user acceptance

```powershell
Invoke-RestMethod http://localhost:4200/api/ai/health
Invoke-RestMethod http://localhost:4200/api/si/v1/rules
$si=Invoke-RestMethod http://localhost:4200/api/si/v1/candidates/dashboard
$si.summary
$si.policy
```

Browse `http://localhost:4200/moei/smart-inspection/candidates`.

Acceptance checklist:
1. Fleet denominator reflects all current active IMO records (420 in this
   synthetic POC), while candidate count comes from actual persisted source events.
2. Risk is shown only for IMOs with saved current NMC assessments. Missing risk
   is visibly `NOT ASSESSED`. Opening the page never calls Airia.
3. Approved NMC case referrals appear centrally. Already scheduled NMC referrals
   cannot create duplicate SI cases.
4. New POC Service/PSC events require Editor key and are **MANUAL_REVIEW**;
   they cannot pretend to be official PSC or service authority data.
5. Supervisor Publisher key + actor + rationale are required to approve/create
   a new SI inspection-case shell; verify decision and case are in Oracle.
6. Priority impact preview computes affected candidates from saved NMC scores;
   publishing changes only priority ranking and increments rules version,
   never statutory eligibility, NMC risk, or historical approvals.
7. Reopening the page / restarting `ai-proxy` retains source events,
   approvals, new cases, and published rules.

## Rollback

If code fails: return to a verified prior Git ref and rebuild services, after
checking backwards compatibility. Do **not** automatically drop new tables or
columns. Migration 009 is additive and Oracle DDL is not transactionally
reversible; DBA-approved backup/restore is the only data-level recovery path.

## Scope gates

This first PR implements candidate source ingestion, fleet-aware rules,
officer audit decisions and SI case creation. Inspection scheduling for new
non-NMC case shells, AI dossier A04, inspector workbench, post-inspection
workflow and statutory checklist publishing are **not** claimed as completed;
they belong to separate reviewed follow-up PRs.
