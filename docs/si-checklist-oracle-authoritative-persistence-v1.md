# PR97 — Oracle-Authoritative Dynamic Checklist Persistence

## What's implemented
The Oracle 017 checklist tables shown as present in the user's verified `--plan` report are now used by the **live** Smart Inspection backend whenever `NMC_DB_MODE=oracle` (unless `SI_CHECKLIST_STORAGE=json` is explicitly selected).

This is application persistence, **not another DDL migration**. PR #96 created/fixed the schema and `405 METHOD_NOT_ALLOWED` router; PR #97 builds on top of #96, which builds on #95 and #94.

| Business operation | Authoritative Oracle state |
|---|---|
| Create/edit a checklist draft | `SI_CHK_TEMPLATE.DRAFT_JSON` with typed metadata and identity |
| Publish immutable checklist revision | `SI_CHK_REVISION`, `SI_CHK_APPLICABILITY`, `SI_CHK_GROUP`, `SI_CHK_ITEM`, `SI_CHK_ITEM_FIELD` (transactional) |
| Match multiple published checklists | Latest immutable `SI_CHK_REVISION.SNAPSHOT_JSON`; full rule matching via existing shared business logic |
| Start inspection on an approved SI case | `SI_CHK_CASE_RUN`, `SI_CHK_CASE_ITEM`, frozen revisions, matching case and source reasons |
| Save typed answers and submit | `SI_CHK_CASE_RUN.SNAPSHOT_JSON` with optimistic `VERSION_NO`, case-item projections |
| AI photo/text recommendations | `SI_CHK_AI_PROPOSAL` and `SI_CHK_EVIDENCE` metadata (image bytes kept in existing protected /data directory) |
| Inspector accept/edit/reject | `SI_CHK_AI_REVIEW` and final `SI_CHK_CASE_ITEM`, **never automatic AI approvals** |
| Change history | Append-only `SI_CHK_AUDIT` and frozen snapshots |

Every case-specific item uses a **case-scoped Oracle ID** to prevent collisions when the same template is applied to 50 ships. The API keeps its existing item IDs unchanged. All CRUD operations preserve the same optimistic-update / revision-lock semantics. All Oracle operations use the connection pool already used by the NMC backend in Oracle mode.

The checklist **JSON POC backend still works** when `NMC_DB_MODE=json`, or when explicitly overriding `SI_CHECKLIST_STORAGE=json`. No JSON source files are overwritten/deleted in Oracle mode, and no old JSON template or case is imported automatically.

## Current database status
The user submitted a read-only `--plan` report after applying migration 017:

```
owner=NMC_AI PDB=FREEPDB1
expected known tables=40 indexes=23
missing baseline=0 missing tables=0
missing columns=0 missing indexes=0
masterMissing=[] problems=[]
```

This confirms **structural presence** only, not that the UI is already using Oracle or that a live end-to-end Oracle transaction has been tested. No need to rerun 017 if the schema is already complete.

## Safe deployment on existing Windows/Docker environment

**Before anything:** verify an independently restorable Oracle backup **and** keep a copy of existing /data JSON checklist files. Protect uncommitted work before `git switch`. Do not delete volumes or Oracle data. The migration is add-only, case FK validation is mandatory.

```powershell
git status --short
git fetch origin
git switch --track origin/feature/si-checklist-oracle-persistence-20261014

$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
```

If branch exists locally use `git switch feature/si-checklist-oracle-persistence-20261014` followed by `git pull --ff-only`.

### 1. Confirm NMC is actually configured for Oracle
```powershell
docker compose @dc exec ai-proxy printenv NMC_DB_MODE
docker compose @dc exec ai-proxy printenv SI_CHECKLIST_STORAGE
```

For Oracle-backed checklists, `NMC_DB_MODE` must be `oracle`, because checklist case `SI_CHK_CASE_RUN.CASE_ID` is a foreign key to authoritative `SI_INSPECTION_CASE`. If `NMC_DB_MODE=json`, do **not** casually switch NMC to Oracle unless you have separately reconciled NMC's approved cases, fleet, and case data; checklist Oracle deliberately fails closed when NMC is JSON.

`SI_CHECKLIST_STORAGE` can be empty (automatically `oracle` when NMC is Oracle) or explicitly `oracle`. `json` is an intentional fallback, not a synchronization strategy.

### 2. Migration preflight — READ-ONLY, while the old app stays up

```powershell
docker compose @dc run --rm --no-deps ai-proxy node tools/migrate-si-checklist-json-to-oracle.mjs --plan --report=/data/si-checklist-import-plan.json
```

Checks all stored template IDs and approved SI Case IDs for import eligibility, conflicts and already-existing records; **no writes**. The script reads `/data/si-checklist-library.json` and `/data/si-checklist-case-answers.json` when present, plus real Oracle records. If no local checklists have yet been saved, counts are zero and no import is required.

