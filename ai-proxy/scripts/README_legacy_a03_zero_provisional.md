# MOEI NMC POC — Legacy A03 Zero Placeholder & Risk History

## Purpose
Historically completed **synthetic** A01/A02 assessments contain five risk signals. The currently published central risk policy can assign a positive weight to a sixth signal: **Document Integrity (A03)**. The absence of A03 is not equivalent to verified document compliance.

For an explicitly authorized, isolated **POC preview only**, these changes support **A03 = 0, STATUS = NOT ASSESSED**, yielding a six-factor **PROVISIONAL risk estimate**. A03=0 is a lower-bound calculation assumption, NOT a zero-risk finding. Do not base maritime enforcement, alerts, or operational decisions on these previews. Source assessments/history remain immutable.

## Safe dry-run-first SQL history backfill
SQL file: `legacy_a03_zero_provisional_projection_backfill.sql`

Prerequisites: Oracle user `NMC_AI` in `FREEPDB1`, tested backup; migration **007 + 008 + 016** installed; central policy ACTIVE with `documentIntegrity > 0`, valid 6-factor weight total 100%. **Never run on real, authoritative maritime data.** Review SQL before execution.

1. Use SQL*Plus/SQLcl connected to the **correct NMC_AI POC schema**.
2. Default script starts `DEFINE APPLY=NO`. Execute `@legacy_a03_zero_provisional_projection_backfill.sql`. Inspect `Eligible`, vessel IMOs and computed preview scores. This **does not insert anything**.
3. Confirm audited approval and backup. On a local controlled copy only, change `DEFINE APPLY=NO` to `DEFINE APPLY=YES` and rerun. The code inserts **new derived rows in NMC_RISK_POLICY_PROJECTION only** and commits once. Existing rows are skipped (idempotent).
4. Inspect final SELECT. Restore the script to `DEFINE APPLY=NO` in your working tree.

The script **never updates** `NMC_AI_ASSESSMENT`, `NMC_AI_RISK_FACTOR`, or historical projection rows. Its sixth factor carries `evidenceStatus=NOT_ASSESSED` and `sourceAgent=A03_NOT_ASSESSED_ZERO_PLACEHOLDER` in the JSON factor snapshot. No AI or Google requests are made.

## Live provisional POC preview across API/Command Center

Default `NMC_POC_LEGACY_A03_ZERO_PREVIEW=false` is fail-closed. The backfill SQL can run without enabling it, and historical projections display independently.

To opt in to the backend provisional **current policy preview** for synthetic legacy data, place in local `.env`:

```dotenv
NMC_POC_LEGACY_A03_ZERO_PREVIEW=true
```

Compose passes this variable to **ai-proxy**. Restart that service only **after disabling autonomous fleet runs** from Runtime Configuration (and verifying disabled via `/api/ai/admin/runtime-settings`), so AI charges cannot be triggered unintentionally. Recreate with the **same Google Drive and Oracle Compose overlays that you normally use**; never use `docker compose down -v`.

The `/api/ai/fleet/status` read-only response then provides `riskProvisional:true` and `a03EvidenceStatus:NOT_ASSESSED`; risk values are visibly labeled as provisional in Command Center. The default map filter is **AI Assessed Only**. The Risk Intelligence UI presents the original saved score **separately** from the six-factor preview, with A03=0 and explicit missing-evidence status.

The backend deliberately **excludes provisional projections from maritime operational alert generation** and labels them `operationalDecisionAllowed:false`. Any later real, validated A03 signal is evaluated using its actual severity, and the zero placeholder is no longer used.

### Verify safely (read only)
```powershell
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy/projections |
  Select-Object policyRef,assessed,provisionalAssessed
```

To inspect one vessel, use:
```powershell
Invoke-RestMethod http://localhost:4200/api/ai/risk-policy/vessels/9328471
```

### Operational limitations
- POC preview data is synthetic, not authoritative or regulatory.
- A missing/failed A03 assessment is **not** a genuine severity of zero.
- Do not backfill actual `NMC_AI_RISK_FACTOR` source evidence with fake A03 rows.
- Do not silently retry paid Airia assessments or reset historical source scores.
- A final current policy score requires the real A03 document intelligence process and approved evidence.
