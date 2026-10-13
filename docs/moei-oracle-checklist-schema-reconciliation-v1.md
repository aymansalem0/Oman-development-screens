# MOEI Oracle Schema & Master Data Reconciliation — Smart Inspection Checklist (017)
**Generated for MOEI NMC + SI POC; non-destructive migration with explicit DBA control.**

## Scope: all tables known to this repository, not every application table anywhere
The existing repository provides explicit **Oracle migrations 002 through 016**, with NMC first-version schema (001) already provisioned externally. Script `reconcile-moei-schema.mjs` reviews:
- Existing NMC foundational tables `NMC_SCHEMA_VERSION`, `NMC_VESSEL`, `NMC_DATA_SOURCE`, `NMC_AI_JOB`, `NMC_AI_ASSESSMENT`, `NMC_AI_RISK_FACTOR`, `NMC_VESSEL_CURRENT_STATE`, `NMC_DATA_QUALITY`.
- Every `CREATE TABLE` / `CREATE INDEX` definition in the repository's reviewed SQL migrations `002…017`.
- Expected columns in those tables; gaps in non-null columns and legacy schema drift are reported instead of guessed repairs.
- Technical Checklist master data, and the three NMC synthetic POC data-source codes.
- Migration scripts `005, 008, 014, 016` require separate DBA inspection for **existing constraint/ALTER semantics**; `--apply` will not blindly replay these operations.

**Not claimed:** inventing a fresh NMC v1 schema without migration 001, applying undocumented business master data from Oman/UAE government, or validating all databases outside the POC schema.

## Checklist migration 017 (idempotent)
File: `ai-proxy/migrations/017_si_dynamic_checklist_schema_and_master_data.sql`

| Entity | Oracle Table | Purpose |
|---|---|---|
| Reference group + values | SI_CHK_MD_GROUP, SI_CHK_MD_VALUE | Answer fields, source reasons, inspection regimes, AI review statuses |
| Checklist definition | SI_CHK_TEMPLATE, SI_CHK_REVISION | Editable draft; immutable published revisions |
| Applicability | SI_CHK_APPLICABILITY | Vessel type, GT, DWT, referral source and inspection regime |
| Questions | SI_CHK_GROUP, SI_CHK_ITEM, SI_CHK_ITEM_FIELD | Group/Item with several answer fields per question |
| Inspection execution | SI_CHK_CASE_RUN, SI_CHK_CASE_ITEM | Approved vessel case, pinned items and execution status |
| AI and evidence | SI_CHK_EVIDENCE, SI_CHK_AI_PROPOSAL, SI_CHK_AI_REVIEW | Secure evidence metadata and human-in-loop review |
| Audit | SI_CHK_AUDIT | Case and checklist events / actor / timestamp |

The SQL is rerunnable: checks `USER_TABLES`/`USER_INDEXES` and creates ONLY absent objects, and MERGEs only missing technical lookup codes. It does **not** run automatically. It never deletes existing rows or turns an AI-generated candidate into a statutory rule.

### Master-data groups and default codes
- `ANSWER_FIELD_TYPE`: BOOLEAN, NOTE, EXPIRY_DATE, DATE, NUMBER, TEXT.
- `BOOLEAN_RESULT`: YES, NO, NA.
- `SOURCE_TYPE`: NMC_CASE, PSC_PORT_CALL, SERVICE_REQUEST.
- `INSPECTION_REGIME`: FOCUSED_INSPECTION, FOLLOW_UP_INSPECTION, PORT_STATE_CONTROL, UAE_SERVICE_INSPECTION.
- `AI_SCOPE_LEVEL`: TEMPLATE, GROUP, ITEM.
- `AI_REVIEW_DECISION`: ACCEPT, EDIT, REJECT.
- `CHECKLIST_STATUS`: IN_PROGRESS, SUBMITTED_FOR_REVIEW.

These are **platform technical vocabularies only** and are not legally authorized maritime codes. Real ship types, flag states, certificate types and statutory checklists must be sourced from reviewed ministry-approved master data.

## Recommended execution — Windows PowerShell / existing Docker Oracle

First switch to PR #96's fix branch, back up existing changes, and build the backend **without recreating the database or volumes**:

```powershell
git status --short
git fetch origin
git switch --track origin/fix/si-checklist-api-routing-20261014
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```