Review report `templates`, `cases`, `missingApprovedCases` and `conflicts`. If old JSON case IDs are not present in `SI_INSPECTION_CASE`, stop and reconcile approved cases first. Never create fake inspection cases to satisfy a foreign key.

### 3. One-time import, **only** with verified backup

Freeze checklist edits during this step so the source JSON is not changing. If the preview has no conflicts or missing approved cases:

```powershell
docker compose @dc run --rm --no-deps ai-proxy node tools/migrate-si-checklist-json-to-oracle.mjs --apply --backup-confirmed=VERIFIED --report=/data/si-checklist-import-applied.json
```

The importer is insert-only, processes immutable template revisions **before** case execution snapshots, writes normalized items/evidence/AI reviews/audit, skips byte-for-byte-identical existing documents, and refuses conflicts. It does not delete or edit JSON source files. Since each template/case is an independent committed unit, if interrupted, rerun `--plan` and resolve any detected partial import before retry.

### 4. Activate rebuilt backend

If `NMC_DB_MODE=oracle` already, the new `ai-proxy` will prefer Oracle for Checklist by default. If you explicitly set `SI_CHECKLIST_STORAGE=json` in your `.env`, remove that override (or set `oracle`).

```powershell
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
docker compose @dc logs --tail=80 ai-proxy
```

Expected server log:

```
[si-checklist] STORAGE_ORACLE_READY schema=017
```

If older JSON checklist data were not imported, the server will **not** silently show an empty Oracle catalog. It stops with `SI_CHECKLIST_LEGACY_LIBRARY_IMPORT_REQUIRED` or `SI_CHECKLIST_LEGACY_CASE_IMPORT_REQUIRED`, so rerun the explicit import process after reviewing source records. Only override storage to JSON as a controlled troubleshooting action, knowing newer Oracle edits would not be reflected in old JSON.

### 5. Verify API and real Oracle rows without triggering AI

In the authenticated MOEI Admin browser console:

```javascript
fetch('/api/si/v1/checklists/storage/status',{credentials:'same-origin'})
  .then(r=>r.json()).then(console.log);
fetch('/api/si/v1/checklists',{credentials:'same-origin'})
  .then(r=>r.json()).then(console.log);
```

Expected storage: `ORACLE`, `oracleAuthoritative: true`. The catalog should include migrated templates. Then create a small **draft** through Checklist Settings; confirm an added row in `SI_CHK_TEMPLATE` (see SQL below). Publish only a SME-reviewed test checklist (not an invented legally mandatory regulation), confirm `SI_CHK_REVISION`, then start a real approved SI case and check the case rows.

Read-only SQL (in the existing `NMC_AI` PDB schema):

```sql
SELECT COUNT(*) AS templates FROM SI_CHK_TEMPLATE;
SELECT COUNT(*) AS revisions FROM SI_CHK_REVISION;
SELECT COUNT(*) AS groups FROM SI_CHK_GROUP;
SELECT COUNT(*) AS items FROM SI_CHK_ITEM;
SELECT COUNT(*) AS typed_fields FROM SI_CHK_ITEM_FIELD;
SELECT COUNT(*) AS case_runs FROM SI_CHK_CASE_RUN;
SELECT COUNT(*) AS answers FROM SI_CHK_CASE_ITEM;
SELECT COUNT(*) AS proposals FROM SI_CHK_AI_PROPOSAL;
SELECT COUNT(*) AS human_reviews FROM SI_CHK_AI_REVIEW;
SELECT COUNT(*) AS audits FROM SI_CHK_AUDIT;
```

## Limits and safeguards
- **This PR is Draft and is not deployed to the user's running containers.** CI uses a memory-backed Oracle executor for behavior tests; no live Oracle transaction or Airia external call can be claimed until verified on the user's POC.
- Source images remain encrypted/restricted Docker-volume evidence bytes, not Oracle BLOBs; `SI_CHK_EVIDENCE` stores content digest + stable storage reference. Object storage / antivirus / authorized retention remains a production requirement.
- The POC's single Admin role currently represents both author and inspector; official production role separation, UAE PASS/Keycloak and statutory compliance approval are not introduced here.
- The user project's finalized production architecture is **Azure SQL / Azure managed services**. Oracle is the requested existing local POC connection; do not present it as the future UAE sovereign production database.
- For a checklist already started, its pinned revisions remain authoritative for mandatory submission even when administrators later publish a new template revision.
- Because `NMC_DB_MODE` affects the whole platform, changing it to `oracle` requires a separate review of NMC data state and Oracle migrations. Never flip it blindly just to activate checklist storage.
- If Checklist `/data` JSON was empty, there is no import needed, but still verify that the NMC inspection case exists in Oracle before starting field execution.
