# NMC Event & Notifications — Phase 1 (saved-risk alerts)

## Scope and what is intentionally NOT done
This is the first increment of the MOEI NMC Business POC's proactive alert workflow,
not a replacement for the tested Risk Engine or Dashboard Builder.

- **Automatic detector:** server reads the last completed saved A01/A02 risk
  assessments every 30 seconds. It never calls Airia, retries AI, or updates any
  official stored risk or vessel assessments. Failed or pending assessments do
  not produce alerts. Initial scan runs on proxy startup.
- **Source:** saved risk level HIGH/CRITICAL, or critical open inspection finding.
  These are synthetic, non-authoritative POC risk records.
- **Alert lifecycle:** OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED; users can
  also ESCALATE active alerts to NMC_SUPERVISOR. Versioned Oracle audit records
  capture action, role, timestamp and note. Resolution requires a note and a
  publisher/supervisor key.
- **Proactive escalation:** still-OPEN critical alerts escalate to the
  supervisor role after a **configurable demo window** (default 15 minutes).
  This is NOT an MOEI contractual SLA or delivery to a named user.
- **In-app notification UI:** the Command Center bell and NMC sidebar have
  live unacknowledged counts, and a central Alerts & Notifications inbox has
  filters, follow-up, vessel/case links and history.
- **Deduplication:** one alert for each IMO and HIGH/CRITICAL band, so repeated
  polling will not generate duplicates. A high→critical change creates a new
  critical alert while preserving the old alert's history. Already resolved
  alerts are not automatically reopened for the same band.
- **Access:** reads remain public to this POC app (as in the dashboard workspace).
  Mutations reuse the existing server-managed POC keys:
  NMC_DASHBOARD_EDITOR_KEY is operator, NMC_DASHBOARD_PUBLISHER_KEY is supervisor.
  They are **shared credentials, not real per-user identity, audit actor identity
  or a production-ready access model**. Credentials stay in memory per tab.
- **Follow-up:** a durable *alert status* is saved centrally; opening Case
  Workspace is navigation to the existing case view. **Case state itself is
  still sessionStorage and is not represented as a centrally created case.**
  No external email/SMS/push notifications or Keycloak login in this increment.
- **Change Challenge:** detection currently evaluates the saved A01/A02 risk
  level, not browser-local unpublished Risk Configuration; full ruleset-to-alert
  propagation, recommendation rerouting and multi-user approvals are next-phase
  tasks. This limit should be stated in the business demonstration.

## Oracle migration — run BEFORE deploying the new proxy

Back up the existing NMC_AI schema and review DBA rollback procedures.
The additive manual schema change is:
`ai-proxy/migrations/003_nmc_operational_alerts.sql`.

First in SQL*Plus logged in as the **same schema owner NMC_AI** in FREEPDB1:

```sql
SHOW USER;
SELECT SYS_CONTEXT('USERENV','CON_NAME') AS PDB FROM DUAL;
SELECT TABLE_NAME FROM USER_TABLES
 WHERE TABLE_NAME IN ('NMC_ALERT','NMC_ALERT_AUDIT');
```

Only if **neither** table exists:

```powershell
docker cp .\ai-proxy\migrations\003_nmc_operational_alerts.sql oracle-free-23:/tmp/003_nmc_operational_alerts.sql
```

With SQL*Plus running **inside the Oracle container** (adapt client path as
appropriate), execute:

```sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
-- Enter password when prompted; special characters such as @ can be typed here.
@/tmp/003_nmc_operational_alerts.sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'NMC_ALERT%';
```

Expected **NMC_ALERT**, **NMC_ALERT_AUDIT**.
If one table exists or SQL partially succeeds, STOP and investigate before
rerunning, because Oracle DDL may already have committed.
Migration 003 does not touch previous AI, NMC Dashboard or vessel objects.

## PowerShell checkout & scoped rebuild

```powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-event-notifications-v1
# Or, for an existing local tracking branch:
# git switch feature/nmc-event-notifications-v1
# git pull --ff-only origin feature/nmc-event-notifications-v1
```

Keep existing `.env` unchanged except for optionally adding:

```dotenv
NMC_FLEET_AUTO_ENABLED=false
NMC_ALERT_SCAN_ENABLED=true
NMC_ALERT_SCAN_SECONDS=30
NMC_ALERT_ESCALATE_MINUTES=15
```

The alert scanner is **not** the Airia fleet scheduler. Running it is
independent of `NMC_FLEET_AUTO_ENABLED=false` and incurs no AI calls.

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --no-deps --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml logs --tail 50 ai-proxy nmc
Invoke-RestMethod http://localhost:4200/api/ai/alerts
```

Never use `docker compose down -v`; do not recreate your Oracle container
or reset AI/Dashboard data. All alert data lives in new Oracle tables in
Oracle mode, or the existing persistent `/data` volume in JSON mode.

## Acceptance test (no Airia calls)

1. Confirm `GET /api/ai/fleet/status` shows a saved completed risk assessment
   with High/Critical risk. There is no reason to assess 420 vessels.
2. Wait up to 30 seconds: **NMC Center → Alerts & Notifications** shows an
   auto-generated risk alert referencing IMO and saved assessment.
3. Open Command Center: the bell reflects real unacknowledged count, not "3".
4. **Acknowledge** the alert (editor/operator secret), then **Start follow-up**.
   Check the version increments and new audit entries.
5. Open Vessel 360 or the existing Case Workspace from the alert; this alone
   does NOT create a new centrally persisted case.
6. **Escalate** (operator key), then **Resolve** (publisher/supervisor key and
   mandatory reason). Check the action audit and new alert count.
7. Refresh/reopen in another browser; alert status persists centrally, and
   repeated detector passes do not create duplicate alerts.
8. For a new critical OPEN alert, test the configurable monitor threshold if
   needed (use a test environment and shorter threshold; don't rewrite data).
9. Check dashboard builder, published nav, risk settings and existing saved
   assessments are unaffected. Run:
   `npm --prefix ai-proxy run check`,
   `npm --prefix ai-proxy test`, and
   `npm run build` before merging.

## Next independent increments
P2: centrally persisted Case Workspace, human identity/decision tracking.
P3: event types for movement anomalies, certificate/PSC conflicts and document
quality, routed recommendations and agent explanations.
P4: operational/management dashboards source events and case history.
P5: publish Business Rule changes centrally and propagate versioned changes to
risk classifications, alerts, recommendations, escalation and follow-up.
