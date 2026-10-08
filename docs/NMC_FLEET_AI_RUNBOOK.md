# NMC Fleet AI Risk POC — protected migration runbook

**Source snapshot (unaltered):** `backup/nmc-poc-pre-fleet-ai-20261009`, commit `546a9083ecc93d43cdafb9e03c63619644961b4b`.
**Existing POC feature branch (unaltered):** `feature/smart-inspection-poc`.
**New work branch:** `feature/nmc-fleet-ai-risk`. Draft PR #31. **Do not merge yet.**

## Actual behavior

- All 420 vessel records remain synthetic demonstrations; External PSC is simulated structured data (Google Sheets LIVE transport or offline snapshot mode), never official Riyadh MoU data.
- A01 provides movement/history signals and A02 provides inspection/certificate/data-quality signals.
- Node validates factor identity, severity, confidence, evidence identifiers, and PSC references for inspection/history when external PSC history exists.
- The server computes the weighted score with the configured rules (no baseline score calibration) and separately flags open Critical deficiencies as **Priority Review**.
- The main Command Center reads persisted **completed** results; missing, failed, or different-ruleset results are **Pending AI**, never quietly displayed as Normal.
- No batch starts on page load, server restart, or schedule. An officer explicitly starts a 10-vessel test, pending-only batch, or complete 420-vessel re-assessment and confirms the potential cost. The server does not automatically retry failures.
- Max concurrently executing Airia pipeline calls: two (A01 and A02 for one vessel). Full fleet costs up to **840 Airia executions** per selected full pass, depending on vendor pricing/rate limits.
- Persistent results live in the local Docker named volume `nmc-fleet-results`, **not** browser storage or Git. Assessments survive normal `docker compose down` but **not** `docker compose down --volumes` or volume deletion.
- Results from A01/A02 are POC decision support, not official scores; cases, regulatory restrictions and enforcement are never auto-created.

## Mandatory backup on the local Windows host

Before switching branches or running containers, review `git status --short` and do not discard uncommitted changes. From PowerShell in the repo:

```powershell
$backupDir = Join-Path $HOME ("NMC-Backup-" + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $backupDir
git bundle create (Join-Path $backupDir 'nmc-git.bundle') --all
if (Test-Path .env) { Copy-Item .env (Join-Path $backupDir '.env') }
if (Test-Path secrets) { Copy-Item secrets (Join-Path $backupDir 'secrets') -Recurse }
Write-Host "Local backup at $backupDir"
```

`.env` and `secrets/nmc-psc-google.json` contain access credentials. Protect this directory, do not upload it to Git, and never paste keys in chat. The Google Sheet has a separate Drive copy; verify its sharing is **Restricted**, because copies may inherit permissive access.

## Switching safely

```powershell
git fetch origin
git switch --track origin/feature/nmc-fleet-ai-risk
```

If the local branch already exists, use `git switch feature/nmc-fleet-ai-risk`. Preserve existing work before attempting the switch.

Create a long unique token in PowerShell without printing it or committing it:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [BitConverter]::ToString($bytes).Replace('-', '')
Add-Content -Path .env -Value ("NMC_FLEET_ADMIN_TOKEN=" + $secret)
```

**If an `NMC_FLEET_ADMIN_TOKEN` line already exists, edit it rather than appending a duplicate.**

Rebuild with the existing Google PSC secret bind mount:

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml up -d --build
Invoke-RestMethod http://localhost:4200/api/ai/psc/health
Invoke-RestMethod http://localhost:4200/api/ai/fleet/status |
  Select-Object status, fleetSize, counts, job
```

Open `http://localhost:4200/#/moei/nmc`. Paste the token from your local `.env` into the password field (not into chat). Click **Test 10 vessels**. Wait for all 10 to finish and review failures and evidence. Next choose **Assess pending**: this will include only vessels without a completed assessment for the current ruleset (typically 410 after the first 10). **Reassess all 420** intentionally repeats every vessel and can use all 840 calls. The UI must never report 420 AI-assessed before all individual results complete.

Follow batch progress:

```powershell
Invoke-RestMethod http://localhost:4200/api/ai/fleet/status |
  Select-Object counts, job
docker compose -f compose.yaml -f compose.google-psc.yaml logs --tail=30 ai-proxy
```

A job cannot be cancelled once its current in-flight A01/A02 calls have started; **Cancel** only prevents starting additional queued vessels.

## Restore original POC

Do not use destructive Git resets. To return to the pre-migration application version:

```powershell
git switch feature/smart-inspection-poc
docker compose -f compose.yaml -f compose.google-psc.yaml up -d --build
```

The untouched, timestamped backup branch is an independent second restore point. Never use `down --volumes` while results are needed.

## Known POC limitations / next work

- Internal Vessel 360 fixtures for certificates/deficiencies are partially driven by the *old* synthetic baseline score. The new Risk Engine does **not** calibrate against that score, but the test evidence is not statistically independent of it. Do not interpret the AI ranking as validated performance.
- An input Google Sheet change does not yet automatically invalidate the stored risk; re-run after source changes. Ruleset-version mismatch *does* visibly mark Command Center assessments pending.
- There is no scheduler, automatic incremental deduplication, official AIS/PSC PDF extraction, real maritime registry attestation, authorization or production-grade database in this local POC. The Google service account is strictly read-only.
- Implement production features later with durable database, tenant-aware RBAC and audit logs, job retries and idempotency, separate priority rules, explicit source-versions/hashes, and rate/cost metering.
