# MOEI NMC POC — AI-generated Case Actions and Smart Inspection Scheduling Handover (Design v1)

Status: **PROPOSED / NOT IMPLEMENTED**. Implement as the next feature increment on top of the NMC central-case branch. This is a business/API/acceptance contract, not a claim that A01 already generates persistent tasks or that a scheduling queue already exists.

## Objective and agent ownership

- **A01 — National Maritime Intelligence** is the accountable agent for NMC situation assessment and **evidence-backed proposed case actions**. The system must not invent tasks merely because a synthetic fixture risk exceeds a threshold. A01 returns proposals, not persisted tasks or authoritative decisions.
- **A02 — Vessel Compliance** supplies inspection/certificate/compliance findings, evidence and corrective-action candidates to A01; on verified inspection outcomes it supplies refreshed compliance risk signals.
- **A04 — Smart Inspection** produces the **pre-inspection dossier, checklist focus, suggested inspection items and inspection evidence/report assistance**, after the approved inspection request enters the Smart Inspection workflow. A04 cannot modify the authoritative baseline checklist or its mandatory items.
- **A03 — Document Intelligence** analyzes an actual allowed PDF/image only on demand.
- **Platform Case Service / Risk Engine** validate and save human-approved case tasks, create inspection scheduling requests, and deterministically recalculate risk after the evidence/signal refresh. Airia cannot write Oracle, schedule inspectors itself or set risk scores.

These assignments follow MOEI_NMC_POC_AI_Business_Scenario_and_Integration_Specification_v3.1, sections 1, 2, 4, 7.2, 7.5 and 11.

## Required end-to-end interaction

1. NMC operator selects IMO (e.g., 9328471). Display last **saved A01/A02-derived** risk (case example **60/100**) and its assessment ID/version. The unrelated synthetic catalog **87/100** must not become the source risk of this case.
2. Operator explicitly requests **Generate Action Plan** from A01, or uses a verified cached A01 Situation Assessment belonging to the same IMO, saved assessment, source-snapshot and configuration version. No automatic calls on view/load.
3. Gateway verifies A01 response schema, action types, evidence IDs, agent/version metadata and validity/age. The response must not contain a final risk score to be applied.
4. Present A01 **PROPOSED** actions to human NMC officer with reason, evidence, confidence, action type, owner role, priority and `Accept / Modify / Reject`. A proposal never becomes a business task merely by arriving.
5. After officer approval, the platform creates **dynamic case tasks** from the approved action records and tracks ownership/status. This **replaces** current hardcoded `initialTasks(alert)`, rather than layering fake AI labels on hardcoded tasks. Rejected actions produce no tasks. Officer-created emergency actions must be separately marked `HUMAN_CREATED`.
6. An approved action of type `PRIORITY_INSPECTION` / `REQUEST_INSPECTION` creates one **Inspection Scheduling Request** for the same case, IMO and action ID, with status `PENDING_SCHEDULING`. Creating the request is **not** booking an inspector/time and is **not** completion of the inspection.
7. Smart Inspection > **Required Inspections / Scheduling Queue** displays the inbound request with vessel, IMO, case number, risk at referral, reason, priority, requested inspection type, evidence IDs, preferred port/location if known, and readiness. Scheduler assigns date/time, inspector/team, scope and checklist template; transition `PENDING_SCHEDULING -> SCHEDULED -> ASSIGNED` with role guard, conflict checks and audit.
8. A04 prepares a focused inspection dossier against the approved inspection scope and authoritative checklist IDs; only suggested additions/highlights are AI generated. The inspector records results (Pass/Deficiency/N/A), notes/photos, signs/confirms, then inspection completes.
9. Verified changed inspection evidence -> A02 compliance refresh -> platform deterministic **new** risk calculation -> A01 post-action situation reassessment. Preserve the old 60 result and separately version any resulting new score. If no valid refresh, show `REASSESSMENT_PENDING`, not `87`, `60 - 18` or a claimed risk reduction.
10. Case reviewer checks linked inspection outcome, follow-up/corrective actions and new risk assessment, then supervisor closes with reason when all business closure conditions hold. Closing the case never changes risk in itself.

## A01 proposed-action input/output additions (contract proposal)

