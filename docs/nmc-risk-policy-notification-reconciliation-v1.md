# NMC Alerts & Notifications — Published Risk Rule Reconciliation V1

**Branch:** `feature/nmc-risk-rules-alert-supersession-v1` (stacked on Full Inspection Lifecycle PR #61).

## Business behavior

- A change to a **published central NMC Risk Policy** re-evaluates existing saved A01/A02 five-factor assessments. Draft or browser-local what-if changes do **not** issue or dismiss authoritative alerts.
- For the same vessel, if the published policy changes the assessed risk **level** or the independent critical-open-finding trigger:
  - **High → Critical** (or Critical → High): existing notification changes to **SUPERSEDED** (dimmed); a new **OPEN** notification is created from the newly published risk classification.
  - **High/Critical → Normal/Watch** with **no independent critical open finding**: the old notification becomes **SUPERSEDED**; no new risk notification is created.
  - **High/Critical → High/Critical of the same level**, with no trigger change: retain the active alert and case. A score change alone does not spam repeated notifications.
  - Critical open findings keep a critical notification even when numeric risk is lower. If numeric risk *level* changes, the prior notification is superseded, a new one issued and remains critical because of the independent critical finding.
- Prior notification stays in the default inbox **dimmed**, with **× Remove**. Pressing × (Editor/Operator key required) sets `dismissedAt`, excluding the row from ALL/default views; the Oracle record and the immutable audit remain. **Never physically DELETE** alert, historical risk, linked maritime case, case tasks, or previous decisions.
- A manually **RESOLVED** alert remains historically resolved. Publishing unchanged risk level does not reopen it. A newly changed relevant risk classification may warrant a new active alert for the same IMO.
- Backend active/unread counts **exclude SUPERSEDED**; the dismissed/old alerts do not trigger escalations. Pending/unverified source evidence must not silently supersede active alerts.
- Changes to the published policy are **not** a legal/operational closure of an existing NMC case. Case review is separate.

## Technical implementation

- `ai-proxy/alert-workspace.mjs`: idempotent business-level signature comparison, persisted `SUPERSEDED`, audit action `SUPERSEDE`, distinct risk-policy/source-scoped `alertKey` for each new high/critical notification, persisted `DISMISS` action. No agent calls or risk rewrites.
- `ai-proxy/server.mjs`: published-policy scanner immediately after publish and periodically; editor-only `POST /api/ai/alerts/{uuid}/dismiss`. Incomplete projection does not replace verified saved risk. GET is read-only.
- `src/app/services/nmc-alerts.service.ts`: central-published alert counts, typed `SUPERSEDED`/ `DISMISS`.
- `nmc-alert-center.component.*`: dimmed outdated alert, X remove, bilingual label, original at-creation risk, optional current risk preview and full activity history.
- `ai-proxy/migrations/014_nmc_alert_supersession.sql`: extend existing Oracle CHECK constraints for `SUPERSEDED`, `SUPERSEDE`, `DISMISS`. JSON document already supports `supersededAt`, `supersededByRiskLevel`, `dismissedAt`. Existing tables and past rows retained.

## Local deployment (Windows PowerShell + Oracle 23 POC)

**Do not deploy to production without backup / DBA review / business approval.**
Existing DB migrations **001–013** (where applicable, especially 003 and 007/008) remain prerequisites. New migration **014** must be applied ONCE before starting the new backend in Oracle mode.

1. Confirm a restorable backup and the existing PDB/schema (`NMC_AI`, `FREEPDB1`). Preserve local uncommitted work and `.env`.
2. Verify old `CK_NMC_ALERT_STATUS` and `CK_NMC_ALERT_AUDIT_ACTION` constraints exist; verify 014 not already applied (the definitions do not already allow `SUPERSEDED`/`DISMISS`). If partially applied or customized, **stop** and contact the DBA rather than rerunning.
3. Check out branch and copy the migration:

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch feature/nmc-risk-rules-alert-supersession-v1
git pull --ff-only origin feature/nmc-risk-rules-alert-supersession-v1
docker cp .\ai-proxy\migrations\014_nmc_alert_supersession.sql oracle-free-23:/tmp/014_nmc_alert_supersession.sql
docker exec -it oracle-free-23 bash
```

4. From **inside Oracle container**, run `sqlplus -L /nolog`, connect using the existing secure `NMC_AI@//localhost:1521/freepdb1` credentials (prompt, never paste secrets), verify `SHOW USER`, `SYS_CONTEXT('USERENV','CON_NAME')`. Then, after backup + checks, execute:

```sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('NMC_ALERT','NMC_ALERT_AUDIT');
SELECT CONSTRAINT_NAME,SEARCH_CONDITION_VC FROM USER_CONSTRAINTS
 WHERE CONSTRAINT_NAME IN ('CK_NMC_ALERT_STATUS','CK_NMC_ALERT_AUDIT_ACTION');
@/tmp/014_nmc_alert_supersession.sql
```

5. Preserve Oracle and volumes. Rebuild the proxy + frontend with the existing Compose overrides:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=120 ai-proxy nmc
```

If your existing deployment uses Google PSC credentials, insert `-f compose.google-psc.yaml` **between** base and Oracle. Never use `docker compose down -v` or `--volumes`.

## UAT

1. Use a synthetic **saved** vessel with High risk, verify one active alert.
2. Publish a centrally approved risk policy that reclassifies that exact vessel to Critical. Verify old High is dimmed and new Critical is OPEN for same IMO; new unread count=1.
3. Click × on the dimmed alert. Confirm it disappears from inbox in **all browsers after refresh**; history remains in Oracle and linked case is unchanged.
4. Publish a policy that makes the vessel Watch/Normal with no critical finding. Confirm old Critical dims and **no new** High/Critical alert appears.
5. Publish weight/threshold change that alters the score only, not the risk level. Confirm no duplicate notification.
6. Verify current critical finding still generates Critical notification even if numeric risk is Watch, and GET/page reload never invokes Airia.
7. With unresolved NMC maritime case, supersede alert and confirm case remains open, linked to its immutable original alert.
8. Check old RESOLVED, SUPERSEDED and DISMISSED histories and 409 stale-update behavior.
9. Verify Arabic/English, RTL/LTR, responsive × visibility and notification badge.
10. Run `npm --prefix ai-proxy test` and `npm run build`, plus targeted Docker smoke tests.

**Scope:** Controlled POC behavior only, with synthetic-source provenance and shared Editor/Publisher keys; production SSO, regulated notification delivery and legal case closure remain outside this change.
