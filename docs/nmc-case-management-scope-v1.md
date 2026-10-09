# NMC Central Case Management — Phase 2

## Business scope
After Acknowledge, an NMC Officer explicitly selects **Create Maritime Case** on a saved-AI risk alert. One active centrally recorded case per vessel IMO is reused and additional acknowledged alerts are linked. No cases are created automatically.

Case Workspace shows centrally saved task status, linked source alert and historical AI score, Smart Inspection outcomes, supervisor resolution and versioned audit. AI Situation Assessment has an explicit Save Decision to Case action (Accept / Modify / Reject with evidence IDs and a reason when modifying/rejecting). All operations use the NMC editor key except supervisor closure, which uses the publisher key. These keys represent temporary roles, NOT per-user identity. Saved A01/A02 assessment or risk weights are never changed.

## Oracle migration 004 (manual; backup first)
Copy migration from PowerShell:

~~~powershell
docker cp .\ai-proxy\migrations\004_nmc_central_cases.sql oracle-free-23:/tmp/004_nmc_central_cases.sql
docker exec -it oracle-free-23 bash
sqlplus /nolog
~~~

Run these commands in SQL*Plus (password is requested interactively and may contain @):

~~~sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SHOW USER;
SELECT SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES
WHERE TABLE_NAME IN ('NMC_ALERT','NMC_ALERT_AUDIT','NMC_CASE','NMC_CASE_AUDIT');
~~~

NMC_ALERT and NMC_ALERT_AUDIT must already exist from migration 003. NMC_CASE and NMC_CASE_AUDIT must BOTH be absent. With an NMC_AI backup and the prerequisites confirmed:

~~~sql
@/tmp/004_nmc_central_cases.sql
SELECT TABLE_NAME FROM USER_TABLES
WHERE TABLE_NAME IN ('NMC_CASE','NMC_CASE_AUDIT');
SELECT COUNT(*) FROM NMC_CASE;
SELECT COUNT(*) FROM NMC_CASE_AUDIT;
~~~

Never rerun partially completed Oracle DDL without DBA review; Oracle DDL auto-commits. No existing table is dropped.

## Checkout and targeted Docker build (PowerShell)

~~~powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-central-case-management-v1
# If already tracking:
# git switch feature/nmc-central-case-management-v1
# git pull --ff-only origin feature/nmc-central-case-management-v1

# Existing .env: NMC_FLEET_AUTO_ENABLED=false, NMC_DB_MODE=oracle
# Reuse NMC_DASHBOARD_EDITOR_KEY and NMC_DASHBOARD_PUBLISHER_KEY.

docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --no-deps --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml logs --tail 60 ai-proxy nmc
Invoke-RestMethod "http://localhost:4200/api/ai/cases"
~~~

Never run docker compose down -v. Leave the Oracle container and all volumes intact.

## User acceptance
1. Go to http://localhost:4200/#/moei/nmc/alerts; acknowledge a High/Critical saved-risk alert, select Create Maritime Case.
2. Case Workspace must display a real central ID and task list. Open same case from another browser: no duplication or lost task state.
3. Start, complete or escalate a task. The Timeline should use server-authoritative audit data.
4. In AI Situation Assessment, Accept / Modify / Reject a recommendation, then Save Decision to Case; note mandatory on Modify/Reject.
5. Submit Smart Inspection outcome and check it appears in central case in another browser.
6. Closure before required tasks are complete must fail; after completion supervisor approves with mandatory reason.
7. Verify no change to Airia scheduler, risk assessments, Dashboard Builder and Data Quality.

## Limits of this first increment
Shared staging operator/publisher keys are not Keycloak login. Task assignment is role-based only. This increment stores reference IDs but is not an external evidence repository. Human decisions are audited but do not yet automatically create new tasks from accepted recommendations. Management/Executive KPIs come next.
