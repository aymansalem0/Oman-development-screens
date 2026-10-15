# NMC Dashboard Workspace — staged POC rollout

This increment is an **additive** improvement to the tested NMC Dashboard Builder.
Do not reset, recalculate or delete the stored fleet A01/A02 assessments, Risk
rulesets or Data Quality records. DQ-01 is outside this increment.

## 1. Deploy / migration prerequisites

- Take a snapshot / backup of the existing NMC_AI schema before making database changes.
- The existing NMC Oracle POC instance remains running.
- Review `ai-proxy/migrations/002_nmc_dashboard_workspace.sql`. Execute it **once**
  with the existing NMC_AI schema owner using your approved database client.
- Verify both new tables (`NMC_DASHBOARD`, `NMC_DASHBOARD_REVISION`) exist.
- Do **not** rerun the V1 schema or prior Airia assessments.
- The backend is intentionally read-only when keys are absent. A missing V2
  schema only affects the workspace endpoints, not the other fleet endpoints.

## 2. Configure local-only dashboard access

Add the following **to your existing local** `.env` (do not replace or commit it):

```
NMC_DASHBOARD_EDITOR_KEY=<generate-first-independent-32-byte-random-value>
NMC_DASHBOARD_PUBLISHER_KEY=<generate-second-independent-32-byte-random-value>
NMC_FLEET_AUTO_ENABLED=false
```

Both keys must be 24+ characters and **different**. Generate on PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Run this code **twice**. Do not paste secret values in issues, screenshots or chat.

Editor role can create, save and archive central drafts. Publisher role can
publish a draft; publishing increments the version and archives neither data
nor its revision history. Published documents are read-only. To edit one,
select **Use as Template** and save a new central draft.

This is a local shared-key staging control, **not end-user IAM**. Integration
with the approved identity provider, authenticated per-user permissions and
named user audit is a separate acceptance condition.

## 3. Build and start without deleting persistent volumes

```powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-dashboard-central-management-v2

$env:NMC_FLEET_AUTO_ENABLED = 'false'
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --no-deps --force-recreate ai-proxy nmc
```

If the branch already exists, `git switch feature/nmc-dashboard-central-management-v2`
then `git pull --ff-only`. Do not `docker compose down -v`.

## 4. Validate

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml exec -T ai-proxy printenv NMC_DB_MODE
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml exec -T ai-proxy printenv NMC_FLEET_AUTO_ENABLED
Invoke-RestMethod http://localhost:4200/api/ai/dashboards
Invoke-RestMethod http://localhost:4200/api/ai/fleet/analytics
```

Expected: dashboard list returns `{status:'ok', dashboards:[]}` on a fresh
central workspace; fleet data remains unchanged. `NMC_DB_MODE` must be
`oracle` for the Oracle persistence test; `NMC_FLEET_AUTO_ENABLED`
must be `false`. No new AI requests are needed.

For local tests, execute from the repo root:
```powershell
npm --prefix ai-proxy install
npm --prefix ai-proxy test
npm run build
```

**Business smoke test:** NMC Center → Dashboards → Create or open local board →
Save Changes → Save to Workspace (editor key) → Shared Dashboards →
View History → Publish (publisher key) → Open new browser → Refresh Shared
Dashboards → See Published board → Use as Template to start a new revision
as an independent draft. Test conflict response if a second editor has changed
a shared draft meanwhile.

## Non-goals / known gaps

- Authenticated users, per-user named audit and SSO RBAC are not yet
  implemented; shared role access keys must not be mistaken for them.
- Local Save remains the existing browser draft storage to avoid disturbing
  user-tested workflows. **Save to Workspace** is the explicit central commit.
- Executive and Management templates use stored fleet/risk indicators. Trend,
  incident, SLA and proactive notification widgets are still future features,
  not fabricated values.
- Dashboards do not invoke Airia, start the fleet scheduler or modify stored
  historical vessel risk assessments.
