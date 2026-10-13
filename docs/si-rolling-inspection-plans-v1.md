# MOEI Smart Inspection SI-01 — Dynamic / Rolling Inspection Plans

## Scope implemented (PR #98)
Employees can now create multiple independent plans on the **same day** or across days; each plan has an independent ID, business number, execution period, optional port/location, version history, and recorded staff identity.

Business flow:
1. **Candidate Pool** is continuous. Opening it tomorrow does not create a plan, run C01, incur Airia cost, approve cases or modify prior plans.
2. **Create New Plan** makes a numbered DRAFT record with dates; create/edit two or more plans on the same day without overwriting another plan's C01 result.
3. **Open a Draft Plan** and explicitly run C01, which reads current source evidence, re-evaluates candidates, retains human selection/reordering reasons, and advances to READY_FOR_APPROVAL if any vessels are selected.
4. **Review and Approve** loads the named plan using `planId`. The existing four-step supervisor wizard preserves **all** eligible source reasons and creates approved `SI_INSPECTION_CASE` records. The approved plan stores immutable case IDs, full reason references and rank, with an auditable version.
5. **Execution** moves APPROVED -> IN_EXECUTION when the bulk workflow has created cases. When all linked inspection cases are genuinely CLOSED through the authorized SI lifecycle, IN_EXECUTION -> COMPLETED is recorded. Merely reaching the end of the plan's date does not close it.
6. **Cancel Draft** requires reason and authorization. Approved plans cannot be silently canceled or rewritten.
7. **New source event** on the same IMO and regime can create a *new* eligible candidate key; already-approved source event keys must not be reused. Approval conflicts are visible and require explicit human review.

### Oracle 018 schema
`ai-proxy/migrations/018_si_rolling_inspection_plans.sql` (additive only):
- `SI_PLAN_ROLLING`: plan identity, number, period, status and pinned JSON state.
- `SI_PLAN_ROLLING_VERSION`: append-only version ledger.
- `SI_PLAN_ROLLING_AUDIT`: actor and event history.
- `SI_PLAN_ROLLING_VESSEL`: approved vessel rank and FK to existing `SI_INSPECTION_CASE`.
- `SI_PLAN_ROLLING_REASON`: immutable per-plan/per-vessel event provenance.
These DO NOT replace or modify the legacy SI inspection cases, NMC AI risk, PSC quotas, SI-02 dossiers, dynamic checklist, or company Oracle volumes.

### Endpoints (cookie session + existing EDITOR/PUBLISHER controls)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/si/v1/inspection-plans` | List plans with status |
| POST | `/api/si/v1/inspection-plans` | Create new numbered draft |
| GET | `/api/si/v1/inspection-plans/:planId` | Read full independent plan |
| POST | `/api/si/v1/inspection-plans/:planId/cancel` | Cancel draft with reason and version |
| GET | `/api/si/v1/inspection-plan?planId=...` | Named C01 snapshot |
| POST | `/api/si/v1/inspection-plan/rerank` | C01 with `planId`, expectedRevision + expectedSourceHash |
| GET | `/api/si/v1/inspection-batches/preview?planId=...` | Named approval preview |
| POST | `/api/si/v1/inspection-batches` | Supervisor submit with `planId` |
| GET | `/api/si/v1/inspection-batches/:id` | Poll async approvals |

Old no-`planId` C01 and approval endpoints continue to exist for compatibility and must not be used by new Planning Management UI. No silent auto migration of legacy `/data/si-inspection-plan.json`.

### Deployment sequence (Windows PowerShell, LOCAL POC)
**PR #98 is DRAFT; it is NOT deployed to the user's computer by pushing to GitHub.** Only deploy after isolated tests and Angular/Docker builds pass, and a verified restorable Oracle backup exists. Do not run `docker compose down -v`, remove `oracle-free-23`, or overwrite `.env`/volumes.

```powershell
git status --short
git fetch origin
git switch --track origin/feature/si-rolling-inspection-plans-20261013
$dc = @('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'

# schema inspection ONLY, does not mutate Oracle
docker compose @dc run --rm --no-deps ai-proxy node tools/reconcile-moei-schema.mjs --plan --report=/data/moei-rolling-018-plan.json
```

**Expected:** existing baseline remains present, and five SI_PLAN_ROLLING tables are listed as missing if migration 018 was not yet applied; this is expected. If anything else is missing or incompatible, stop and review.

**Apply migration 018 separately as NMC_AI in FREEPDB1**, only after the backup and explicit DBA review. Example from PowerShell (check local SQL path before copying):
```powershell
docker cp '.\ai-proxy\migrations\018_si_rolling_inspection_plans.sql' 'oracle-free-23:/tmp/018_si_rolling_inspection_plans.sql'
docker exec -it oracle-free-23 bash
# inside container: sqlplus NMC_AI@//localhost:1521/FREEPDB1
# SQL*Plus, enter existing password when prompted, then:
# SQL> @/tmp/018_si_rolling_inspection_plans.sql
```
Do not print passwords. If your Oracle container name/schema/connect string differs, use the actual values. DDL implicitly commits in Oracle. Do not run script against the wrong PDB.

After migration 018, validate read-only `--plan` again, then run the regular app build:
```powershell
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
docker compose @dc logs --tail=100 ai-proxy
```
Expected: `[si-rolling] STORAGE_ORACLE_READY schema=018`. When schema is missing, **only the new rolling-plan API** fails closed with `SI_ROLLING_MIGRATION_018_REQUIRED` (503); NMC and Checklist continue to work.

### Acceptance checks
- Create two different plans for the same day; verify two distinct plan IDs/numbers in the UI and Oracle.
- Run C01 for plan A, verify B remains untouched and no AI runs on normal refresh/page load.
- Approve plan A only after human supervisor action, verify immutable version, vessel, reasons, existing SI Case FK and audit.
- Create and open plan B on next day; older A remains readable and no duplicate event keys are approved.
- Test cancel before approval and prevent cancel/edit after approval.
- Verify transition to IN_EXECUTION after approved case creation, and COMPLETED only when all linked lifecycle cases are CLOSED.
- Test new independent source event for previously visited IMO; old event never causes repeat case.
- Verify **no legacy Oracle/JSON loss**, no unexpected AI cost, and human regulatory sign-off remains mandatory.

### Delimitations / next quality gates
- No real Oracle integration test has been executed on the user's server; GitHub CI mock tests alone cannot establish production readiness.
- Batch jobs currently remain persisted to legacy protected `/data/si-bulk-inspection-plans.json`; they aren't in the new Oracle 018 tables. Explicit operational recovery and full two-phase transaction reconciliation across approval-job JSON and Oracle plan should be a later hardening task.
- Historical plans before migration 018 are not auto-imported into the new plan history; existing inspection cases remain authoritative.
- Official maritime scheduling, external PSC quota decisions and ministry audit/legal sign-off remain governed by their existing flows.
- UAE MOEI final production data baseline remains **Azure SQL**, while Oracle 23c is this local POC environment only.
