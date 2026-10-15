# Smart Inspection POC: SI-P01 Scope Decision (13 October 2026)

## Decision and rationale

**SI-P01 is not used in the current MOEI Smart Inspection Business POC.**
It used to advise the execution order of **already approved inspection cases**; it is not the pre-approval vessel selection agent. The 13 October Airia Partner API Guide does not provide a verified dedicated MENA SI-P01 Pipeline ID. There is no reason to add a second post-approval model ranking step to the agreed C01-led rolling planning journey.

The active business sequence is:

1. Create a named rolling inspection plan and assemble source-stamped NMC, PSC and service candidates.
2. Apply deterministic eligibility/mandatory priority policies.
3. Optionally invoke **SI-C01** to recommend pre-approval vessel selection, evidence-grounded priority and rationale. Authorized personnel can include/defer/not-select candidates and document reasons without AI.
4. Authorized supervisor approves the **entire plan**; immutable case/source evidence and approved execution order are preserved.
5. Prepare inspection cases, dossiers and dynamic published checklist scope; **A04** remains an optional, human-reviewed preparation advisor.
6. Deterministic ERP/availability solver produces feasible schedules; optional **SI-S01** may rank only those verified feasible slots. AI never books a slot or overrides published eligibility.
7. **SI-V01** optional field evidence advice, **SI-R01** report/CAPA drafts from confirmed findings, and **SI-X01** verified historical repeat/conflict advice follow inspector-led processing.

The official NMC risk score is always owned by the deterministic Risk Engine, not any SI agent.

## Implementation safeguards in this feature branch

- `SI_P01_ENABLED` is permanently **effective false**, including mock mode, host ENV true and old persisted runtime overrides. Existing runtime historical settings are not rewritten on startup.
- AI Settings & Governance still shows the historical SI-P01 switch (read-only, disabled) and future-only pipeline ID but cannot publish `SI_P01_ENABLED=true`.
- `POST /api/si/v1/prioritization/run` returns **409 SI_P01_OUT_OF_CURRENT_POC_SCOPE**. GET status/history and deterministic POST preview remain available to inspect historical saved results, without triggering Airia.
- The supervisor plan wizard no longer offers SI-P01; its approved-plan request explicitly sets `runP01:false`.
- `POST` bulk plan approval rejects `runP01:true` with 409, even in mock mode. Previously queued legacy jobs preserve cases and dossiers but mark P01 **SKIPPED_OUT_OF_CURRENT_POC_SCOPE** instead of executing it.
- Existing P01 engine source and saved historical recommendation runs remain untouched for potential future, separately approved reinstatement. No Oracle migration or approved-case deletion.

## Future feature boundary

Post-approval **dynamic execution reprioritization** is a *separate future business enhancement* requiring MOEI-approved priority/override authority, workload effects and audit requirements. Do **not** claim an authorized post-approval manual reorder capability unless that specific workflow is independently implemented and accepted. Current **pre-approval** plan changes, including recorded officer requested rank within the C01 workbench, are already distinct from post-approval execution changes.

## Acceptance checklist

1. Loading a historical `SI_P01_ENABLED=true` override returns false; publishing true fails.
2. P01 run API fails with 409 and zero mock/Airia requests; historical read views still work.
3. A complete approved plan creates the same SI cases and SI-02 dossiers with `runP01:false`; A04 remains available with explicit request.
4. Legacy queued `runP01:true` does not dispatch P01 or invalidate approved cases.
5. SI-C01 rolling plan selection, officer pre-approval decisions, human supervisor approval, A04 and SI-S01 scheduling are unaffected.
6. CI Angular and Node tests pass. Live Airia contract validation and local Docker rollout remain separate release gates.

**Delivery caution:** This is a draft GitHub feature on top of the earlier Airia integration PR #101; it is not evidence of deployment to the local Windows Docker runtime, live Airia acceptance or MOEI production authorization.
