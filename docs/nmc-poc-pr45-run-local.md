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
Keep your previously approved controlled `NMC_FLEET_AUTO_ENABLED` and `NMC_FLEET_AUTO_MAX_VESSELS` values unchanged; do not increase paid Airia scope as part of a UI update.
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

## 5. Command Center live-risk UI regression (frontend-only)

- Frontend polls the read-only `GET /api/ai/fleet/status` every 7 seconds. It displays Oracle-backed `counts`, validated saved vessel `score`/`level`, attention list, latest completed assessment events and vessel map colors without running Airia.
- Any browser-local Risk Management ruleset version must **not** hide an already saved assessment or reclassify its published level. Historical score and ruleset remain unchanged; no browser-side recalculation replaces Oracle evidence.
- On first page load, **no vessel is selected**: the details pane asks the officer to select one. Only map/list clicks reveal the vessel details and selected route. Opening or polling the screen must not auto-select a vessel. Hovering over an unselected marker does not reveal a vessel dossier.
- Existing selection remains in view when subsequent polling refreshes the selected vessel's saved score; a clean page reload starts unselected.
- With the example controlled two-vessel rollout, if backend `counts` reads `assessed:2`, `pending:418`, `watch:1`, `priorityReview:1`, expect those figures on Command Center and one corresponding Priority Review item. Check actual backend counts before treating this as fixed test data.
- The earlier Command Center risk-label fix was frontend-only. The newer Guidance Rules and fresh Oracle Fetch Again features (section 6) also update `ai-proxy` and require additive migration 006 for guidance persistence. Never recreate Oracle or widen scheduler scope.

## 6. Risk Intelligence, Operational Guidance Settings and database refresh (migration 006)

**IMPORTANT: This increment touches the ai-proxy backend AND Angular frontend and adds an optional, manually provisioned Oracle schema.** Existing cases, alerts, assessments and audit history are never reset or migrated destructively.

### DBA-run additive schema step, AFTER backup

Before upgrading the backend UI with Operational Guidance, confirm migration 005 has been applied and ensure the following three tables are NOT present in the `NMC_AI` user schema:
`NMC_GUIDANCE_POLICY`, `NMC_GUIDANCE_POLICY_AUDIT`, `NMC_GUIDANCE_RESULT` (three tables, plus its index).
The script is `ai-proxy/migrations/006_nmc_operational_guidance.sql`.
If any object already exists, **STOP** and reconcile with DBA; Oracle DDL auto-commits and partial reruns are unsafe.

PowerShell:

~~~powershell
docker ps --filter "name=oracle-free-23"
docker cp .\ai-proxy\migrations\006_nmc_operational_guidance.sql oracle-free-23:/tmp/006_nmc_operational_guidance.sql
docker exec -it oracle-free-23 bash
sqlplus /nolog
~~~

SQL*Plus (connect with existing approved credentials; never paste secrets into chat):

~~~sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SHOW USER;
SELECT SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'NMC_GUIDANCE_%';
-- Expect ZERO ROWS before the first ever migration 006 run.
@/tmp/006_nmc_operational_guidance.sql
EXIT
~~~

If migration 006 is missing, the backend still starts with the **existing Fleet AI Scheduler and Case/Alert modules preserved**; the new Guidance Settings API fails closed with a schema error. Apply migration before testing the guidance UI.

### Deploy (preserve existing 10-vessel controlled scope)

~~~powershell
git status --short
git pull --ff-only origin feature/nmc-a01-actions-inspection-referral-v1
# Reuse your EXISTING $compose from successful Google PSC + Oracle run:
docker compose $compose config --quiet
docker compose $compose build ai-proxy nmc
docker compose $compose up -d --no-deps --force-recreate ai-proxy nmc
docker compose $compose ps
~~~

**Do not** execute `down -v`, recreate `oracle-free-23`, reveal .env secrets, or widen `NMC_FLEET_AUTO_MAX_VESSELS` as part of this UI change. Check `GET /api/ai/fleet/status` after restart to verify your original saved risk assessments remain intact.

### Acceptance

