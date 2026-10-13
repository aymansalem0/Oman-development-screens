# MOEI Smart Inspection — clear plans and prepare two MSW-aligned Excel source feeds

## Scope

**Plan-only reset**, not the full NMC/SI action reset in PR #104.

Clear ONLY:
- `SI_PLAN_ROLLING` and its four dependent Oracle 018 plan/version/audit/vessel/reason tables.
- The three JSON POC planning files: `si-rolling-plans.json`, `si-inspection-plan.json`, and `si-approved-batch-plans.json`.
- Past C01 plan proposal, local rank overrides, approved-plan snapshots and completed plan-batch **job view**.

**Preserve** the 99 Airia demo vessel identities, MSW source event imports, PSC quota configuration, service requests and port calls, NMC cases, risk assessments, previous inspection **cases**, already recorded inspections, and mandatory checklist definitions/answers. This is not a regulatory data purge.

> If there are already **approved SI inspection cases**, simply deleting their plan records does NOT make those cases newly eligible again. Use the separate backup-first full SI actions reset only if you explicitly want those inspection cases and downstream activities erased too. A completed or approved plan can be reset only after `--include-approved=YES` and verified backup. Never do this on production.

## MSW source files: real export versus simulated input

Two separate Excel workbooks are generated, **NOT extracted from a live MSW**. Their names intentionally contain `POC`:

| Excel file | Required importer tab and headers | Demo rows |
|---|---|---:|
| MSW_Service_Requests_POC_99_Cohort.xlsx | `SERVICE_REQUESTS`: `request_id,request_reference,imo,port,request_date,service_type,notes` | 60 |
| MSW_PSC_Port_Calls_POC_99_Cohort.xlsx | `PSC_PORT_CALLS`: `port_call_id,port_call_reference,imo,port,eta_local,visit_purpose,notes` | 45 |

These 105 synthetic source events collectively reference **exactly 99 unique vessel IMOs**, with six vessels in both feeds. The IMOs/names derive from Airia Partner Guide §8; ALL requests, IDs, ports, dates, visit purposes and service types are invented test data, not MSW transactions. The importer marks these as `POC_SIMULATOR / UNVERIFIED` and never grants regulatory approval. Real MSW extracts require a verified MSW API/export and field mapping; replace the rows and preserve the exact headers.

**Do not confuse arrival ETA with departure ETD.** PSC source import creates port-call candidates; PSC quota/selection remains a separate mandatory gate.

## Windows PowerShell — update and read-only reset preview

These commands use the user's existing Oracle compose example; adapt overlays to your deployed configuration.

```powershell
cd C:\Users\Admin\Oman-development-screens
if (git status --porcelain) { throw "Review or commit local changes first" }
$branch="feature/si-plans-only-reset-msw-xlsx-20261013"
git fetch origin
if (git branch --list $branch) {
  git switch $branch
  git pull --ff-only origin $branch
} else {
  git switch --track "origin/$branch"
}
$dc = @("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_FLEET_AUTO_ENABLED="false"
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc stop nmc ai-proxy

# Safe: prints counts and statuses, deletes NOTHING
docker compose @dc run --rm --no-deps ai-proxy node tools/reset-si-plans-only.mjs --mode=oracle --plan
```

### Backup before any --apply

```powershell
$backupDir=Join-Path (Get-Location) "poc-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$archive="moei-si-plans-$(Get-Date -Format yyyyMMdd-HHmmss).tar.gz"
docker compose @dc run --rm --no-deps -v "${backupDir}:/backup" ai-proxy sh -c "tar -czf /backup/$archive -C /data ."
if ($LASTEXITCODE -ne 0) { throw "Docker volume backup failed" }
Get-Item (Join-Path $backupDir $archive)
# Separately obtain and TEST RESTORE a DBA-managed Oracle backup.
# The in-script per-table JSON snapshots are SUPPLEMENTARY; NOT a tested DB recovery point.
```

### Optional: apply PLANS-ONLY reset (destructive)

```powershell
# ONLY after the Oracle+volume backups are verified, all writers stopped,
# and the --plan output is checked for approved plans/linked inspection cases.
$env:SI_POC_MAINTENANCE_WINDOW="true"
docker compose @dc run --rm --no-deps -e SI_POC_MAINTENANCE_WINDOW=true ai-proxy node tools/reset-si-plans-only.mjs --mode=oracle --apply --ack=RESET_INSPECTION_PLANS_ONLY --backup-confirmed=VERIFIED --maintenance-confirmed=STOPPED --include-approved=YES
if ($LASTEXITCODE -ne 0) { throw "Stop: plans-only reset failed. Inspect snapshots before proceeding." }
docker compose @dc up -d ai-proxy nmc
docker compose @dc ps
docker compose @dc logs --tail=70 ai-proxy nmc
```

For JSON-only POC use `$dc=@("-f","compose.yaml")` and `--mode=json`. Never run `docker compose down -v`. `--include-approved=YES` is needed only if approved/completed plans or bulk jobs exist. An attempt to apply without verified backup/maintenance confirmation must fail closed.

### Generate/download the two reproducible Excel files

The workbooks are supplied as conversation downloads; this tool can also recreate them on your Windows host after building the image:

```powershell
$exportDir=Join-Path (Get-Location) "MSW_POC_Imports"
New-Item -ItemType Directory -Force -Path $exportDir | Out-Null
docker compose @dc run --rm --no-deps -v "${exportDir}:/exports" ai-proxy node tools/generate-msw-demo-feeds.mjs --out=/exports
Get-ChildItem $exportDir -Filter "MSW_*.xlsx"
```

If regenerating, the script refuses to overwrite existing files unless `--overwrite-poc-only` is explicitly passed.

**Import paths:** Smart Inspection > Settings > Candidate Source Imports. Select `SERVICE_REQUEST` for `SERVICE_REQUESTS` and `PSC_PORT_CALL` for `PSC_PORT_CALLS`, upload one workbook at a time, run **Preview**, review validation/duplicates, then **Commit**. Import is independent of creating a plan. The NMC source cannot be uploaded via either workbook.

## Validation

- New rolling plan list is empty; standalone C01 plan has no previous rank/selection run.
- SI candidate source requests/PSC import counts stay unchanged after plans reset.
- NMC cases, official risk, Airia 99, published settings and mandatory checklist templates remain unchanged.
- If old approved inspection cases exist, `createdWorkflows` may still show them. This is intentional and means additional **full SI action reset** needs explicit approval.
- Tests ensure both generated spreadsheets have exact workbook/tab names and parser-compatible column values; 60+45 with six shared IMOs = 99 unique in-scope vessels.

**Release status:** draft stacked PR; no reset has been executed on your local Oracle or MSW.
