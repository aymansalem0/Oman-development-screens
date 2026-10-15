# MOEI POC — Complete NMC + Smart Inspection Action Reset (13 Oct 2026)

## Purpose and safety

Start the MOEI POC with **no previously taken operator actions** in NMC and SI:
- **NMC:** clear in-app operational alerts, acknowledgement/escalation history, centrally opened maritime cases, officer approvals, inspection referrals, action plans, tasks and linked incident case actions.
- **Smart Inspection:** use existing `reset-si-poc-actions.mjs` to clear selection decisions, SI inspection cases, rolling plans, dossiers, checklist answers, CAPA/inspection lifecycle and scheduled POC bookings.
- **Google Sheets incident feed (OPTIONAL BUT NECESSARY if used):** separately clear ONLY `AI_Assessments` synthetic POC assessment + officer review ledger. Preserve the raw `Incident_Registry` sheet byte-for-byte. Without this step the incident agent may reuse previously reviewed rows and immediately re-open associated cases.

**Protected:** All 99 Airia demo vessel identities, full original synthetic fleet source, vessel registrations, certificates/inspection fixture, saved A01/A02 **vessel risk assessments**, official/provisional risk policy, source service/PSC imports and event history, NMC dashboard and agent configuration, inspection checklist templates (including newly seeded mandatory drafts), local evidence image files and external vessel source feeds.

**Important baseline meaning:** Risk scoring has **not** been reset. Pre-existing assessed NMC risk will continue to show, and the alert scanner may detect new alerts after startup. That is a *new untreated alert*, not a persisted previous officer action. If you also want risk assessments cleared, that is a different data-destructive operation requiring separate authority and FK analysis.

**Not touched:** Human edits to original `Incident_Registry` fields, external maritime registries, PSC/ERP original Sheets, or production data. The Google Sheet cleanup is only for a configured sheet containing exclusively synthetic incident IDs; it blocks on non-POC rows. No tool automatically triggers Airia.

## Why separate scripts?

Oracle, local /data JSON, and Google Sheets are **three independent data stores**, so a global atomic transaction is impossible. All are backup-first and opt-in. Abort on any failed step; restore from tested backups before attempting continuation. No `down -v`, `TRUNCATE`, wildcard delete, or schema migration is used.

| Order | Script | Impact |
|---|---|---|
| 0 | Backup Docker `/data`, Oracle full restorable backup, and remote Sheets | Recovery point |
| 1 | `reset-nmc-incident-ledger.mjs --plan` / `--apply` | Removes reviewed/AI historical ledger from synthetic Google Sheet (not the incident source) |
| 2 | `reset-si-poc-actions.mjs --plan` / `--apply` | Resets SI actions, preserves source and checklist library |
| 3 | `reset-nmc-poc-actions.mjs --plan` / `--apply` | Resets NMC case/alert actions (after SI is clean) |
| 4 | `seed-si-mandatory-checklists.mjs --plan` / `--apply` | Adds 5 mandatory **DRAFT** checklist templates if missing |
| 5 | Controlled POC restart (disable automatic incident AI initially) | Ready for new demonstration |

## PowerShell — review only (safe)

> Set the Compose overlays to match your actual running environment. Use Oracle example only when `NMC_DB_MODE=oracle` and the existing external network/DB are configured.

```powershell
cd C:\Users\Admin\Oman-development-screens
if (git status --porcelain) { throw "SAVE_OR_REVIEW_LOCAL_CHANGES_FIRST" }
git fetch origin
$branch = "feature/si-poc-reset-actions-mandatory-checklist-seed-20261013"
if (git branch --list $branch) {
  git switch $branch
  git pull --ff-only origin $branch
} else {
  git switch --track "origin/$branch"
}

$dc = @("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_DB_MODE="oracle"
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc

# Stop all app-side writers; Oracle database continues running.
docker compose @dc stop nmc ai-proxy

# READ-ONLY plans — no deletes and no AI calls.
docker compose @dc run --rm --no-deps ai-proxy node tools/reset-si-poc-actions.mjs --plan --mode=oracle
docker compose @dc run --rm --no-deps ai-proxy node tools/reset-nmc-poc-actions.mjs --plan --mode=oracle
docker compose @dc run --rm --no-deps ai-proxy node tools/reset-nmc-incident-ledger.mjs --plan
docker compose @dc run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --plan --mode=oracle
```

If not using Google incident feed, omit the two Google Compose overlays and the incident ledger step. If using JSON-only, omit `compose.oracle.yaml`, use `$env:NMC_DB_MODE="json"`, and change every `--mode=oracle` to `--mode=json`.

