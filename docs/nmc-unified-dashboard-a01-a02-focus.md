# NMC AI KPI Focus — Reuse existing A01/A02 contracts (replaces proposed separate pipeline)

## Business choice / user request
The NMC Command Center is a **maritime risk** dashboard. Reuse the **already configured Airia A02 and A01** rather than commissioning a new dashboard agent. Keep their actual input/output JSON shapes unchanged. Prefer evidence-grounded maritime AI advice, **without manufacturing a KPI-specific JSON response field**.

The eight dashboard counts remain: synthetic AIS/LRIT contacts, assessed vessels, High-only risk, Critical risk, unique vessels requiring attention, active alerts, open cases, and unresolved incident reports. These overlap conceptually; they are not additive.

## Existing transport / contracts

**Stage 1: A02 — the existing fleet risk-signals request/response**

- `executeAgent('a02', a02Request)` uses the existing pipeline identifier and shared `AIRIA_MENA_KEY`.
- Original request keys: `requestMeta`, `subject:{type:'VESSEL',imo}`, `bundleRef`, `contextMode:'INLINE'`, `officialScoringRequested:false`, `inlineContext`, `requestedSignals:['inspection','certificate','dataQuality']`.
- The new aggregate, **non-risk** dashboard context is placed inside the **existing `inlineContext` object**, not a new top-level request key. Existing vessel identifiers/evidence stay intact.
- The A02 response still uses the existing `signals` array of evidence-cited, validated A02 factors with severity, confidence and evidence IDs. No `focusMetricId` response field.
- A02 alone cannot authorize a selected KPI.

**Stage 2: A01 — the existing `SITUATION_ASSESSMENT` request/response**

- Same existing pipeline, standard request keys: `requestMeta`, `subject:{type:'VESSEL',imo}`, `bundleRef`, `mode:'SITUATION_ASSESSMENT'`, `officialRisk` referencing the saved immutable assessment, `riskSignalRunId`, `requestedOutputs:['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS']`, `approvedSignalEvidence` (original five factors, original severity/evidence ID), `provenance`.
- The eight counts are appended as bounded **synthetic dashboard summary text** to an already-existing `approvedSignalEvidence[].reason` string. No new risk factor or mutated official score. The original vessel-specific evidence IDs remain untouched.
- A01 responds using **the SAME** `summary`, `whyItMatters`, `evidence`, `proposedActions`, `priority` fields.
- For the POC only, the existing `whyItMatters` explanation may include one textual **`FOCUS_KPI:<id>`** marker, naming an ID supplied inside the dashboard context. This is content within an existing string, **not** a new response JSON property.
- The platform validates exactly one known marker, non-null count, the A01 situation/evidence/actions shape, and known saved evidence IDs. If the partner model ignores the marker or invents evidence, the UI **does not highlight any KPI**. A01 and A02 are VESSEL-focused agents, so this compatibility is experimental, not guaranteed by their original contracts. The result identifies an operator-attention suggestion, **not an official fleet risk judgment**.

## Payment / human control
- Both A02 and A01 run **only** after clicking `Ask AI: What needs focus?`, acknowledging that **two paid requests may occur**, and supplying the existing Dashboard Editor key. No paid calls during GET, route changes, background fleet refresh, or dashboard filtering.
- Fail fast before Airia if fewer than five KPI values available, missing saved vessel, missing evidence, invalid client numbers, or missing operator permission.
- A02 response is checked before A01 starts; failed A02 won't charge for a subsequent A01. If A01 does not produce a valid KPI marker the two calls may still have been billed; the UI discloses this possibility.
- The subject is a saved, valid, already-assessed POC vessel (highest current saved risk with available evidence bundle), **not a fake 'dashboard vessel'**. Its IMO/source assessment ID are returned for traceability.
- No Oracle/Google Sheet writes, scoring, alerts, tasks, enforcement or case state transitions.
- An identical KPI snapshot + vessel assessment ID can be reused in-memory for five minutes. If visible KPI counts change, previously highlighted card is immediately unhighlighted.
- The Arabic UI displays original model English explanation when no Arabic explanation is present. No fabricated Arabic AI quotation is produced.

## Configuration (no new pipeline)
- Existing `AIRIA_MENA_KEY`, `AIRIA_A01_PIPELINE_ID`, `AIRIA_A02_PIPELINE_ID`, `NMC_A01_ENABLED`, `NMC_A02_ENABLED`, and the dashboard Editor action key.
- Only extra opt-in: `NMC_DASHBOARD_AI_FOCUS_ENABLED=true`. **Defaults false** to prevent accidental paid calls.
- Old planned `AIRIA_NMC_DASHBOARD_FOCUS_PIPELINE_ID` was deleted. Do not set or create this pipeline.
- `GET /api/ai/nmc/dashboard-focus/status` is free; `POST /api/ai/nmc/dashboard-focus/run` checks Editor key and `confirmCost:true`.
- Recreate `ai-proxy` only after validating existing four Compose files and keeping automatic Fleet/Incident AI disabled if desired. The unrelated PR #77 A03 retirement and PR #81 incident filter remain in branch history.

## Validation
```bash
node --test ai-proxy/test/nmc-dashboard-focus.test.mjs
node --test scripts/test-nmc-unified-kpi-ui.mjs
npm run build
```

Unit tests are contract mock tests, not proof that production A01 understands the optional `FOCUS_KPI` textual marker. The final Airia test must be authorized and budgeted. A model that refuses the marker is a capability limit **without changing the original response schema**; it must never be quietly replaced with a fake deterministic AI outcome.


## Regression discovered from deployed screenshot, 12 October 2026

The user observed 60/420 assessed vessels in the unified dashboard but
`DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE` after pressing AI Focus.

**Confirmed software cause:** the initial dashboard focus selector read
`fleet.snapshot().results`, a public summary whose DTO intentionally omits
`signals` (five A01/A02 factor details) and other original evidence. It then
filtered on `Array.isArray(row.signals)` so it rejected every one of the 60
assessed rows, even when Oracle had complete historical/current risk factors.
This was not evidence that Oracle lost the assessments.

Fix: the new pure `selectDashboardFocusVessel(fleet,bundles)` uses the public
snapshot ONLY to enumerate eligible IMO IDs, then reads the exact full
in-process saved row from `fleet.getVesselResult(imo)`, which was restored by
`OracleIntelligenceStore.loadLatest()` together with five risk factors and
their evidence IDs. It validates source completeness, checks that a matching
immutable bundle is present, and picks the highest saved-risk eligible vessel.
It makes no Oracle writes or agent requests.

Free preflight now returns `assessmentContextReady` and `sourceImo` on
`GET /api/ai/nmc/dashboard-focus/status`. Angular disables the paid action
until those source checks pass and displays a truthful state. When no eligible
source exists, no A02/A01 request is issued.

Tests reproduce the observed condition: `counts.assessed=60` and public
snapshot records without signals; the raw persisted records carry five factors
and allow A02 then A01. A negative fixture rejects incomplete evidence with
zero paid calls.

Verify after deploying the fixed frontend and ai-proxy:
```powershell
Invoke-RestMethod http://localhost:4200/api/ai/nmc/dashboard-focus/status |
  Select-Object configured, assessmentContextReady, sourceImo, potentialAgentCalls
```
A `True` readiness result confirms the saved vessel evidence path works; it
does NOT establish whether the live A01 model will return the optional
`FOCUS_KPI` textual marker. A subsequent explicitly authorized paid trial
is still necessary.