Suggested input: `{imo, assessmentId, riskScore, riskLevel, rulesetVersion, sourceSnapshotId, evidenceManifest, existingActiveCaseId?, requestMeta:{correlationId}, mode:"SITUATION_ASSESSMENT"}`.

Proposals must be typed and contain: 
`actionId` (idempotent within run), `actionType` (approved allowlist: VERIFY_CERTIFICATE, ENHANCED_MONITORING, PRIORITY_INSPECTION, REVIEW_DEFICIENCY, REQUEST_EXTERNAL_VERIFICATION, NO_ACTION), `title`, `rationale`, `priority`, `ownerRole`, `evidenceIds[]`, `confidence`, `requiresHumanApproval`, `agentRunId`, `agentVersion`, `modelVersion`, `snapshotId`.

Risk threshold alone cannot synthesize a proposed action. Evidence IDs must resolve within the selected IMO snapshot and allowed manifests. Unsupported/unverified proposals are shown as `INSUFFICIENT_EVIDENCE` and not materialized. Each agent invocation is explicit, cost-controlled and auditable.

## Case + inspection scheduling proposed persistence / APIs

- Store `NMC_AI_ACTION_PLAN` and immutable action proposals with correlation ID, source assessment ID, snapshot, versions, model/agent metadata and response.
- `POST /api/ai/cases/{caseId}/action-plan/generate` — explicit operator-initiated A01 run or approved cached situation reuse, idempotency key required. Validated server-side only.
- `GET /api/ai/cases/{caseId}/action-plan` — no AI call.
- `POST /api/ai/cases/{caseId}/actions/{actionId}/decision` — accept/modify/reject with evidence and reason; approved task is generated transactionally.
- `NMC_INSPECTION_REQUEST` / `NMC_INSPECTION_REQUEST_AUDIT` linked to case + accepted action ID, `UNIQUE(caseId,actionId,revision)`. Suggested request fields: `requestId,caseId,imo,actionId,status,type,priority,reason,evidenceIds,requestedPort,scheduledPort,scheduledAt,assignedTeam,assignedInspector,checklistTemplateId,createdBy,version`.
- `GET /api/inspections/requests?status=PENDING_SCHEDULING` — central queue of required inspections.
- `POST /api/inspections/requests/{id}/schedule` — human scheduler only; scheduling fields validated and version-locked. Subsequent assignment, start and completion transitions auditable.
- Link `inspectionRequestId` and completed `inspectionId` back to NMC case task.
- New Oracle schema migration must be additive and reviewed/backed up first; do not drop/alter old assessment/risk rows. Keep JSON mode compatible. Existing POC's shared role keys are staging only; production needs Keycloak identities.

## Risk integrity (implemented separately in this branch)

- Case score = saved assessment snapshot that created the case, **60/100 for the reported test**, not the unrelated fixture **87**.
- Remove fixed `-18` / `-8` and per-task arithmetic; `Pass` indicates a verified checklist result, not automatically the resolution of a prior historical deficiency or other risk factor.
- Risk score, level and post-case delta only change when a **new persisted deterministic five-factor assessment** exists and can be traced to validated source evidence.
- Existing original A01/A02 risk history stays immutable; do not rerun Airia during display/weight changes/scheduling/normal save.

## Acceptance conditions for the next PR

1. A01 accepted evidence-backed `PRIORITY_INSPECTION` action yields exactly one linked request in `PENDING_SCHEDULING`, visible in Smart Inspection queue across browsers/restarts.
2. No approved action = no generated task and no inspection request; rejecting recommendation leaves case and Oracle risk unchanged.
3. Scheduling requires human scheduler action; inspector/time cannot be invented by AI; repeated requests are idempotent.
4. A04 receives approved checklist IDs, vessel/IMO and case/scheduled inspection context. An AI overlay never erases mandatory inspection items.
5. Inspection all-pass does **not** immediately subtract 18; saved risk remains 60 until new valid persisted risk assessment is separately created. No 87 is displayed for this case.
6. Post-inspection new assessment is evidence-linked/versioned; if unavailable show pending and preserve initial risk; no false version bumps or opaque score claims.
7. No Airia calls on normal page load, task-status change, scheduling action or inspection-result save.
8. Audit records agentRunId, input evidence version, human decision, request creation, scheduler user, inspection result, reassessment and closure independently.
9. Existing migrations 003/004 and other POC dashboards are unchanged.