- **Command Center:** 4 lower operational cards are now Contacts, Require Attention, Active Maritime Alerts, Open Maritime Cases. The latter two read actual persisted alert and case workflows. No fake zeros on failed reads.
- **Reset map:** only restores map bounds/search/filter and preserves selected vessel, stored assessment scores, priorities and existing cases; it also executes a **read-only fresh DB fetch**. It cannot delete cases or risks.
- **Fetch Again (Database):** explicit button calls `GET /api/ai/fleet/saved-status`. This endpoint reads Oracle `loadLatest()` directly (or JSON in JSON mode) with **zero Airia/PSC calls**, no task changes, no database writes. Existing 7s read-only polling continues for saved display updates.
- **Automatic AI reevaluation:** remains **server-side hourly scheduler** with the existing bounded rollout, processing only changed **supported inputs**. Current change fingerprint covers synthetic vessel bundle, external PSC simulated inspection/deficiency/detention fields and ruleset. Current POC does NOT ingest real PDFs or arbitrary Google Drive document revisions; these must be added as a separate secure document-source connector and versioned document manifest before claiming document-change-triggered AI reassessment.
- **Risk Intelligence:** canonical route `/#/moei/nmc/vessel/9328471/risk`. Keeps Risk Classification Thresholds; correct saved Oracle 60/Watch (not old fictitious 86), five saved A01/A02 factors, published assessment weights, evidence IDs and source reasons; Platform-composed Situation Summary; Platform Operational Guidance (not Airia recommendations). No Airia calls on GET. Former `/ai-assessment` route is an alias to Risk Intelligence to prevent conflicting legacy baseline screens.
- **Settings → Operational Guidance Rules:** `/#/moei/nmc/admin/operational-guidance`. A rule editor **creates new rules as unpublished drafts**, configures up to six AND-linked evidence conditions per rule, edits draft revisions (Editor key), publishes with supervisor key, lists audit, and tests published policies against one saved IMO without AI or cases. Four initial POC rules, two disabled until evidence/authority is available; no hardcoded static fake closures.
- **Maritime Case:** approved A01 proposed actions remain the sole task source, generated on explicit Create Case. Its immutable source Risk Score and assessment ID link back to full Risk Intelligence. No reset or Risk page opens a new case.
- **Oracle guidance materialization:** new successful assessments trigger deterministic advisory materialization in the background; older assessments can be evaluated from saved factors through read-only GET without rerunning A01/A02. No automatic change to source scores or tasks.

### Risk Management settings vs immutable Oracle AI assessments

The original `/#/moei/nmc/admin/risk-configuration` screen saved rules to **browser localStorage**, not Oracle. Previously its `Publish & Recalculate 420 Vessels` message was misleading: it had been calculating synthetic fixture risk across 420 vessels while only 10 saved A01/A02 assessments existed. This increment corrects the behavior and labels both the scope and source.

- **Risk Settings Impact Analysis:** compares current vs draft scoring on the vessels with five actual saved A01/A02 factor severities retrieved from the backend. An unassessed vessel never receives an invented score. Displayed data are projections, not persisted Oracle decisions.
- **Risk Intelligence:** replays the exact deterministic fleet risk formula using those same saved A01/A02 severities and the currently published local Risk Settings. Its prominent **Policy Projection** score/level and five weighted contributions now respond to changing thresholds, weights or calculation mode. The header also displays the immutable Oracle assessment (score, class, ruleset version), so no one can mistake a UI projection for a saved regulatory decision.
- **Threshold change alone does not change the numeric score.** E.g. a previously saved score of 60/Watch with thresholds 45/65/85 becomes **60/Critical** under browser settings 10/30/50. A weight or mode change can change the numeric score itself.
- **Operational Guidance, Cases, Alerts, Command Center fleet counts, Vessel 360 saved status and Fleet Scheduler** still read server/Oracle assessments and do **not** respond to another browser's localStorage rules. The current UI shows this explicitly. For fully authoritative ministry-wide policy publication and global re-scoring, a separate server-side versioned risk-ruleset workflow with controlled assessment re-projection, auditing and consistent downstream consumers is required; do not claim the browser preview has completed that step.

Safe frontend-only deploy for this change: pull the branch, `docker compose $compose build nmc`, then `docker compose $compose up -d --no-deps --force-recreate nmc`. Do not rebuild Oracle, rerun Migration 006 or issue Airia requests for a classification-only change.

### Alerts & Notifications: risk policy live eligibility (browser preview)

