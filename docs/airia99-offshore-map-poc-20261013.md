# MOEI NMC POC — 99 Airia partner demo vessels and offshore-only illustrated tracks

## Scope
- Exactly 99 IMO/name pairs from Airia Partner Guide §8, preserved in `ai-proxy/airia-demo-99.json`. Every identity is checked against existing synthetic fleet catalogue. The previous 420-fixture files remain unchanged and historical Oracle/JSON assessments are not deleted.
- `src/app/data/airia-demo-cohort.ts`: same 99 frontend profiles and Vessel 360 navigation.
- `ai-proxy/airia-demo-cohort.mjs`: same backend allowlist. Fleet risk snapshot, analytics, scheduler and SI candidate source bundles are restricted to these 99 IMOs. Previously saved out-of-cohort risk records remain in DB, invisible in current demo. NMC case/alert/referral lists are scoped to the same 99.
- `src/app/data/airia-offshore-corridors.json` + `airia-maritime-motion.ts`: eight manually staged offshore polylines in Arabian Gulf/Gulf of Oman; smooth deterministic segment interpolation, no random lateral jitter, no port/land approach points. 99 simulated markers move back and forth along these paths.
- Track/zone labels are illustrative. **NOT live AIS, registered port approaches, certified hydrographic corridors or validated navigational routes.** The eight corridors were validated via segment-boundary regression; mandatory coastline/landmask visual check remains necessary before a literal all-sea guarantee is made.

## PowerShell — update, build and run
> Stack this branch over PR #104 changes. Existing Oracle, PSC and Google overlays should match your current local setup; the example assumes all are enabled. This does not run any data reset or migration.

```powershell
cd C:\Users\Admin\Oman-development-screens
if (git status --porcelain) { throw "Review local changes before switching branches" }
$branch="feature/airia99-sea-corridors-map-20261013"
git fetch origin
if (git branch --list $branch) {
  git switch $branch
  git pull --ff-only origin $branch
} else {
  git switch --track "origin/$branch"
}
$dc = @("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_DB_MODE="oracle"
# To avoid unwanted paid A01/A02 calls after switching the population:
$env:NMC_FLEET_AUTO_ENABLED="false"
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
$env:NMC_FLEET_AUTO_MAX_VESSELS="99"
docker compose @dc config --quiet
docker compose @dc up -d --build ai-proxy nmc
if ($LASTEXITCODE -ne 0) { throw "DOCKER_START_FAILED" }
docker compose @dc ps
docker compose @dc logs --tail=60 ai-proxy nmc
```

**NMC map:** http://localhost:4200/moei/nmc

### Backend scope tests (requires login cookie)
```powershell
# Visual check:
# - KPI Monitored contacts = 99
# - Map label '99 / 99 vessels shown' with All filters
# - Search Gulf Horizon and Sea Pearl -> only partner identities
# - Pause/resume and inspect selected route: no crossing land on OSM.
# - Open Vessel 360; IMO and name match corresponding demo entry.
# - NMC risk counts and SI candidate eligibility use the same 99 IMOs.
# - Historical off-cohort Oracle records are not erased.
```

### Safety / data provenance
`NMC_FLEET_AUTO_ENABLED=false` is recommended for first POC run (avoid unsolicited paid Airia calls). Set true later only after explicit approval. Existing event imports and mandatory inspection checklists stay intact. The 99 IDs/names came from partner guide; detailed registrations, certificates, PSC, movement and positions are **synthetic**, not partner-approved official data.

**No destructive commands:** Do NOT use `docker compose down -v`, `docker volume prune`, `TRUNCATE` or mass `DELETE` for this presentation change.

## Acceptance
CI Angular, backend and Docker smoke must all pass. Also inspect coastlines in the actual OSM UI at the demonstration zoom. Segment bound checks are necessary but not a replacement for authoritative landmask/navigation geometry.
