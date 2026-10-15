# NMC A01 — Proposed Decision Intelligence & Human Feedback Contract (Draft v1)

**Project:** MOEI UAE Unified Maritime Digital Services Platform / National Maritime Centre (synthetic POC)  
**Owners:** NMC Business Product Owner + MOEI process/authority owners + Airia A01 team + Platform Engineering  
**Status:** Proposed for joint contract approval. **Not yet implemented in Airia or the running NMC UI.**  
**Reference:** Current integration `ai-proxy/server.mjs::prepareCaseA01Actions`, `ai-proxy/nmc-action-plan.mjs::normalizeA01Actions`, Case Workspace, saved A01/A02 assessment.

## 1. Approved business principle

For every **maritime case**, the agent should return **one clearly identifiable primary proposed decision**, linked to substantiated findings and the actions needed to execute it. Distinct, independently actionable decisions may be returned separately only when justified. Actions are **not** themselves final decisions. An NMC officer or other configured authorized user reviews, accepts, modifies, rejects or requests information; platform authority rules determine the permitted decision and downstream workflow. **An AI suggestion never creates a legally authoritative maritime decision.**

The proposed screen must answer, in this order:
1. **What is the operational concern?** Plain-language Arabic/English situation summary; distinguish facts, contradictory sources, uncertainties, and risk classification.
2. **What is the primary proposed decision?** Business-language title, purpose, justification, verified evidence, urgency and known limitations.
3. **Who can decide and who must act?** *Suggested* route from A01; **authoritative ownership and approval from platform Decision Authority Matrix**, never from free-form agent text.
4. **What happens after acceptance?** Ordered/parallel implementation actions, dependencies, evidence required to complete, external hand-offs and verification/closure gates.
5. **What did the officer decide?** Retain original suggestion, final human selection, reasons, evidence, outcome and audit trail. Send bounded feedback asynchronously; never silently retrain or change policy.

## 2. What is wrong with the existing UI/API

Today Airia A01 returns `summary`, `whyItMatters`, evidence groups and `proposedActions[]` (with `actionType`, `title`, `reason`, `ownerRole`, `confidence` and `evidenceIds`). The platform enforces seven permitted action types and normalizes them to central tasks after human acceptance. **No primary proposed decision field exists.**

There are two separate problems:
- `normalizeA01Actions` currently substitutes the generic string **"A01 recommendation linked to the validated source evidence IDs"** if the agent omits `reason`/`rationale`. This string must **never** be shown to an operator as a substantive explanation. New decision mode must **reject missing business-specific reasoning** and show a clear unavailable/needs-review state.
- Existing **"Accept with note"** records `MODIFY` but still creates a task using the agent's original `actionType`. A real modification must select a valid **replacement decision/action route**, preserve the original, and run server-side authority/evidence checks before generating any task or referral. Do not label the current behavior a real modified decision.

## 3. Case-level request from NMC to A01 (proposed `CASE_DECISION` mode)

The existing call already provides exact saved risk provenance, validated signal evidence, IMO and an explicit user-initiated A01 call. Extend **only the case-intelligence invocation**; do not change the scheduled fleet assessment A01/A02 contract.

```json
{
  "requestMeta": {
    "correlationId": "CASE-<case-id>-<version>",
    "language": "ar",
    "schemaVersion": "nmc-case-decision.v1"
  },
  "subject": {"type": "VESSEL", "imo": "<seven-digit IMO>"},
  "bundleRef": "VBL-<IMO>",
  "mode": "CASE_DECISION",
  "officialRisk": {
    "evaluationId": "<saved assessment id>",
    "score": 60,
    "level": "Watch",
    "rulesetVersion": "<published source ruleset>"
  },
  "riskSignalRunId": "<same saved assessment id>",
  "approvedSignalEvidence": [
    {"factor": "inspection", "severity": 0, "evidenceIds": ["<verified-id>"], "reason": "<saved reason>"}
  ],
  "requestedOutputs": [
    "SUMMARY", "WHY_IT_MATTERS", "EVIDENCE", "ACTIONS",
    "PRIMARY_PROPOSED_DECISION", "ACTION_RELATIONSHIPS", "UNCERTAINTIES"
  ],
  "provenance": "SYNTHETIC_POC_NOT_REGULATORY"
}
```

