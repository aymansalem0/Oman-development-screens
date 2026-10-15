# NMC Human Review Workflow V1 — Implementation blueprint

Status: **design specification only**. This file does not create tables, activate write APIs, or change saved assessments.

## Approved POC evidence baseline
- Vessel: MV Gulf Horizon, IMO 9328471
- Saved assessment: d48953e9-344c-4c2b-83a2-bf305b624c63
- Saved risk score 60/100 (Watch); priority Priority Review because a critical open *synthetic* finding is present.
- Five saved A01/A02 factors with severity, confidence, evidence IDs.
- Structural quality 75/100; four identity fields compared; zero persisted field disagreements.
- Sources are synthetic and not verified by maritime authorities. **No regulatory decision is authorized by the AI result.**
- Fleet automatic scheduler remains off; no Airia calls required to review saved results.

## User journey
1. Maritime Risk Analyst opens Vessel 360 > Saved Assessment > **Open Human Review**.
2. Server verifies authenticated identity/role and checks whether a review case already exists for the current immutable assessment. No duplicate cases.
3. Analyst sees the five AI findings with A01/A02 provenance, severity, confidence, linked evidence IDs, reasons and structural data quality limits.
4. For each finding: **Accept**, **Reject**, **Modify**, or **Request Evidence**. Every submitted decision requires a rationale; modifications require replacement interpretation and/or proposed action. No automatic certificate restriction, detention or enforcement action.
5. Review case may move **ASSIGNED → IN_REVIEW → PENDING_SUPERVISOR → CLOSED**; **RETURNED** is allowed if a supervisor requests further work.
6. Supervisor has explicit approval/rejection actions; analyst cannot approve their own review when segregation of duties is enabled.
7. Immutable assessment/risk score stay unchanged; resulting human decisions and events have their own IDs and timestamps.
8. Vessel 360 shows latest human review status next to the saved AI assessment, with a link to decision history; missing review is correctly shown as **Not reviewed**.

## Data model — additive Oracle schema, not yet installed
- `NMC_REVIEW_CASE`: REVIEW_ID (PK), IMO (FK), ASSESSMENT_ID (FK), STATUS, ASSIGNED_REVIEWER_SUB, CREATED_BY_SUB, CREATED_AT, UPDATED_AT, VERSION, CLOSED_AT. Uniqueness by ASSESSMENT_ID for single V1 review case.
- `NMC_REVIEW_DECISION`: DECISION_ID (PK), REVIEW_ID (FK), FINDING_ID (FK to NMC_AI_FINDING), DECISION_TYPE (ACCEPT/REJECT/MODIFY/REQUEST_EVIDENCE), REASON, PROPOSED_ACTION, EVIDENCE_REFS_JSON, AUTHOR_SUB, RECORDED_AT. Append new decision version; never overwrite prior decision.
- `NMC_REVIEW_EVENT`: EVENT_ID (PK), REVIEW_ID (FK), EVENT_TYPE, FROM_STATUS, TO_STATUS, ACTOR_SUB, EVENT_TIME, DETAILS_JSON. Append-only audit trail.
- `NMC_REVIEW_CASE` version column provides optimistic concurrency; reject conflicting edits.

## Suggested read/write APIs
- GET `/api/ai/reviews/vessels/:imo`: authorized read, current assessment review summary.
- GET `/api/ai/reviews/:reviewId`: read case, decisions and audit trail, with server-side role check.
- POST `/api/ai/reviews`: create or resume a case for a saved assessment (idempotency key).
- POST `/api/ai/reviews/:reviewId/decisions`: write a human decision with validated finding/assessment ownership.
- POST `/api/ai/reviews/:reviewId/transition`: role-validated lifecycle transition with version check.

## Mandatory security gate before enabling write APIs
- V1 POC has **no implemented authenticated reviewer identity** today. Existing recommendation buttons in the Angular AI Situation Assessment page currently update UI state only, not Oracle.
- Do **not** expose anonymous review decisions, trust an actor/role field submitted by Angular, or treat `X-User` as authenticated identity.
- Validate signed JWT at the backend against platform IAM (Keycloak integrated with UAE PASS in target solution) or a separately agreed POC identity integration. Enforce role permissions server-side.
- Until auth is integrated, keep review API read-only or reject writes with 403; an offline UI prototype may be built for demo with explicit synthetic label.
- Use a manual additive migration reviewed via Toad/DBA; do not auto-run DDL or delete volumes.

## Acceptance tests
- Saved risk 60/Watch and five factors never change when reviews are added.
- Wrong IMO/assessment/finding relationship is rejected.
- Unaunthenticated write is forbidden; analyst cannot self-approve where segregation required.
- Re-submitting same idempotency key cannot create duplicate cases or decisions.
- Simultaneous edits produce 409 conflict, not lost audit.
- Review history survives backend restart; all events have authenticated subject and UTC timestamp.
- Review actions cause **zero** Airia calls and no automatic regulatory enforcement.
- Synthetic provenance is visible on every review screen.

## Out of scope for V1
- Automated legal enforcement, vessel detention, official port state compliance conclusions.
- Production-grade external authority evidence verification, digital signatures, full IAM deployment.
