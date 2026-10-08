# Oracle NMC_AI V1 — rollout (existing oracle-free-23)

Target: Docker container **oracle-free-23**, PDB **freepdb1**. Existing systems remain untouched.

## What is ready in this branch
- `database/oracle/00_create_nmc_user.sql`: create least-privileged `NMC_AI` schema (manual DBA action, one time).
- `database/oracle/01_nmc_intelligence_v1.sql`: 13 additive tables for AI assessment history, risk factors, evidence, findings, quality, conflicts, timeline, jobs and latest vessel state.
- `database/oracle/02_verify_nmc_v1.sql`: read-only post-migration checks.
- `ai-proxy/oracle-store.mjs`: Oracle Thin Driver transaction adapter. A completed A01/A02 assessment publishes only after its factors and evidence commit successfully.
- `compose.oracle.yaml`: attaches existing NMC AI proxy to a shared Oracle Docker network without recreating Oracle.

## Safety first
1. Back up existing Oracle database (independently of a Git backup); confirm backup recovery plan and no active batches.
2. Review `git status --short` before switching Git branches; preserve local edits.
3. Confirm `FREEPDB1` is READ WRITE: `docker exec oracle-free-23 bash -lc "echo 'show pdbs;' | sqlplus -s '/ as sysdba'"`.
4. If the `NMC_AI` user or V1 tables already exist, stop; do not rerun creation scripts.
5. No application code in this branch automatically executes DDL or creates Oracle accounts.

## Provision the database (only after backup)
From PowerShell in the checked-out feature branch:

```powershell
docker cp database/oracle/00_create_nmc_user.sql oracle-free-23:/tmp/00_create_nmc_user.sql
docker cp database/oracle/01_nmc_intelligence_v1.sql oracle-free-23:/tmp/01_nmc_intelligence_v1.sql
docker cp database/oracle/02_verify_nmc_v1.sql oracle-free-23:/tmp/02_verify_nmc_v1.sql
docker exec -it oracle-free-23 bash
```

Inside the Oracle container:
- `sqlplus -L '/ as sysdba' @/tmp/00_create_nmc_user.sql` — prompts for NEW NMC_AI password. Do not share it.
- `sqlplus -L /nolog`, then `CONNECT NMC_AI@//localhost:1521/freepdb1`, enter NMC_AI password, and run `@/tmp/01_nmc_intelligence_v1.sql` **once**, followed by `@/tmp/02_verify_nmc_v1.sql`.

## Docker networking
The existing Oracle is on the default bridge, and NMC uses `moei-nmc-poc_nmc`. Create one shared network if needed:

```powershell
docker network create nmc-oracle-link
docker network connect nmc-oracle-link oracle-free-23
```

Network and attachment need be created only once; if already present, don't repeat. The optional compose file adds the AI proxy to this network on recreation.

## Configure backend; first test WITHOUT auto AI calls
Local `.env` only:

```dotenv
NMC_DB_MODE=oracle
NMC_DB_USER=NMC_AI
NMC_DB_PASSWORD=<new-user-secret>
NMC_DB_CONNECT_STRING=oracle-free-23:1521/freepdb1
NMC_FLEET_REFRESH_SECONDS=3600
NMC_FLEET_AUTO_ENABLED=false
```

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --build --force-recreate
Invoke-RestMethod http://localhost:4200/api/ai/health
Invoke-RestMethod http://localhost:4200/api/ai/fleet/status | Select-Object storageMode,counts
```

Confirm `persistence.mode=oracle` and `ready=true`, then choose whether to enable `NMC_FLEET_AUTO_ENABLED=true`. Initial 420 vessels can cost up to 840 Airia executions; opening the dashboard never triggers calls. If old JSON scores exist they are preserved separately but not silently imported into Oracle. **Do not use `docker compose down --volumes` on a user's computer.**

## Known V1 boundaries
Data Confidence and cross-source conflict detection still require analysis logic: V1 schema can store their results but deliberately sets quality to `NOT_CALCULATED` and does not invent conflicts. All current fleet records and PSC examples are synthetic, not official. No standalone production high availability, full transactional inbox/outbox, cost controls or RBAC yet. Azure SQL remains the target production database for MOEI; this Oracle adapter is scoped to the local POC.


## Safe first live Airia test (after Oracle health + 420 vessel seed)

For a **single-vessel automatic smoke test** only, configure local `.env`:

```dotenv
NMC_FLEET_AUTO_ENABLED=true
NMC_FLEET_AUTO_MAX_VESSELS=1
NMC_FLEET_AUTO_RETRY_FAILED=false
NMC_FLEET_REFRESH_SECONDS=3600
```

Use the three compose files to rebuild AI proxy:

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --build --force-recreate
$r=Invoke-RestMethod http://localhost:4200/api/ai/fleet/status
$r.scheduler
$r.counts
```

Only the first synthetic vessel in the catalog is eligible while MAX_VESSELS=1. A01/A02 make **up to two paid calls** for that vessel, if its PSC evidence passes provenance validation. If validation fails or the result is invalid, the failed vessel is not automatically retried. Examine status/results and `SELECT COUNT(*) FROM NMC_AI_ASSESSMENT` in Toad. This safeguard does **not** throttle additional source changes on the same vessel forever; keep the smoke test short.

To stop all automatic calls, set `NMC_FLEET_AUTO_ENABLED=false` and recreate the proxy (do not remove volumes). To expand after successful verification set `NMC_FLEET_AUTO_MAX_VESSELS=420` and confirm the expected potential cost. The UI has no token or action button.