The numbers and evidence items above illustrate shape only. Production requests **must use the immutable saved source values** and no unsaved/guessed signal. `language` can reflect the user preference, but `titleAr/titleEn` and plain-language bilingual rationale must be available regardless of the current display language. Do not use `CASE_DECISION` until Airia confirms it is supported; introducing it unilaterally can break A01.

## 4. Proposed A01 response contract (`nmc-case-decision.v1`)

**Backward compatibility:** Preserve `summary`, `whyItMatters`, `evidence[]`, and `proposedActions[]` for current integrations. Add **exactly one** `primaryProposedDecision` and optional distinct `additionalProposedDecisions[]`.

### Primary decision (required)

| Field | Purpose | Rule |
|---|---|---|
| `decisionId` | Stable ID within the response | 1–60 safe characters |
| `decisionCode` | Candidate from agreed business decision catalogue | Platform validates against configured catalogue; not arbitrary text |
| `titleAr`, `titleEn` | Decision in plain business language | Required, specific, non-empty |
| `rationaleAr`, `rationaleEn` | **Why this decision** from concrete evidence | Required, meaningful; no placeholder |
| `expectedOutcomeAr`, `expectedOutcomeEn` | What result would demonstrate progress | Required |
| `evidenceIds[]` | Verified supporting evidence IDs | Required except explicit no-action case; must intersect trusted saved evidence |
| `uncertainties[]` | Missing/conflicting/externally unverified information | Must distinguish asserted vs verified; no automatic closure |
| `urgency` | Agent's suggested priority | `IMMEDIATE/HIGH/MEDIUM/ROUTINE`; advisory, not official SLA |
| `confidence` | Agent-estimated confidence | Number 0–1, labeled **model confidence, not legal certainty** |
| `requestedActionIds[]` | References into `proposedActions[]` | All IDs unique and resolvable, no implicit task generation |
| `suggestedRoute` | Suggested department/handoff | Label only; must not authorize execution |
| `externalExecutionSuggested` | Whether agent expects another unit/agency | Boolean advisory; actual route decided by authority matrix |
| `finality` | Can it be considered complete now? | Agent must use `REVIEW_REQUIRED` or `PENDING_EXTERNAL_OUTCOME`, never `FINAL` |
| `outcomeVerification` | Explicit evidence/verification needed before closure | Required if there is any external action or unresolved discrepancy |

### Actions (existing fields preserved, new explanation added)

Each `proposedActions[]` must retain `actionId`, supported `actionType`, `title`, `reason`, `priority`, `confidence`, `evidenceIds[]`, `requiresHumanApproval`. The platform continues to assign execution roles from its **allowlisted action-type mapping**, not arbitrary AI `ownerRole`.

New suggested fields: `titleAr`, `titleEn`, `businessReasonAr`, `businessReasonEn`, `expectedEvidenceIds[]`, `dependsOnActionIds[]`, `relationship` (`REQUIRED_STEP`, `PARALLEL_STEP`, `CONDITIONAL_STEP`, `INDEPENDENT_DECISION`), `condition` when conditional, and `completionEvidenceDescriptionAr/En`. The backend must reject cycles, invalid IDs, contradictory instructions and unsupported types rather than fabricating valid tasks. `NO_ACTION` cannot coexist with mandatory intervention for the same decision without explicit explanation and validation.

### Additional independent decisions (optional)

Only propose when a **different** business decision needs independent acceptance/authorization. Each uses the same structure as the primary decision and its own action references. The response must never present four unrelated action cards as four "final decisions".

### Insufficient/conflicting evidence

