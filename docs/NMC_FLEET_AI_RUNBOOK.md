# NMC Autonomous Fleet AI — Deployment & Rollback

## Design
The NMC Command Center is a read-only viewer of 420 persisted, provisional AI risk assessments. It does not start batches or ask for an admin token. The Node backend performs initial fleet bootstrap automatically when enabled and then checks each vessel for changed evidence every hour. A01 supplies movement/history, A02 inspection/certificate/data quality. The deterministic versioned risk engine computes the final score. Critical open findings raise **Priority Review** independently of the numeric score.

**All records are synthetic POC data**: the Google Sheet is a live transport for fictional PSC evidence, not a verified Riyadh MoU/authority source. No regulatory action is automatic.

## Safeguards
Source/input hashes avoid paid Airia calls when the vessel data have not changed. Each refresh is per vessel, preserves last completed score on failure, displays Pending AI for vessels not yet assessed, and records refresh errors. No browser POST endpoint exists for starting or cancelling batches. Current cost ceiling for a first full pass is 420 × 2 = **840 Airia calls**. Hourly changes could generate additional calls. Only one vessel (two agent pipelines in parallel) runs at a time; bootstrapping 420 may take many hours. An hourly trigger means evidence is *checked* hourly (subject to queue load), not that every vessel is guaranteed freshly AI-scored every hour.

## Backup and current branches
- Original backup: `backup/nmc-poc-pre-fleet-ai-20261009` at commit `546a9083`.
- Original manual batch branch retained: `feature/nmc-fleet-ai-risk` at commit `74b27538`.
- New automatic backend branch: `feature/nmc-fleet-auto-scheduler` (draft PR #32).
- Existing Google Sheet backup: `BACKUP_2026-10-09_NMC_External_PSC_Simulation_420_Vessels_before_Fleet_AI`.

## Deployment
Preserve any uncommitted edits, local `.env` and `secrets` files. Never copy secrets into the repo or chat. Wait for an existing manual batch to complete before switching branches.

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch --track origin/feature/nmc-fleet-auto-scheduler
```

If already checked out locally: `git switch feature/nmc-fleet-auto-scheduler` and `git pull --ff-only`.

Automatic background runs are intentionally enabled once in the LOCAL `.env`, not by dashboard login or click. This safeguards against starting 840 paid calls merely by pushing code to GitHub. Set:

```dotenv
NMC_FLEET_AUTO_ENABLED=true
NMC_FLEET_REFRESH_SECONDS=3600
```

Existing `AIRIA_MENA_KEY`, `PSC_GOOGLE_CREDENTIALS_PATH` and `secrets/nmc-psc-google.json` stay in place. `NMC_FLEET_ADMIN_TOKEN` is no longer read or needed by this version (may be deleted locally). Do not share it.

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml up -d --build --force-recreate
docker compose -f compose.yaml -f compose.google-psc.yaml ps
Invoke-RestMethod http://localhost:4200/api/ai/health
$r = Invoke-RestMethod http://localhost:4200/api/ai/fleet/status
$r.scheduler
$r.counts
$r.job
```

Open http://localhost:4200/#/moei/nmc at any time. The backend starts and continues autonomously even with the browser closed. The UI polls saved results every seven seconds. The first bootstrapping is not instant; never show not-yet-assessed vessels as Normal.

## Rollback
Switch to `feature/nmc-fleet-ai-risk` for the previous manual-batch Command Center, or to `feature/smart-inspection-poc` for the pre-fleet POC. Rebuild Docker with the existing compose pair. Do not use `docker compose down --volumes` because it deletes stored results.

## POC limitations
Internally generated vessel fixture records and route/safety evidence are synthetic and partly influenced by old baseline values. Google PSC sheet is fictional. The server ruleset is the published fixed POC default, not automatically synced from browser-local risk configuration edits. No production database, leader election, dedicated scheduler infrastructure, cost meter or official vessel data is included. An hourly target may be delayed by a busy queue or Airia rate limits.