## Backup BEFORE apply (mandatory)

```powershell
$backupDir = Join-Path (Get-Location) "poc-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$archive = "moei-before-complete-reset-$stamp.tar.gz"
docker compose @dc run --rm --no-deps -v "${backupDir}:/backup" ai-proxy sh -c "tar -czf /backup/$archive -C /data ."
if ($LASTEXITCODE -ne 0) { throw "DOCKER_DATA_BACKUP_FAILED" }
# Confirm the tar exists and is non-empty:
Get-Item (Join-Path $backupDir $archive)
# Obtain an independent ORACLE full/expdp backup from your DBA, verify a TEST RESTORE,
# and separately export the Google incident spreadsheet with its two original tabs.
# Do not claim backup-confirmed until those recovery copies are verified.
```

## Controlled apply ONLY after verified backups and dry-run review

```powershell
# Alert/Case services remain STOPPED. This variable is for maintenance scripts only.
$env:SI_POC_MAINTENANCE_WINDOW="true"
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"

# Step 1: Clear only previously saved synthetic incident AI/review ledger.
docker compose @dc run --rm --no-deps -e SI_POC_MAINTENANCE_WINDOW=true ai-proxy node tools/reset-nmc-incident-ledger.mjs --apply --ack=RESET_SYNTHETIC_INCIDENT_AI_LEDGER --backup-confirmed=VERIFIED --maintenance-confirmed=STOPPED
if ($LASTEXITCODE -ne 0) { throw "STOP_INCIDENT_LEDGER_RESET_FAILED" }

# Step 2: Reset SI approved plans, actions, cases and answers.
docker compose @dc run --rm --no-deps -e SI_POC_MAINTENANCE_WINDOW=true ai-proxy node tools/reset-si-poc-actions.mjs --mode=oracle --apply --ack=RESET_SI_POC_ACTIONS --backup-confirmed=VERIFIED --maintenance-confirmed=STOPPED
if ($LASTEXITCODE -ne 0) { throw "STOP_SI_RESET_FAILED" }

# Step 3: Reset NMC central cases, referrals, reviews, alerts and audit.
docker compose @dc run --rm --no-deps -e SI_POC_MAINTENANCE_WINDOW=true ai-proxy node tools/reset-nmc-poc-actions.mjs --mode=oracle --apply --ack=RESET_NMC_POC_ACTIONS --si-reset-confirmed=YES --backup-confirmed=VERIFIED --maintenance-confirmed=STOPPED
if ($LASTEXITCODE -ne 0) { throw "STOP_NMC_RESET_FAILED" }

# Step 4: add mandatory checklist templates in DRAFT state (non-destructive).
docker compose @dc run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --plan --mode=oracle
docker compose @dc run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --apply --mode=oracle --ack=SEED_MANDATORY_CHECKLISTS
if ($LASTEXITCODE -ne 0) { throw "STOP_MANDATORY_SEED_FAILED" }

# Step 5: Restart, keeping chargeable incident auto-triage disabled initially.
docker compose @dc up -d ai-proxy nmc
docker compose @dc ps
docker compose @dc logs --tail=60 ai-proxy nmc
```

**Never apply** until you have personally reviewed dry-run table counts and confirmed that the Oracle owner is `NMC_AI` / PDB `FREEPDB1`, and that the Google Sheet is **SYNTHETIC_POC** only. POC reset snapshots written inside `/data/*reset-backups` are supplementary and **not** replacements for external, independently restorable backups.

### Acceptance criteria

- NMC central cases and operator history: **0**. NMC alerts: **0 initially**, potentially recreated naturally on next alert scan from **unchanged** saved risk results.
- SI approved cases, current plans, plan overrides, checklist case answers and manual decision history: **0**.
- `Incident_Registry` unchanged; Google `AI_Assessments` has header only after optional controlled reset.
- Saved vessel assessments, Airia 99 original identities, source event counts, PSC/service imports, checklist library and versioned settings unchanged.
- Exactly five mandatory POC checklist templates exist as drafts (unless earlier versions were already present).
- No Airia calls from any reset/seed action.

### Limitations

- SI case checkpoint, NMC alert and incident review cleanup **do not** clear historic actual actions on external platforms (real authority databases, service portals, manual Incident_Registry edits).
- Changing the legal/official historical audit trail is **never appropriate in production**. This procedure is for isolated synthetic POC sandboxes only.