If evidence is insufficient, provide a `decisionReadiness` value of `REQUIRES_VERIFICATION` and explain precisely what is missing. May propose a **verification/referral** decision, but must not assert the deficiency is closed, certificate valid, or ship safe. Return `NO_SAFE_DECISION` if even a safe recommendation cannot be substantiated. The UI presents an explicit "decision unavailable / request evidence" state, not a fabricated fallback.

## 5. Worked NMC business scenario — IMO 9328471 (synthetic POC only)

Source: the existing Case Workspace screenshot reviewed with the user. It displayed **saved risk 60/100 (Watch)** and:
- MOEI inspection `INS-2026-01301` (19 Aug 2026) with critical fire detection/alarm deficiency `DEF-2026-401`, due 02 Sep 2026, no closure evidence in the MOEI record.
- A simulated external PSC source describing a Jebel Ali detention on 13 Aug 2026 and marking a related deficiency closed on 03 Oct 2026; this **conflicts** with the MOEI record and must be verified. It does not establish actual regulatory closure.
- Conditional Safety Construction Certificate with conflicting class/flag source information; Safety Equipment Certificate expiring 01 Dec 2026.
- Movement signal was low severity.

The **illustrative** primary recommendation for a UX/contract fixture is:

> **Decision:** Refer the unresolved critical safety discrepancy for prompt specialist verification and inspection review.  
> **Reason:** MOEI has no verified closure evidence for a critical fire safety finding; the simulated PSC record disagrees. Certificate status also requires validation.  
> **Officer role:** Review evidence and accept/modify/reject the referral **as allowed by the MOEI authority matrix**.  
> **External execution:** Verification by the competent unit and, **if approved**, Smart Inspection scheduling.  
> **Until outcome:** Continue risk-appropriate monitoring; do not mark deficiency closed or lower the saved risk automatically.

Suggested explanatory steps: verify deficiency closure; verify maritime certificates; consider priority inspection; keep monitoring. These are distinct **execution actions linked to one proposed case-level decision**, not four final decisions. Actual sequencing/handoff remains subject to MOEI rules. See `docs/contracts/examples/nmc-a01-case-decision-9328471.example.json`.

## 6. Human review & decision state machine (platform-owned)

```text
AIRIA_PROPOSED (immutable)
       |
       +-- ACCEPT  --> AUTHORITY_CHECK --> APPROVED --> TASKS/REFERRALS
       |
       +-- MODIFY  --> ALTERNATIVE_CODE + REASON + EVIDENCE
       |                 --> AUTHORITY_CHECK --> APPROVED_MODIFIED --> NEW execution route
       |
       +-- REJECT  --> REASON_REQUIRED --> REJECTED / no original tasks
       |
       +-- REQUEST_MORE_INFORMATION --> PENDING_EVIDENCE / no premature execution
```

- The **decision** is not the same as **case closure**; acceptance of an inspection referral does **not** authorize/record an inspection outcome or resolve the case.
- Capture the original AI object, officer's selected approved alternative, decision reason, officer identity/role, timestamps, evidence links, acceptance version, execution route and subsequent outcome in the central audit log.
- A MODIFY must **not** silently generate the original Airia action. For an approved alternative, task/referral creation must derive **only** from the validated human-selected decision and associated action plan.
- Reject/modify cannot be completed without a reason. Proposed decisions can require supervisor/other agency authorization; **AI cannot set that authority**.
- All writes version-checked/idempotent; authorization must be server-side; avoid duplicate referrals. Respect existing case resolution gates including post-inspection A02 verified reassessment.

## 7. Human feedback contract (separate, asynchronous integration)

Capture in Oracle first, and emit a stable, idempotent outbox event **only after a real human decision is committed**:

```json
{
  "eventType": "NMC_HUMAN_DECISION_FEEDBACK",
  "schemaVersion": "1.0",
  "feedbackId": "<uuid>",
  "caseId": "<uuid>",
  "imo": "9328471",
  "sourceAssessmentId": "<saved assessment id>",
  "aiDecisionId": "<proposal id>",
  "originalDecisionCode": "<AI catalogue code>",
  "humanDecision": "MODIFY",
  "approvedDecisionCode": "<validated alternative>",
  "reasonCode": "<approved controlled taxonomy>",
  "reasonText": "<bounded operator explanation>",
  "evidenceIds": ["<trusted evidence id>"],
  "actorRole": "NMC_OFFICER",
  "decisionAt": "<ISO 8601>",
  "executionOutcome": null,
  "reviewStatus": "PENDING_GOVERNANCE_REVIEW"
}
```

- **Delivery:** retryable server-side outbox with bounded retry/backoff, deduplication, visibility, and no impact on successful human decision if Airia is unavailable.
- **Safety:** strip secrets, document bytes, free-form personal data and unapproved evidence from the feedback payload. Security review required before enabling export.
- **Learning:** submitting feedback does **not** fine-tune/retrain A01 by itself. Airia must confirm an ingestion API and separately governed use of approved historical decisions (e.g., retrieval context or versioned prompt improvement). No self-modifying rules or silent online training.
- **Cost:** do not invoke Airia on every decision button click. Queue feedback and send **only after explicitly enabled** by an administrator with cost/security controls.

## 8. Acceptance criteria for Airia & platform

| ID | Test | Expected result |
|---|---|---|
| A01-D01 | One complete A01 result | Exactly one primary case decision; actions explicitly linked to it |
| A01-D02 | Missing `reason`/`rationale` | Clearly report explanation unavailable; no generic filler masquerading as evidence |
| A01-D03 | Conflicting MOEI vs simulated PSC closure | Clearly label the conflict; never claim verified closure |
| A01-D04 | Watch score plus critical open safety finding | Preserve saved 60/Watch; independently flag critical operational concern |
| A01-D05 | No validated evidence for intervention | `NO_SAFE_DECISION` or `REQUIRES_VERIFICATION`; do not fabricate tasks |
| A01-D06 | Arabic/English operator | Readable bilingual decision with business-specific explanation |
| NMC-D07 | Accept proposed referral | Server validates authority and creates only authorized tasks/queue entries |
| NMC-D08 | Modify inspection → certificate verification | **No inspection referral** from the original suggestion; correct human-approved alternative executed |
| NMC-D09 | Reject proposed decision | No associated tasks created; audited reason mandatory |
| NMC-D10 | Referral accepted, inspection incomplete | Case remains open, not automatically resolved |
| NMC-D11 | Inspector outcome recorded | Case closure waits for verified post-inspection evidence and new saved risk as required |
| NMC-D12 | Airia feedback unavailable | Human decision stays persisted; feedback marked pending/retriable |
| NMC-D13 | Page refresh / read-only API | **Zero** paid AI calls |
| NMC-D14 | Legacy action-plan already persisted | Existing `proposedActions` and decisions remain readable; do **not** retrofit an AI-authored primary decision without a new valid response |

## 9. Implementation responsibility & rollout gates

**Airia:** confirm `CASE_DECISION` mode or separate pipeline, bilingual decision schema, evidence-specific rationale, independent/linked decisions, realistic uncertainty, validated response examples, optional feedback ingestion/learning capability.

**NMC Backend (Spring/POC Node as appropriate):** versioned validator/adapter; decision catalogue and MOEI-approved authority matrix; decision lifecycle and schema migration; human modification and outbox; immutable assessment provenance and audit; explicit permissions.

**NMC Angular:** clean narrative (situation → proposed decision → why/evidence → impact/external handoff → actions), visible advisory labels, independent Proposed Decisions inbox, true Accept/Modify/Reject/Need Information controls, clear missing-evidence states.

**Sequence:** (1) approve catalogue/authority owners; (2) Airia contract agreement with tested sample responses; (3) implement read-only UI with existing stored evidence while marking `Primary AI Decision: not available` on legacy cases; (4) implement strict backend decision persistence + human modification; (5) accept new A01 output and test; (6) separately opt in to feedback ingestion. **Do not enable paid calls, re-score vessels, rewrite old assessments, or change Oracle schema without approval.**