If the branch is already local use `git switch fix/si-checklist-api-routing-20261014`. Don't delete `.env`; don't run `docker compose down -v`; don't recreate `oracle-free-23`.

### Step A — READ-ONLY inspection (safe to run repeatedly)

```powershell
docker compose @dc exec ai-proxy node tools/reconcile-moei-schema.mjs --plan --report=/data/moei-schema-plan.json
```

Report fields: `baselineMissing`, `tablesMissing`, `columnsMissing`, `indexesMissing`, `masterMissing`, `manualReview`. All expected objects across 002–017 are checked; no writes, no AI calls, no Oracle schema changes.

### Step B — Repair (requires DBA-reviewed restorable backup)
When DBA confirms **database backup can be restored**, and after examining Step A report:

```powershell
docker compose @dc exec ai-proxy node tools/reconcile-moei-schema.mjs --apply --backup-confirmed=VERIFIED --report=/data/moei-schema-applied.json
```

Behavior:
1. STOP if fundamental NMC v1 objects are missing (this project has no initial 001 schema).
2. Create absent tables from the reviewed migrations in version order; never replace existing table.
3. Add only **safe nullable SI_CHK_** fields if a checklist table exists but is incomplete. Existing required keys, foreign keys, constraints and other non-null/legacy columns are reported for DBA review, not altered automatically.
4. Create absent named indexes, checking dictionary first.
5. Insert only missing technical Checklist master values and existing POC synthetic source codes, without changing existing names, statuses or authority flags.
6. Print actions and unresolved issues. **Oracle DDL auto-commits** and cannot be rolled back as a transaction. An interrupted run requires a new plan and DBA review.

The script needs the same existing `NMC_DB_USER`, `NMC_DB_PASSWORD` and `NMC_DB_CONNECT_STRING` already available inside `ai-proxy`. It never prints credentials.

### Step C — Verify
```powershell
docker compose @dc exec ai-proxy node tools/reconcile-moei-schema.mjs --plan --report=/data/moei-schema-after.json
```
When the results show no missing eligible objects / master values, continue to creating the first Tanker checklist in the UI.

### Optional manual SQL execution
If the database owner operates migrations exclusively through DBA/SQL Developer rather than app connections, review and apply **only** `ai-proxy/migrations/017_si_dynamic_checklist_schema_and_master_data.sql` as the EXISTING schema owner in FREEPDB1, after migration 009 and database backup. It is safe to rerun for missing objects, but it does **not** repair mismatched existing column layouts; always inspect the read-only report first.

## Current UI fix: HTTP 405 METHOD_NOT_ALLOWED
On PR #94/#95 the /api/si/v1/* fallback route was registered before the /checklists sub-route. PR #96 reorders it so `GET /api/si/v1/checklists` and `POST /api/si/v1/checklists` reach the service; the submitted Screenshot error is a backend route bug, not a Tanker checklist validation error.

After rebuilding the branch:
- Open `http://localhost:4200/#/moei/smart-inspection/settings/checklists` in an **authenticated Google SSO ADMIN session**.
- Refresh, check **Checklist Catalog**. A failed unsaved form has not been created.
- Create `Tanker Safety & Certification Inspection`, add at least one Group and one Item, **Save Draft**. If the API responds 401, sign in again; 403 means permission/session CSRF needs verification; 422 means the input schema was rejected.
- Published checklists are separate immutable versions; AI builder can be left disabled until validated.

## IMPORTANT: the existing UI has file-backed POC persistence
The current PR #94 checklist APIs save templates and individual inspector answers to protected `/data` JSON and images to a private folder. **Migration 017 adds the Oracle schema only. The running application does not yet read/write those 017 tables.** Migrating JSON checklist state to Oracle requires a separately tested persistence adapter and a one-time controlled data migration. Provisioning the tables will not retroactively move an earlier JSON draft or improve a 405 routing problem; the route fix is necessary regardless.

## Safety and production
- No official/legal mandatory checklist rules are auto-generated or auto-activated. Adding technical enumerations is not maritime legislation.
- Backups + DBA review are required. Never auto-run DDL during normal POC startup.
- POC JSON/Oracle mixed persistence is transitional. A future UAE-sovereign production design should use authoritative Azure SQL for transactional checklist state and approved UAE storage for scanned image evidence, retaining independent AI governance/human approvals.