This change also updates `/#/moei/nmc/alerts` so risk settings changes affect what is displayed **in that browser**. The current policy and corresponding A01/A02 evidence projection are shown in a visible banner. The page refreshes from the persisted Oracle alert API every 15 seconds (or with Refresh), and rechecks its risk eligibility. An alert that no longer meets `High/Critical` thresholds is hidden from the **Active** view and its local KPI counters; it remains visible, flagged as locally not applicable, under **All**, with its unmodified Oracle audit and any linked maritime case.

**Whole-fleet Risk Projection:** the page retrieves the Oracle-backed fleet saved-status snapshot and five A01/A02 factor severities for **every assessed vessel**, not merely vessels with preexisting alerts. This recalculates the Normal / Watch / High / Critical distribution, projected fleet risk score SUM and AVERAGE, assessed/420 coverage and alert eligibility from the **published local Risk Settings**. An older alert card shows the **current projected score first** and the original immutable Oracle score second.

**Newly qualifying risks:** a saved AI vessel that becomes High/Critical under local Risk Settings but has no active persisted alert appears in **New Risk Notifications — Projection Only**, without operational buttons. The KPI explicitly distinguishes new projected candidates from real active Oracle alerts. The UI neither creates official alerts nor calls A01/A02. A central ministry-wide risk-policy publication and controlled backend alert reconciliation is required before operational users can be notified or create an official case from these candidates.

**SAFETY:** An open critical inspection finding independently keeps the alert eligible even if the weighted score is Watch or Normal. The current MV Gulf Horizon alert is one such example. Never auto-close a safety-related alert or case solely because a score threshold changed.

The Command Center's active-alert count and the sidebar's unread count use the same **browser-only eligibility projection** for consistency. No paid A01/A02 calls run for a refresh. Missing or invalid AI inputs fail open so safety alerts are not accidentally hidden.

**LIMITATION:** Risk Management settings are still saved to the browser's `localStorage` rather than a centrally published Oracle Risk Policy. Consequently the backend persisted Alert state / audit stays unchanged, browser-independent users may see different active projections, and the server scanner still uses the original saved risk + independent critical finding. This is a read-only display projection, **not** permanent deletion or an authoritative policy-driven reconciliation. Fully central alert suppression, new rule-triggered alerts, and server-wide distribution require a separately approved versioned Oracle risk-policy migration, backend compatibility/reconciliation workflow and explicit business governance for alerts with cases. No past cases are silently deleted.

Safe deployment: `docker compose $compose build nmc` then `docker compose $compose up -d --no-deps --force-recreate nmc`. Oracle, migrations and ai-proxy are not touched by this frontend-only increment. Test with an existing saved HIGH alert without an independent critical finding: raise High/Critical settings above its projected score, and confirm it disappears from Active but remains under All; then restore settings to confirm it reappears. MV Gulf Horizon remains Critical if its independent critical open finding is present.

### Quick PowerShell verification

~~~powershell
$health=Invoke-RestMethod http://localhost:4200/api/ai/health
$health.persistence | Format-List
$saved=Invoke-RestMethod http://localhost:4200/api/ai/fleet/saved-status
$saved.counts | Format-List
$saved.results.'9328471' | Format-List
Invoke-RestMethod http://localhost:4200/api/ai/guidance/rules |
  Select-Object -ExpandProperty rules | Select-Object id,status,publishedRevision
Invoke-RestMethod http://localhost:4200/api/ai/guidance/vessels/9328471 |
  Select-Object -ExpandProperty rules |
  Select-Object ruleId,priority,status,evidenceIds
~~~

## 7. Verification / known limits

- Backend unit test: `npm --prefix ai-proxy test`. Syntax: `npm --prefix ai-proxy run check`. Angular: `npm run build` (Node.js/npm required).
- Oracle migration 005 adds only the new allowed audit action names. There are no new independent inspection tables in this increment; referrals are stored within versioned central NMC_CASE JSON and audit.
- Scheduling requires a human operator (shared POC staging editor key); production-grade scheduler RBAC/Keycloak, A04 live dossier and A02 post-inspection recalculation are later work.
- If `CASE_SOURCE_ASSESSMENT_UNAVAILABLE` appears, verify saved source assessment and initial alert provenance. Do not recreate fake scores or relaunch fleet assessments to bypass checks.
- If A01 response has no valid action list, Airia pipeline output needs correction; don't pretend fixture tasks were AI-generated.

## 8. Central Oracle Risk Policy — migration 007, immutable version history

