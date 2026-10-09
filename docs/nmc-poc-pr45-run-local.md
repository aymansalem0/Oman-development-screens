# MOEI NMC POC — PR45 Local Acceptance (Windows PowerShell + existing Oracle)

Branch: `feature/nmc-a01-actions-inspection-referral-v1`.
This branch includes PR44's risk-display fix and PR45's A01 proposals / human-approved tasks / Smart Inspection scheduling queue.
**Not merged; run on existing POC with a backup.** No production claims.

## 0. Safety and source control

- Save/commit/stash your uncommitted work before changing branches. Inspect `git status --short`; do not override existing changes.
- Do **not** reset the DB or run `docker compose down -v`.
- Do not overwrite an existing .env or expose secrets in screenshots/logs.
- Reuse the *same* Compose Google PSC mode as the previously working POC (with override only if credentials file exists).

~~~powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-a01-actions-inspection-referral-v1
# If the branch is already present locally:
# git switch feature/nmc-a01-actions-inspection-referral-v1
git pull --ff-only origin feature/nmc-a01-actions-inspection-referral-v1
~~~

## 1. Existing environment and Oracle preflight

Ensure local `.env` contains your **existing** valid values:
`AIRIA_MENA_KEY`, `AIRIA_BASE_URL` (use your existing working endpoint),
`NMC_DB_MODE=oracle`, `NMC_DB_CONNECT_STRING=oracle-free-23:1521/freepdb1`,
`NMC_DB_USER=NMC_AI`, `NMC_DB_PASSWORD`, 
`NMC_DASHBOARD_EDITOR_KEY` and a *different* `NMC_DASHBOARD_PUBLISHER_KEY`.
Set `NMC_FLEET_AUTO_ENABLED=false` for cost controlled, manually triggered tests.
Make sure `oracle-free-23` is running and already reachable via the `nmc-oracle-link` Docker network.

Because migration 004 uses a restrictive Oracle CHECK on case audit action names,
**new PR45 A01 decisions cannot be saved into Oracle without migration 005**.
Use an NMC_AI schema backup/DBA review before DDL. Migration 005 does NOT drop any existing rows/tables.

~~~powershell
docker ps --filter "name=oracle-free-23"
docker cp .\ai-proxy\migrations\005_nmc_case_ai_actions_audit.sql oracle-free-23:/tmp/005_nmc_case_ai_actions_audit.sql
docker exec -it oracle-free-23 bash
sqlplus /nolog
~~~

Inside SQL*Plus:
~~~sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SHOW USER;
SELECT SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES
WHERE TABLE_NAME IN ('NMC_CASE','NMC_CASE_AUDIT');
SELECT CONSTRAINT_NAME, STATUS FROM USER_CONSTRAINTS
WHERE TABLE_NAME = 'NMC_CASE_AUDIT'
AND CONSTRAINT_NAME IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2');
~~~
Proceed ONLY if both tables already exist (004 applied) and the **old check is present while V2 is absent**. If V2 is present, do not rerun migration 005. If 004 is missing, stop and follow the documented 004-first preflight/backup procedure.

~~~sql
@/tmp/005_nmc_case_ai_actions_audit.sql
EXIT
~~~
Then type `exit` to leave the container shell.

## 2. Build and start application — preserve Oracle volumes

If your existing POC uses **Google PSC** and the credentials file exists:
~~~powershell
$compose = @('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml')
docker compose $compose config --quiet
docker compose $compose build ai-proxy nmc
docker compose $compose up -d --no-deps --force-recreate ai-proxy nmc
docker compose $compose ps
docker compose $compose logs --tail 70 ai-proxy nmc
~~~

If your current POC uses **PSC snapshot** (no Google credentials), instead define:
~~~powershell
$compose = @('-f','compose.yaml','-f','compose.oracle.yaml')
~~~
Then run the same docker compose config/build/up/ps/logs commands above.
**Do not use `down -v` or recreate Oracle.**

## 3. Smoke checks (PowerShell)

~~~powershell
Invoke-RestMethod http://localhost:4200/api/ai/health
Invoke-RestMethod http://localhost:4200/api/ai/cases
Invoke-RestMethod http://localhost:4200/api/ai/inspection-referrals
Invoke-RestMethod http://localhost:4200/api/ai/fleet/status
~~~

Expected: AI proxy health is `ok`, Oracle `ready`, and JSON containing `cases`, `requests`, fleet status. Verify `aiConfigured: true` if testing real A01 (don't reveal API key).

## 4. Interactive business acceptance

1. Open `http://localhost:4200/#/moei/nmc/alerts`.
2. Find a **saved High/Critical** vessel alert (saved assessment, not a synthetic catalog score), click **Acknowledge**, then **Create Maritime Case**. Confirm that creating a case also triggers **ONE explicit Airia A01 call**. Wait for the response: the Case Workspace opens **with the validated proposed actions already saved**. There is no separate "Generate" step on a successful creation. A new case begins with **zero tasks** until a human approves A01 proposals.
3. In Case Workspace, review each real A01 proposal, then accept/reject/accept-with-note. **Only approved A01 action tasks are displayed** in Tasks & SLA. Older fixed-template tasks remain in the database and history but are hidden from the active task list, progress and closure conditions. If the creation-time Airia run fails, the case is kept and a **Retry A01 recommendations** recovery button appears; retry is manual and may make another billable call. No GET/page refresh invokes an agent.
4. Accepting **PRIORITY_INSPECTION** creates one central `PENDING_SCHEDULING` request for Smart Inspection with unchanged saved risk. The A01 pipeline must support `mode:SITUATION_ASSESSMENT`, `proposedActions`, approved action types and evidence IDs; unsupported responses fail closed, without fabricated tasks.
5. Open `http://localhost:4200/#/moei/smart-inspection/candidates`. At top, the **Required inspections for scheduling** section reads real centrally saved referrals; the synthetic candidate pool underneath remains separate.
6. Select **future date/time, port, inspector/team** and Confirm Schedule. Refresh page and another browser to verify central persistence.
7. Return to Case → **Schedule / Open Inspection** and complete all inspection checklist items as **Pass**. Submit.
8. Confirm that the request is **COMPLETED**, case inspection task is completed, and the original saved assessment (example 60/100) is **unchanged**: no fabricated -18 points or 87-point fixture replacement. **Post-inspection A02/A01 deterministic reassessment is not implemented in this PR**, and must read **pending**.

**Existing cases** can contain older hardcoded tasks and historical inspection outcomes. They remain persisted for audit but are intentionally invisible in the new AI-only task list. An existing saved A01 plan is reused without extra agent calls. Older cases without a saved plan can be recovered through the explicit Retry button; do not delete case/audit data or force a duplicate active case. Scheduled new A01 inspections use a new unique ID and do not reuse the legacy inspection result.

## 5. Verification / known limits

- Backend unit test: `npm --prefix ai-proxy test`. Syntax: `npm --prefix ai-proxy run check`. Angular: `npm run build` (Node.js/npm required).
- Oracle migration 005 adds only the new allowed audit action names. There are no new independent inspection tables in this increment; referrals are stored within versioned central NMC_CASE JSON and audit.
- Scheduling requires a human operator (shared POC staging editor key); production-grade scheduler RBAC/Keycloak, A04 live dossier and A02 post-inspection recalculation are later work.
- If `CASE_SOURCE_ASSESSMENT_UNAVAILABLE` appears, verify saved source assessment and initial alert provenance. Do not recreate fake scores or relaunch fleet assessments to bypass checks.
- If A01 response has no valid action list, Airia pipeline output needs correction; don't pretend fixture tasks were AI-generated.
