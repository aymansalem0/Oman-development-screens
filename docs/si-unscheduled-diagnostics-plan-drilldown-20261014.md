# MOEI Smart Inspection: unscheduled vessel reasons returned in its plan

## Requested business flow

A vessel row such as **IMO 9400796** must not display only
`GLOBAL_PLAN_CONFLICT_OR_CAPACITY` without sufficient decision support.
The official, immutable inspection plan remains the source of the selected
vessel list and referral reasons. The electronic scheduling **plan board**
should explain the *planning-stage* failure and let a coordinator open that
vessel's **source-backed approved-plan details** without modifying its approval.

## Scheduling preview response

The existing read-only `POST .../maritime-scheduling/plans/:id/preview`
adds `diagnostics` per UNSCHEDULED row, with the same object exposed in
`proposal.board.unscheduled`:

- `code` and `category`: original source reason, eligibility issue,
  `PLAN_RESOURCE_CONTENTION`, or `OPTIMIZER_SEARCH_LIMIT`.
- Candidate options and distinct inspector counts **actually considered by
  this bounded solver** (not counts of all theoretically possible resources).
- Option counts conflicting with already selected inspector visit times,
  cross-port travel constraints, and per-engineer daily capacity.
- The conflicting allocated IMO/engineer/start/end/port entries (limited
  to 10); excluded inspector IDs and ERP reason codes (limited to 20).
- Original scheduling input visit window, port, duration, required scopes;
  next-action hint. No HR personal absence explanations or raw imported
  spreadsheets are returned.
- If an option can still fit the selected plan but beam search did not keep
  it, show `HEURISTIC_SEARCH_LEFT_AVAILABLE_OPTION` instead of asserting a
  real ERP shortage. The solver is heuristic, and 10 choices per vessel
  cannot prove global infeasibility.

These data are recomputed with each fresh preview, and are **not** written
back to the immutable ministry-approved plan, Oracle, the ERP workbook,
NMC case state, or individual inspector bookings.

## UI

1. On the Electronic Inspection Scheduling board, UNCHEDULED rows display
   a localized business explanation alongside the code.
2. `عرض أسباب التعذر في الخطة` opens an expandable per-IMO panel in that
   same approved plan's scheduling context.
3. The panel identifies port, visit window, scopes, actual excluded inspector
   reasons, selected assignments that compete for capacity or times, and the
   fact that this is a bounded/heuristic advisory preview.
4. `فتح تفاصيل السفينة في خطة المعاينات المعتمدة` links to the existing
   `/moei/smart-inspection/plan/create/:planId?imo=9400796&origin=scheduling`
   screen. That source-plan view highlights the target IMO and shows the
   authoritative, source-backed inspection inclusion reasons read-only.
   These *source referral reasons* must not be confused with a *scheduling
   exception*; use the scheduling board for conflict evidence.
5. Back-to-scheduling navigation is available. Recalculate invalidates the
   previous diagnosis and produces a fresh proposal.

## Safety and test expectations

- **No automatic exclusion/removal of unscheduled vessels**. They remain in
  the approved plan and in the 20-row preview exactly once per IMO.
- No approval, booking, case or dossier is created by generating diagnostics.
- Source-verified ETA/ETD, inspection port and statutory scope are not changed.
- Missing source facts cannot be invented; an unavailable travel route,
  absent certification, closed NMC referral or impossible shift remains a
  genuine exception.
- The old error code is retained for backwards compatibility while a more
  explanatory diagnosis is displayed.
- Unit tests cover competing IMO, constrained capacity, qualified option left
  by the bounded optimizer, and missing source validation.

## Validation

GitHub Actions: Angular Build and NMC Docker POC validation. CI result must
be checked after the PR is created. Local Oracle UAT is still required.
No new Oracle migrations.
