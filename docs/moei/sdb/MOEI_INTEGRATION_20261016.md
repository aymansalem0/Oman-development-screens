# MOEI Unified Platform — Seafarer Management integration (2026-10-16)

## Branch relationship

**Integration checkout:** `integration/moei-seafarers-sdb-smart-inspection-20261016`

- Base: `fix/si-integrated-draft-actions-restore-20261016` (Smart Inspection, work orders and integrated Draft fix; Draft PR #150).
- Seafarer source: `feature/moei-seafarers-pre-application-readiness-20261015` (Seafarer SDB; PR #147).
- The source branch cannot be automatically merged into this base due to historical Git merge conflicts. The 27 Seafarer file changes were **ported onto the base**, preserving existing NMC/Smart Inspection backend changes. No automatic Git merge of the source branch is claimed.
- SDB stores data in its own single-instance sandbox JSON file, **`/data/sdb-readiness-sandbox.json`**. Existing Oracle schemas, inspector work orders, fleet and NMC records are not migrated or reset.

## Screens integrated in the maritime navigation

The left sidebar has one collapsible **Seafarer Management / إدارة البحارة** group with five entries:

| Screen | Browser route |
| --- | --- |
| Pre Application Readiness | `http://localhost:4200/#/moei/seafarers/readiness` |
| Seafarer Services & SDB issue/renewal | `http://localhost:4200/#/moei/seafarers/services` |
| Company No Objection / HOLD | `http://localhost:4200/#/moei/seafarers/company` |
| Notifications | `http://localhost:4200/#/moei/seafarers/notifications` |
| Printing & Delivery | `http://localhost:4200/#/moei/seafarers/fulfilment` |

Existing NMC, Smart Inspection and Settings navigation is preserved. Google SSO reuses the MOEI session; seafarer deep links have a fixed return-path allowlist. For source/business scope and mock-flow limitations see `docs/moei/sdb/PRE_APPLICATION_READINESS.md`.

## Integration wiring

- Angular routes and standalone Seafarer component include the shared MOEI maritime header/sidebar, language selection and RTL.
- The existing AI Proxy registers `/api/seafarers/v1` through its own authenticated request handler. It is isolated from all `/api/si/` and `/api/ai/` routes.
- Nginx forwards `/api/seafarers/` to `ai-proxy` using the same origin.
- Docker `ai-proxy` image includes the Seafarer backend and tests and runs its self-contained contract tests during image build.
- Compose publishes `SDB_ENABLED`, `SDB_STORE_PATH`, `SDB_SSO_BINDINGS_JSON`, and three independent incoming webhook secrets. Webhook requests are disabled until each secret is configured.
- The SDB module **does not** call live academy, MARASI, MOI/ICP, official payment/printing or official SDB issuance. Its source adapters, fees, eSDB, notices and customer/company events are simulations and specimen records; they must never be presented as government transactions.

## Local deployment — retain volumes

From PowerShell in `C:\Users\Admin\Oman-development-screens`:

```powershell
git fetch origin
git switch integration/moei-seafarers-sdb-smart-inspection-20261016
git pull --ff-only

# Keep the same overlays already used for the existing POC:
$dc = @(
  "-f", "compose.yaml",
  "-f", "compose.oracle.yaml",
  "-f", "compose.google-psc.yaml",
  "-f", "compose.incident-google.yaml"
)

docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
# Recreate only after any active in-memory C01/Airia job has finished.
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
```

Then open the existing `localhost:4200` origin, sign in as usual, click **Seafarer Management** in the sidebar, and visit **Pre Application Readiness**. No `docker compose down -v`, Oracle migration or Smart Inspection reset is required.

### Smoke tests

```powershell
docker compose @dc exec ai-proxy node --test test/seafarer-workspace.test.mjs test/seafarer-http.test.mjs
docker compose @dc logs --tail=100 ai-proxy
```

Verify:
- The MOEI maritime shell and sidebar display all five Seafarer entries in English and Arabic.
- `/api/seafarers/v1/dashboard` returns `401` without an authenticated session; valid users can see only their authorised domain scope.
- Admin sandbox previews show illustrative data only, with the `CONTRACT_SANDBOX` flag.
- NMC and Smart Inspection pages and the six existing issued inspector orders remain unchanged.
- Without configured SDB identity bindings, a normal VIEWER cannot access another seafarer's profile or a company's work.
- The SDB API remains isolated: `SDB_ENABLED=false` disables only this module.

### QA requirements before merge/deployment

Run Angular build, Docker image build, Seafarer HTTP/workspace tests, navigation regression, NMC / Smart Inspection regression, and a browser journey. The existence of committed test scripts and GitHub workflows is **not proof** that CI passed. Review actual run results first. Do not restart an unfinished paid C01 job; do not call live providers from a demo run.