Risk Management now uses a single centrally active policy (rather than independently published localStorage copies) after migration **007**. `NMC_RISK_POLICY_VERSION` is an append-only policy snapshot ledger; `NMC_RISK_POLICY_ACTIVE` points to exactly one effective revision; `NMC_RISK_POLICY_PROJECTION` retains version-specific calculated risk with references to the original saved `NMC_AI_ASSESSMENT.ASSESSMENT_ID`. It **does not overwrite** source AI results, existing maritime cases or historical alert audit.

A supervisor with the already configured `X-NMC-DASHBOARD-KEY` PUBLISHER credential approves a new version with a required change reason and operator label. Optimistic `expectedRevision` guards concurrent edits. Each publication stores a full snapshot and a link to the previous revision. The Risk Settings page shows version history with change descriptions and displays the currently active version. Historical local browser versions cannot be reconstructed from localStorage automatically; an existing browser setting can only be imported as a **new unpublished draft**.

**STOP/DBA preflight:** take backup, verify `NMC_AI` and `FREEPDB1`, and check that no `NMC_RISK_POLICY%` tables exist before the FIRST run. Oracle DDL autocommits; if partially installed, reconcile manually rather than rerun. Run `ai-proxy/migrations/007_nmc_risk_policy_versioning.sql` in SQL*Plus as NMC_AI. Then restart **ai-proxy** using the EXISTING three Compose files (do not recreate Oracle), followed by the `nmc` Angular container. The application seeds **NMC Risk Ruleset 1.0** centrally ONLY when all 007 objects exist; it intentionally does not assume a user browser's prior 1.13 is the authoritative nationwide baseline.

Check read-only endpoints after startup:

~~~powershell
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy | ConvertTo-Json -Depth 5
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy/history | ConvertTo-Json -Depth 5
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy/projections | Select-Object policyRef,assessed
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy/vessels/9328471/history |
  ConvertTo-Json -Depth 5
~~~

Test with no paid agents: save a DRAFT, enter a precise reason, publish using authorized supervisor key, verify new `policyRef` and `previousRevision` in history and active pointer, and verify saved original `score` unchanged while projected score/class and effective Fleet status reflect current settings. Verify no maritime case or historical alert audit has been deleted or auto-closed. Current policy is used for alert eligibility; a critical open finding remains an independent notification trigger.

**Windows / Docker without SQL*Plus — safe manual alternative (new):**

The standalone `ai-proxy/tools/apply-risk-007.mjs` uses the **existing** AI Proxy Oracle connection, executes precisely the four audited `CREATE TABLE` / `CREATE INDEX` statements in migration 007, and never uses DBA credentials. It verifies `NMC_AI`, `FREEPDB1`, the existing AI assessment schema, and that **none** of the new risk-policy objects already exist; stops on partial migration. It will **not apply** anything without explicit `--apply --backup-confirmed` flags. The backup must actually have been taken and verified by the owner first — the flag is only a manual acknowledgment.

~~~powershell
# From the repository root on the correct feature branch, AFTER git pull:
$container='moei-nmc-poc-ai-proxy-1'
docker cp .\ai-proxy\tools\apply-risk-007.mjs "${container}:/app/apply-risk-007.mjs"
docker cp .\ai-proxy\migrations\007_nmc_risk_policy_versioning.sql "${container}:/app/nmc-risk-007.sql"

# Read-only Oracle inspection; DOES NOT run DDL:
docker exec $container node /app/apply-risk-007.mjs --check

# Stop here and have DBA confirm the existing Oracle backup.
# ONE-TIME DDL, ONLY after backup confirmation and passing preflight:
docker exec $container node /app/apply-risk-007.mjs --apply --backup-confirmed

# Restart ai-proxy only to activate the new 1.0 central baseline:
$compose=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml')
docker compose $compose restart ai-proxy
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy | ConvertTo-Json -Depth 5
~~~

**Never rerun** migration 007 if even one policy table/index exists. Existing saved legacy browser policy (e.g. 1.13) is intentionally **not** imported automatically; it can be manually imported as a draft in the Risk Settings UI and published as a new central version.

**Important:** No DDL is auto-applied during build or startup. CI passing confirms syntax and simulated logic, **not an Oracle migration execution or deployment on the user's machine**. Apply 007 only after DBA preflight and backup.

