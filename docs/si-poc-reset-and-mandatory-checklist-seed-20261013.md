# MOEI Smart Inspection — Action Reset + Mandatory Checklist Seed
**Controlled local POC maintenance • 13 October 2026**

## Exact scope

The reset returns **Smart Inspection operator actions** to a clean demonstration starting point:
- Removes recorded SI candidate/PSC selection decisions, approved SI cases, rolling/standalone plans, AI prioritization history, inspector dossier/lifecycle/checklist answers, SI batch jobs and scheduler proposals/confirmations.
- Retains **source events and imports**, published selection/ranking & PSC policies, NMC incident data, NMC_CASE / NMC_CASE_AUDIT, all NMC assessments/risk scores/alerts, fleet identities (including partner Airia 99), ERP workforce source, checklist template library and normalized published checklist definitions.
- NMC central case officer actions are intentionally NOT deleted; some NMC referrals may therefore still be visible after the reset. Request a separate approved NMC reset if those must be reset as well.
- The reset does not remove uploaded checklist evidence objects or already downloaded source files. It only clears references in SI checklist case actions; evidence files are preserved in the Docker volume for audit/recovery.
- Oracle is required to have migrations 009–018 applied where appropriate. Scripts **never** issue DDL or run schema migrations automatically.

### Important: backups & reversibility

`--plan` is read-only. `--apply` is destructive and allowed only when:
1. The UI and AI proxy service are **stopped**; no concurrent writes are possible.
2. The administrator has verified a **restorable external Oracle database backup** and the Docker volume is backed up.
3. All explicit flags are provided. The script also saves snapshots to `/data/si-poc-reset-backups/<timestamp>/` with private permissions, before Oracle transaction delete. This supplementary snapshot is NOT a replacement for a DBA-tested database backup.
4. The Oracle owner is `NMC_AI` in `FREEPDB1`. Unexpected foreign keys abort. Only explicit SI action tables can be deleted. JSON case/plan action files are reset while source records and policies are retained.

## PowerShell: preview, backup, apply, then seed

Set `$compose` to the exact set of Compose files already used locally. **Oracle example**:

```powershell
cd C:\Users\Admin\Oman-development-screens
git fetch origin
git switch --track origin/feature/si-poc-reset-actions-mandatory-checklist-seed-20261013

$compose = @("-f","compose.yaml","-f","compose.oracle.yaml")
docker compose @compose config --quiet
docker compose @compose build ai-proxy nmc
docker compose @compose stop nmc ai-proxy

# STEP 1 -- plan only: NO DELETES
docker compose @compose run --rm --no-deps ai-proxy node tools/reset-si-poc-actions.mjs --plan --mode=oracle

# STEP 2 -- BACK UP the local volume AND verify an external/restorable Oracle backup.
# Backup the entire mounted /data volume to your Windows project folder first.
# With the app already stopped, this also saves JSON action history and checklist evidence.
$backupDir = Join-Path (Get-Location) "poc-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$archive = "moei-si-pre-reset-$(Get-Date -Format yyyyMMdd-HHmmss).tar.gz"
docker compose @compose run --rm --no-deps -v "${backupDir}:/backup" ai-proxy sh -c "tar -czf /backup/$archive -C /data ."
if ($LASTEXITCODE -ne 0) { throw "POC_VOLUME_BACKUP_FAILED" }

# Separately obtain and RESTORE-VERIFY an Oracle DB backup with the DBA.
# Do NOT proceed to STEP 3 until Oracle recovery is confirmed.

# STEP 3 -- ONLY AFTER REVIEW/EXTERNAL BACKUP; destructive reset:
docker compose @compose run --rm --no-deps -e SI_POC_MAINTENANCE_WINDOW=true ai-proxy node tools/reset-si-poc-actions.mjs --mode=oracle --apply --ack=RESET_SI_POC_ACTIONS --backup-confirmed=VERIFIED --maintenance-confirmed=STOPPED

# STEP 4 -- preview 5 mandatory CHECKLIST templates. No write.
docker compose @compose run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --plan --mode=oracle

# STEP 5 -- additive/idempotent DRAFT seeding.
docker compose @compose run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --apply --mode=oracle --ack=SEED_MANDATORY_CHECKLISTS

# STEP 6 -- separate controlled publication only after business/regulatory review.
# docker compose @compose run --rm --no-deps ai-proxy node tools/seed-si-mandatory-checklists.mjs --apply --publish --mode=oracle --ack=SEED_MANDATORY_CHECKLISTS --review-confirmed=YES

docker compose @compose up -d ai-proxy nmc
docker compose @compose ps
docker compose @compose logs --tail=50 ai-proxy
```

If using the pure JSON POC, change `$compose=@("-f","compose.yaml")` and both `--mode=oracle` flags to `--mode=json`. The tool still requires the backup/stop confirmations before clearing JSON actions.

**DO NOT** run `docker compose down -v`, `docker volume prune`, `DELETE FROM NMC_CASE`, `TRUNCATE NMC_AI_*` or general wildcard table delete scripts.

### 5 technical POC mandatory checklist templates

| Template | Applicability |
|---|---|
| POC Mandatory | Core Vessel Identification and Safety | All inspection regimes |
| POC Mandatory | PSC Port State Control Screening | PSC |
| POC Mandatory | UAE Maritime Service Inspection | UAE service |
| POC Mandatory | NMC Focused Incident Inspection | NMC focused referral |
| POC Mandatory | Follow-up and Corrective Actions | Follow-up |

These are sample, evidence-grounded technical baselines, **not legally approved IMO/MOEI checklists**. Every question is mandatory with a required Yes/No/N/A response and optional Observation field. **Draft seeding is default**. Publication is separate and requires an explicit review attestation; the technical records still retain `regulatoryApprovalVerified=false`. Confirm ministry-specific item wording, inspection regime mapping and legal authority before live use.

## Troubleshooting

- `SI_RESET_EXPLICIT_ACK_BACKUP_AND_STOPPED_SERVICE_REQUIRED`: intentional; review backups and acknowledge.
- `SI_RESET_EXTERNAL_FOREIGN_KEY_DEPENDENTS_...`: unexpected dependent Oracle table; stop and ask DBA.
- `SI_CHECKLIST_ORACLE_MIGRATION_017_REQUIRED`: run schema readiness checks; do NOT blindly rerun migration 017.
- `SI_CHECKLIST_LEGACY_LIBRARY_IMPORT_REQUIRED`: Oracle and /data checklist templates disagree; use existing explicit migration tool after review, not reset.
- `SI_CHECKLIST_SEED_EXISTING_CONTENT_CONFLICT`: conflict with a similarly titled user template; no overwrite.
- `NMC_DB_MODE=oracle` requires the previously configured Oracle network and credentials; never print credentials in the terminal transcript.

**Acceptance check:** 5 draft mandatory templates (or 5 published if approved), empty action counts, unchanged source-event counts, unchanged NMC risk/case counts, preserved 99 identity cohort and source policy revisions.
