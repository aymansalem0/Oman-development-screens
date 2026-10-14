# SI-S02 — Approve schedule, inspector work orders, mandatory & A04 checklist

## Business process / UI
At `/#/moei/smart-inspection/scheduling/plan/:planId`:
1. Select an **APPROVED Inspection Plan** with its source-backed roster (NMC / PSC Excel / Service Request).
2. Keep **Use complete POC mock data** on for controlled presentation, or use a verified ERP spreadsheet. Calculate feasible schedules; optionally call SI-S01 Airia with explicit cost confirmation and review its evidence-backed preferred option.
3. When ALL approved vessels are schedulable, an authorized PUBLISHER clicks **Approve Complete Schedule & Issue Orders**, writes a reason of at least eight characters and confirms. The server **recalculates** option eligibility/ERP data and verifies the exact proposal hash. This creates ONE persisted schedule and ONE per-IMO work order. No live ERP booking or regulatory case is claimed at approval.
4. On each work order, an authenticated EDITOR clicks **Execute assignment · Prepare Checklist**. The case is created/reconciled **once** from trusted source reasons, the dossier is prepared, and the versioned mandatory published checklist is copied into the case snapshot. A04 AI suggestions, when explicitly requested and supported by current verified risk/evidence, become `DRAFT_REVIEW` and never override mandatory checks. A04 run consent is logged; no automatic paid retry.
5. Supervisor reviews the optional dossier A04 draft separately under `/#/moei/smart-inspection/preparation/:caseId`. Then on the work order clicks **Approve Scope** with a reason, choosing optional approved A04 additions only if they were separately approved. Mandatory-only inspection may proceed even while optional A04 suggestions await review.
6. The assigned authenticated inspector clicks **Start Inspection**, then enters results at `/#/moei/smart-inspection/checklists/:caseId` and follows the lifecycle. For DEMO MOCK schedules only, a separate, explicitly audited POC delegation option exists; it is **not** actual inspector IAM.
7. Saved case links are projected back into the immutable approved plan's version history; the plan switches to `IN_EXECUTION` when field execution starts.

## Operational controls and limitations
- Real NMC referrals must have an independently confirmed schedule matching inspector, port and time. A PSC/service Excel POC order is not a regulatory inspection license. No source-level selection decision is granted to AI.
- An imported ERP Excel workforce snapshot cannot be treated as a live HR roster or real ERP booking. Work orders record `operationalBookingConfirmed:false`.
- A04 is **optional and source-constrained**. For vessels without stored eligible NMC risk/verified evidence, the mandatory published checklist still starts; A04 status shows `A04_BLOCKED_SOURCE_RISK_OR_PROVIDER`. **No fake AI output is presented as a real recommendation.**
- Scope approval is separate from schedule approval; AI-suggested items enter the lifecycle checks only after manual A04 dossier review and supervisor scope approval. The checklist templates' mandatory published baseline is never overwritten.
- If there is no published mandatory checklist template, `SI_WORK_ORDER_PUBLISH_MANDATORY_CHECKLIST_FIRST` blocks preparation. In the POC, use the existing admin checklist seed utility only after reviewing its templates or publish a mandatory template in Checklist Settings.
- `SI_SCHED_MIGRATION_019_REQUIRED` is returned until Oracle schema is explicitly migrated.
- Pending production work: real ERP writeback/booking, keycloak inspector IAM-to-ERP mapping, multi-service transactional compensation/telemetry, NMC result notification and end-to-end UAT.

## Safe deployment, backup and migration

**DO NOT use `docker compose down -v` or run reset scripts**; those remove/alter data. Before DB modification obtain a verified restorable backup/snapshot of Oracle NMC_AI/FREEPDB1.

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
if (git status --porcelain) { throw "Save local changes before checkout" }
git fetch origin
$branch="feature/si-schedule-approval-workorders-checklists-20261014"
git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) { git switch $branch }
else { git switch --track "origin/$branch" }
git pull --ff-only origin $branch
```

New additive Oracle schema:
`ai-proxy/migrations/019_si_schedule_work_orders.sql`.

DBA-controlled migration (connect to **NMC_AI, FREEPDB1** through SQLcl/SQL*Plus/SQL Developer with an authorized account; SQLcl command, if installed and reachable):

```text
sql NMC_AI@//localhost:1521/FREEPDB1
@ai-proxy/migrations/019_si_schedule_work_orders.sql
```

Do not assume local host:1521 is accessible; use your actual Oracle hostname/service and confirmed DBA method. The CLI securely prompts for database credentials. After migration, **verify owner and PDB** using the read-only check below.

```powershell
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
      "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
docker compose @dc exec ai-proxy node tools/check-si-schedule-oracle.mjs
docker compose @dc exec ai-proxy node --test test/si-schedule-orders.test.mjs test/si-maritime-batch-scheduling.test.mjs test/si-plan-s01-advisor.test.mjs
docker compose @dc logs --tail=100 ai-proxy
```

Read-only Oracle test result should report `status: "READY"`, no missing tables/indexes/mutex, owner `NMC_AI`, PDB `FREEPDB1`. When running JSON POC-only mode, Oracle check naturally requires explicit DB environment; it is not a prerequisite for JSON sandbox tests.

## POC mandatory checklist seed (only after supervisor review)

The existing seed utility provides five **technical POC** mandatory templates (core, PSC, services, NMC, follow-up) and does not certify a statutory checklist. First run the **read-only** plan:

```powershell
docker compose @dc exec ai-proxy node tools/seed-si-mandatory-checklists.mjs --plan --mode=oracle
```

Only when the supervisor has reviewed and accepted the POC templates, publish once:

```powershell
docker compose @dc exec ai-proxy node tools/seed-si-mandatory-checklists.mjs `
 --apply --publish --review-confirmed=YES --ack=SEED_MANDATORY_CHECKLISTS `
 --mode=oracle --actor=MOEI_POC_SUPERVISOR
```

The seed is additive/idempotent and does **not** modify old checklist answers. No ministry regulatory approval is implied. For a JSON sandbox use `--mode=json` instead.
## Regression acceptance
- Approve one complete, current-hash plan; saved schedule includes one immutable work order per selected vessel, assignments non-overlapping, and audit. Repeat approval returns same schedule.
- Try stale proposal, invalid option, incomplete coverage or engineer conflict: 409/422; no partial approval.
- Activate task: ONE case linked to original plan, ONE dossier, published mandatory checklists snapshotted, A04 draft separated; refreshing does not repeat case or paid request.
- Without published mandatory checklist, show actionable error; no bogus empty inspection.
- Without supervisor scope approval, inspector cannot start; after supervisor approval, start by assigned identity only (or explicit MOCK delegation).
- Lifecycle/Checklist UI opens correct case and plan maintains case linkage through closure.
- Do not claim NMC closure or live ERP booking based solely on approved spreadsheet/POC task.

## SQL sanity queries (DBA)
```sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'SI_SCHED_%' ORDER BY TABLE_NAME;
SELECT STATUS_CODE,COUNT(*) AS CNT FROM SI_SCHED_WORK_ORDER GROUP BY STATUS_CODE;
SELECT SCHEDULE_ID,PLAN_ID,MODE_CODE,APPROVED_BY,APPROVED_AT
 FROM SI_SCHED_APPROVAL ORDER BY APPROVED_AT DESC FETCH FIRST 10 ROWS ONLY;
```
