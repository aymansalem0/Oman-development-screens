# NMC Case Service Unavailable — Oracle incident-link diagnosis (2026-10-12)

## User-supplied observations
- Docker `ai-proxy` and `nmc` are running healthy.
- `GET /api/ai/cases` returns `status: ok` with existing cases.
- `ai-proxy` logs `[nmc-incidents] CASE_LINK_FAILED code=CASE_INCIDENT_SCHEMA_REQUIRES_NULL_ALERT` and `CASE_STORE_UNAVAILABLE`, with `casesFailed=3`.
- This confirms **existing-case read operations work**; it does not prove all case writes, audit constraints or particular by-IMO paths succeed.

## Diagnosed mismatch from the repository
1. `ai-proxy/migrations/004_nmc_central_cases.sql` defines `NMC_CASE.SOURCE_ALERT_ID NOT NULL`. Current `fromIncident()` must write NULL when no alert exists. The specialized `CASE_INCIDENT_SCHEMA_REQUIRES_NULL_ALERT` is emitted for Oracle ORA-01400. Repository contains a safe, separate patch: `tools/oracle/nmc-incident-case-source.sql`.
2. `ai-proxy/migrations/005_nmc_case_ai_actions_audit.sql` defines `CK_NMC_CASE_AUDIT_ACT_V2`. This constraint rejects `INCIDENT_CASE_CREATED`, `INCIDENT_LINKED`, human incident decisions and new single-decision/restriction audit actions. The latter also exceed `ACTION_NAME VARCHAR2(32 CHAR)` inherited from migration 004. Both lead to generic `CASE_STORE_UNAVAILABLE` when Oracle exceptions are wrapped. The actual condition must be confirmed by reading the live constraint metadata; DO NOT claim that live schema matches the GitHub files without checking.
3. This affects **automatic incident → NMC case linking**. Other screen-level case errors may have different causes, so test the failing endpoint separately after the repairs.

## Read-only Oracle metadata queries (run as NMC_AI, e.g. Toad)

```sql
SELECT table_name,column_name,nullable,char_length
FROM user_tab_columns
WHERE (table_name='NMC_CASE' AND column_name='SOURCE_ALERT_ID')
   OR (table_name='NMC_CASE_AUDIT' AND column_name='ACTION_NAME');

SELECT constraint_name,constraint_type,status,search_condition_vc
FROM user_constraints
WHERE table_name='NMC_CASE_AUDIT'
  AND constraint_name IN (
    'CK_NMC_CASE_AUDIT_ACTION',
    'CK_NMC_CASE_AUDIT_ACT_V2',
    'CK_NMC_CASE_AUDIT_ACT_V3'
  );

SELECT COUNT(*) AS existing_cases FROM NMC_CASE;
SELECT COUNT(*) AS existing_audit_rows FROM NMC_CASE_AUDIT;
```

Expected problem if original migrations unchanged: SOURCE_ALERT_ID=N (NOT NULL), ACTION_NAME=32, restrictive CHECK v1 or v2. There may be partial patches already; examine actual output before any DDL.

## Safe repair process (DBA-reviewed; no automated execution)
1. Confirm recoverable backup of existing Oracle POC and coordinate downtime/write access. Oracle DDL implicitly commits.
2. If `SOURCE_ALERT_ID` is `N`, execute the **existing** `tools/oracle/nmc-incident-case-source.sql` as NMC_AI in FREEPDB1. If already `Y`, skip.
3. If only V1 or V2 restrictive audit check exists and V3 is absent, review and run **`ai-proxy/migrations/017_nmc_case_audit_incident_actions.sql`**. It broadens the approved audit-action allowlist and `ACTION_NAME` column without rewriting case/audit history. Do NOT run migration 004 or 005 again.
4. Compare all row counts and constraint metadata before/after; verify FK `FK_NMC_CASE_ALERT` still applies to non-null alert-origin cases; verify valid historical audit entries remain queryable.
5. Retry incident linking (the existing five-minute auto-triage tick can do this), then inspect logs and linked Case IDs. Existing completed A01/A02 analyses should be re-used; do not force expensive AI reruns or remove stored records.
6. Check `GET /api/ai/cases` and `GET /api/ai/cases/by-imo/9400605` (or an actual failing IMO), then test the actual user action after case linking works.

## Safe PowerShell checks

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml ps

Invoke-RestMethod http://localhost:4200/api/ai/health | ConvertTo-Json -Depth 6

Invoke-RestMethod http://localhost:4200/api/ai/cases | Select-Object status

docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml logs --tail=150 ai-proxy
```

**Do not run `docker compose down --volumes`, recreate Oracle, truncate tables, clear assessment history, or run `004` / `005` blindly.** There is no evidence of data corruption; the observed problem is likely a forward migration mismatch. This patch is only a GitHub **draft** pending actual schema verification and DBA-reviewed execution.
