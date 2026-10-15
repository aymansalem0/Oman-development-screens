# NMC POC — AI-informed Maritime Decision → Execution Actions
**Scope:** Non-operational POC, MV Gulf Horizon and the existing 420-vessel demo.
**Mode:** NMC POC policy v1.0. Airia A01 request/response schema is UNCHANGED.

## 1. Traceable decision source and business interpretation

1. Airia A01 situation assessment returns `summary`, `whyItMatters`,
   `evidence[]`, `proposedActions[]` using existing integration contract.
2. `normalizeA01Actions` validates evidence references and action metadata.
   In the POC, unsupported A01 action text is NOT executable. It is
   represented as `UNMAPPED_AI_ACTION`, retaining `originalActionType`.
3. **NMC policy** selects one A01 source recommendation deterministically,
   preserving its exact original `actionId/actionType/title/reason/confidence/evidenceIds`.
   This is **not** a new decision authored by Airia; the selection and
   steps originate in the NMC POC decision/action catalogue.
4. The new `operationalDecision` contains the single proposed business route
   and all linked execution steps; officer Accept/Modify/Reject acts on
   **one decision**, not seven independently executed A01 suggestions.
5. Officer Modify preserves the original A01 proposal and creates a structured
   `decisionFeedback[]` record with the original, effective, and reason.
   The event is stored with `QUEUED_AWAITING_AGENT_INTEGRATION`;
   **no AI decision-improvement agent endpoint has been supplied and no event
   is asserted as transmitted or used for autonomous retraining**.
6. Stored overall risk at case creation remains immutable; only a separate
   verified A02 + deterministic Risk Engine process may later produce a
   new risk record. Inspection completion does not automatically close the case.

## 2. Decision → action mapping in the POC

| NMC catalogue decision | Required actions and handoff |
|---|---|
| VERIFY_DEFICIENCY_CLOSURE | Review recorded finding → request rectification/closure evidence → verify outcome |
| VERIFY_CERTIFICATE | Obtain authoritative certificate → reconcile status and discrepancies |
| REVIEW_DEFICIENCY | Review outstanding deficiency and follow-up |
| ENHANCED_MONITORING | Assign heightened watch → review movement/compliance updates |
| REQUEST_EXTERNAL_VERIFICATION | Send verification request → record competent-authority reply |
| REFER_SMART_INSPECTION | Create **one** NMC inspection referral; Smart Inspection owns scheduling/field lifecycle, not NMC |
| UNMAPPED_TO_INSPECTION | Unknown A01 recommendation or human-selected unmapped route → human-review inspection referral, **never automatic enforcement** |
| PORT_ENTRY_RESTRICTION | **Simulated only:** jurisdiction/legal/evidence review → competent-authority authorization step → POC restriction record |
| DETAIN_PENDING_RECTIFICATION | **Simulated only:** inspect verified PSC findings → documented authority review → rectification verification / simulated release |
| NO_ACTION | Record a reasoned review; no workflow tasks |

The current ranking picks evidence-supported deficiency verification ahead of
inspection when both exist. A human can modify this choice. It does **not**
equate a high risk score or one contradictory source with detention or
an all-UAE-ports ban.

## 3. Restriction-specific safeguards (no live regulatory power)

- `PORT_ENTRY_RESTRICTION` and `DETAIN_PENDING_RECTIFICATION` are
  **demonstration business decision codes only**, selectable by the operator
  as human modifications with mandatory reason.
- Approval creates a case-linked `restriction` in state
  `PENDING_AUTHORITY_APPROVAL`. No ship/port is actually banned or detained.
- Separate publisher-key approval with an authority reference and legal-basis
  narrative changes it to `SIMULATED_ACTIVE`. A publisher key is **not**
  proof of legal appointment or statutory competence.
- Release requires a supervisor-key action plus a rectification/release
  evidence reference; it produces `SIMULATED_RELEASED`.
- In the POC there is **no UAE port system write**, movement prohibition,
  automated communication, real detention or statutory order.
- Closure is blocked while the simulated restriction is pending or active.
- Before any production adoption, MOEI must confirm competent regulator,
  flag vs port State jurisdiction, vessel's location, legal instrument,
  PSC inspection record/deficiency classification, grounds/appeal,
  authorizing official, notice recipients, revocation mechanism and audited
  integration target(s).

## 4. Sources and interpretation boundaries

Project files:
- `MOEI_NMC_POC_AI_Business_Scenario_and_Integration_Specification_v3.1`:
  A01 advises; risk stays deterministic; detention/restriction/enforcement
  is a *recommendation subject to an authorized human decision*.
- `POC_Business_Case__National_Maritime_Center`: user sees evidence-backed
  recommended actions, restrictions, inspection handoffs and case audit trail.
- `POC_Business_Case__Smart_Inspection`: authorized inspector confirms
  findings and post-inspection corrective action/follow-up.

Public international guidance (not proof of UAE authority):
- IMO PSC overview: https://www.imo.org/en/ourwork/iiis/pages/port%20state%20control.aspx
- IMO Procedures for Port State Control, 2025: resolution A.1206(34).

**Not established from project sources:** a general MOEI permission to ban
any vessel from *all UAE ports* or detain *any* vessel purely by AI score.
These actions require specific UAE legal and administrative validation.
