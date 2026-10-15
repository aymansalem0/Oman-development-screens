# MOEI Smart Inspection — Assigned Engineer Work Orders / Guided Inspection UAT

**Scope:** PR #134, dependent on PR #133. Use a dedicated POC environment with published SI mandatory checklists and Oracle migrations 010, 013, 017, 018, 019 available. The demo uses a session-bound **synthetic POC engineer**, not an official ERP employee/qualification. This document describes safe operator verification; it does not assert the customer's local Airia or Oracle environment has been exercised.

## Controlled workflow

1. Sign in to MOEI as an authorised user, e.g. the existing POC Admin account. Open **Smart Inspection → Scheduling → a DRAFT/APPROVED plan → Engineer Roster** in Demo Mode. Verify exactly one roster entry is labelled **MY POC ACCOUNT**, with a synthetic `POC-MY-…` engineer ID. The source ERP Excel file must remain unchanged.
2. Run the existing capacity/qualification/shift/port-aware scheduling preview for a previously approved small plan. Check that the self engineer is considered only for actually feasible demo slots (qualified regimes and visit window). If no self-compatible slot exists, show the scheduling blocker; do **not** fabricate a match.
3. Obtain authorised supervisor approval of the complete feasible schedule and issue work orders. Use the existing workflow; never manufacture a historical approved order merely to populate the UI. **This is a consequential case/workflow action** and must be explicitly approved by the operator.
4. Open `/moei/smart-inspection/my-work-orders`:
   - Show **only** orders for the signed-in identity, in POC mode via the server-generated synthetic ID, or real ERP mapping via `SI_V2_INSPECTOR_IDENTITY_MAP_JSON`. Try a second POC user: their list and the direct dossier URL must not expose the first user's orders.
   - Hover/focus/select a vessel. **GET dossier** must return source metadata without automatically starting the checklist, creating SI cases, or calling Airia. Before activation show **SOURCE_ONLY_PENDING_WORK_ORDER_ACTIVATION**, not a fake prepared AI dossier.
   - Inspect vessel identity/flag, selected regimes, source/event referrals, saved current NMC risk, tracking, certificates, inspection history, open deficiencies, document manifest and evidence provenance. Unavailable sections must be marked missing, never populated with invented values.
5. Select **Prepare Work Order & AI Dossier**. Activation uses the existing authorised workflow: link/create the POC SI case, prepare, freeze **published mandatory checklist revisions**, and invoke the real SI-A04 Airia pipeline if source has a saved risk assessment and admissible evidence. Do not label failed/missing A04 as approved. The supervisor must separately review A04 and approve the exact optional **scope** in the existing preparation/scheduling screens. The approved NMC referral route still requires its independent, confirmed booking.
6. Once status becomes **READY_FOR_FIELD**, the **assigned** inspector clicks **Execute Work Order** (this advances the lifecycle to IN_FIELD under the inspector identity) and lands on:
   `/moei/smart-inspection/my-work-orders/:orderId/execute`.
   - Existing pinned published questions and legacy mandatory checks appear in a **single step list**.
   - Approved optional A04 scope appears as additional steps **only** when A04 supervisor review and lifecycle scope approval both exist.
   - **Duplicate questions** with the **same normalized title** display only once. All original checklist `instanceId` and lifecycle `checkId` bindings remain; saving a single answer writes to all matched saved IDs and requires current versions. Fuzzy matching is intentionally avoided to prevent collapsing legally distinct questions.
7. On each step check **What to do on board** (deterministic inspector guidance), then click **Ask AI: What exactly should I inspect?**:
   - The request goes to the configured live **SI-A04** Airia pipeline, using current case ID, saved risk reference, existing evidence IDs, approved scope and focused instruction under `inlineContext.focusedFieldStep`.
   - The response's citations are validated against the source evidence manifest. If the model only gives generic A04 focus, the interface explicitly warns **general scope focus only**, not a fabricated step-specific instruction.
   - An AI suggestion must never mark **PASS/DEFICIENCY**, upload forged evidence, or save an inspector answer.
8. The assigned inspector enters the observed Boolean, dates, numbers, notes, severity or N/A reason, as relevant. Save. Confirm the original published checklist item IDs and lifecycle checks were updated through their existing services, keeping their audit and version controls. Progress becomes completed **only when every original mapped check is recorded**. Submission/report approval remains in the existing official lifecycle, separate from AI guidance.

## Fail-closed conditions

- Work order is neither APPROVED nor assigned to the session.
- Source lacks a saved risk/evidence needed for live A04 field guidance.
- Pinned checklist was revised after screen load.
- The source dossier or current assignment changed.
- A04 additions remain DRAFT_REVIEW or scope was not approved.
- User tries to save a field check before START_FIELD.
- A forbidden source evidence ID or unsupported response field is supplied.
- Another user requests a direct `:orderId/dossier` or `:orderId/guide` URI.

## Local smoke test commands

```powershell
cd C:\Users\Admin\Oman-development-screens
git fetch origin
git switch feature/si-inspector-guided-work-orders-20261015
git pull --ff-only

$dc = @(
 "-f", "compose.yaml",
 "-f", "compose.oracle.yaml",
 "-f", "compose.google-psc.yaml",
 "-f", "compose.incident-google.yaml"
)
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
```

**Never run** `docker compose down --volumes` or a reset SQL script as part of the UAT. Previous schedules and existing work orders will **not** automatically be reassigned to the logged-in account; the POC self-assignment applies to **new demo schedules** created with the authenticated identity. No official ERP assignment exists until an authorised ERP administrator maps the MOEI session account to an actual ERP inspector ID.

## Automated CI evidence

- `node --test ai-proxy/test/si-inspector-guided-work-orders.test.mjs`
- Existing CI Angular build, backend regression suite, Windows Node 24 JSON POC parity and NMC Docker POC validation.

## Sign-off

Capture: signed-in identity (non-secret), `POC-MY-` engineer ID, source ERP unchanged, approved schedule/work order ID, exactly which assigned vessel appears, dossier source/gaps, pinned checklist revision and original IDs, A04 approved scope count, number of exact-question deduplications, a sample AIRIA per-step advisory with evidence IDs, saved *inspector* answer/audit evidence, and a second user denied read of the same work order. Do not treat a mock response as a real agent judgement.
