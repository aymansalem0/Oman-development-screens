# MOEI Smart Inspection — Separate Eligibility and Execution Ranking (13 October 2026)

## Business decision

**Inspection entry/eligibility and vessel execution ranking are TWO INDEPENDENT rule sets.**
The earlier 100/100/20 source-score proposal is superseded for ranking; it must **not** be used to determine a vessel's execution position.

### A. Eligibility / entry to candidate inspection plan

- **NMC_CASE:** human-approved active NMC referral qualifies; regulatory inclusion remains protected, never inferred from AI.
- **SERVICE_REQUEST:** each actionable pending maritime service request qualifies independently of NMC vessel-risk score; already handled/duplicate events are not automatically a new inspection.
- **PSC_PORT_CALL:** must first be explicitly selected under the separate PSC port-call quota/source controls before entering the pool.
- One vessel per IMO in the UI, retaining every underlying source-event reference and regime. The officer can amend, include, exclude/defer and record reasons. The authorized supervisor approves the plan.
- No source scores (100/100/20), NMC Risk Threshold, five-factor weighted sum or P01 agent controls selection/approval.

### B. Execution ranking (current agreed sequence only)

1. **Vessels approaching departure:** earliest **verified FUTURE ETD** takes priority, in ascending time order. This uses true departure evidence only; **ETA is not ETD**. The ministry has not yet supplied a numeric “near departure” hour window, so no invented window is enforced.
2. **Vessels with active maritime incidents:** for vessels without an eligible verified future ETD, order by the *incident-specific severity* descending, using a current, **human-reviewed** NMC incident assessment. Do not use general NMC vessel risk as substitute. Incident severity is from the NMC incident-specific assessment, not an LLM inference or an official detention order.
3. **Further criteria:** not yet specified by the business. Until then, display remaining vessels in stable IMO order, explicitly marking missing ETD/incident facts.

Where a vessel satisfies more than one criterion, the first defined criterion (ETD) wins. Human requested rank adjustments are restricted to the same ranking category, with an auditable justification. Regulatory inclusion safeguards remain independent from rank position.

## Existing verified inputs and remaining feed gap

- The current PSC Excel source supplies **ETA_LOCAL (arrival)**, not a departure time, so it is **not** used for ETD-based ranking.
- The inspection targeting event model now can retain a `departureAt` ISO timestamp only from a `SOURCE_REVIEWED` event. No ETD is generated from ETA, default vessel fixtures, scheduled inspection time or NMC risk. The present source Excel template does NOT yet contain a verified departure input field; integrating such a field or trusted port/vessel movement API needs a business-approved input contract.
- The existing **NMC Incident Feed** has incident-specific scores and officer review status. A cached, read-only connection is now available to the candidate projection: only fresh HUMAN_REVIEWED, still-active incident assessments are considered. If the Google Sheet POC feed is absent/unavailable, the incident score stays unknown rather than zero. This is *POC synthetic data* when the feed is configured, not certified production evidence.
- AI C01 advice does not override deterministic ranking tiers, officer decisions or official risk scores. SI-P01 remains disabled per PR #102.

## Governance & compatibility

- UI settings are two tabs: **Inspection Entry Rules** (source-controlled) and **Vessel Ranking Rules** (ETD first, reviewed incidents second).
- The new canonical policy document is `{ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}}`. Historical `sourceTriggerScores`, NMC risk thresholds and P01 five-weight objects remain read-only in old versioned policy records to preserve audit.
- Publish creates a new immutable ranking policy version; no automatic database migration, no rewrite of older approved plans. A draft plan must explicitly rerun C01 if new operational facts become available. Preview/publish never calls Airia.
- This is a draft GitHub PR with isolated CI tests. It is not proof of live ETD integration, complete incident source certification, local Windows Docker deployment, or ministry acceptance.

## Acceptance

- Candidate pool size and eligibility remain unchanged by ranking criteria.
- At least two synthetic *explicitly verified* future ETDs order earliest first, ahead of two independent *explicitly human-reviewed* incident scores ordered by severity.
- ETA-only, past ETD, unreviewed incident and missing data do not get fabricated high priority.
- Service Request remains actionable even with null or low saved NMC risk.
- Published approval snapshots remain immutable; officer override persists with reason.
- Backend, Angular and Docker CI all pass before merge or deployment.
