# MOEI Smart Inspection — Capacity-First Inspection Plan (SI-01 → SI-S01 → SI-S02)

## Agreed business decision

**Inspectors, appointment times and selected candidate vessels must be planned
and approved together.** A supervisor no longer approves an unstaffed 20-vessel
roster that turns into 16 scheduled + four exceptions in a later step. That
capacity mismatch is addressed in the **DRAFT** before any regulatory plan
authorization.

### Proposed UI sequence

1. **Candidate Vessels:** manual or optional C01-assisted selection, with one
   entry per IMO and all NMC, Service Request and PSC source reasons retained.
   Candidates not selected remain eligible for a later plan and are not
   automatically interpreted as a cancelled legal inspection.
2. **Referral Evidence:** source facts, each statutory inspection regime,
   reference ID, case linkage, priority/rationale.
3. **Weights & Capacity:** four adjustable percentage sliders:
   `NMC_CASE:30`, `SERVICE_REQUEST:25`, `PSC_PORT_CALL:20`,
   `RISK_FACTOR:25` by default. Moving one automatically redistributes the
   others while ensuring an exact 100% sum. These weights produce an
   **advisory** source-risk explanation; assessed risk only is counted,
   missing risk stays unknown, and statutory/NMC priority is protected.
   Calculate verified inspector/shift/port/time capacity for **all** selected
   vessels BEFORE approval. POC overlay remains visibly synthetic.
4. **Unified Supervisor Approval:** select a complete feasible variant
   (optionally ranked by Airia SI-S01 under the existing untouched Airia
   request+response contract), inspect each inspector/date/port and travel
   exception, provide a written justification and explicit cross-port consent.
   Approve the statutory vessel roster and work orders in a **single**
   transaction, after rechecking the source revision and capacity hash.
5. **Issued Work Orders:** review staff assignments, prepare mandatory
   checklists, review optional A04 additions, authorize and start visits.

### Revised state model

```text
DRAFT / READY_FOR_APPROVAL
   |  C01 officer selection + published sources
   |  Capacity preview (no writes) + optional SI-S01 ranking
   |  Reject if any selected IMO has no feasible qualified assignment
   v
Single PUBLISHER approval (Oracle 018 + canonical PR124 019)
   |  exactly one approved IMO + appointment + inspector per vessel
   |  immutable source reasons and approval audit
   |  Oracle transaction COMMIT on success / ROLLBACK on any failure
   v
APPROVED + ISSUED_WORK_ORDERS
   |  no live ERP booking, case or dossier is implied
   v
Prepare checklist -> approve scope -> assigned inspector starts fieldwork
```

### Capacity assessment

The existing deterministic ERP-constrained scheduling solver checks:
inspector active status, all statutory regime/vessel-type qualifications,
port suitability, cross-port eligibility and travel time, weekday shifts,
approved leave, confirmed bookings, port access windows, per-day capacity
and conflicting inspector assignments. All real MSW/source-final ETA and
ETD values remain unchanged. If any selected vessel has no feasible option,
the **whole plan is not approvable**. The UI shows IMO-specific conflict and
capacity evidence and offers a navigation back to candidate selection.

External overtime is NOT assumed. HR must authorize an extra shift through
an independently governed mechanism before the planner treats it as
available verified workforce capacity. AI cannot invent an overtime permit,
certification or travel route. Cancellation/deferral of a statutory
inspection is never automatic; the existing officer disposition and legal
permissions control any such decision.

### API compatibility

Existing `/api/si/v1/maritime-scheduling/plans/:id/preview`,
`/ai-recommend` and `/approve` data contracts remain unchanged. The
old roster-only approval endpoint
`/api/si/v1/inspection-plans/:id/approve-for-scheduling`
now returns a clear `SI_CAPACITY_FIRST_PREVIEW_AND_APPROVAL_REQUIRED`
error to prevent a bypass in new plans.

Three plan-scoped additive APIs:
- `POST /api/si/v1/inspection-plans/:id/capacity-preview` —
  `{weights:{NMC_CASE,SERVICE_REQUEST,PSC_PORT_CALL,RISK_FACTOR},
  demoMode:true}`; returns a read-only `capacity` proposal with
  source/risk advisory, eligible assignments, rejected IMO diagnostics and
  `capacityHash`.
- `POST /api/si/v1/inspection-plans/:id/capacity-ai-recommend` — same weights,
  `demoMode`, `expectedCapacityHash`, `confirmRun`, `confirmCost`.
  Internally invokes the existing strict SI-S01 Airia ranking contract
  unchanged. MOCK ranking is clearly labelled zero-cost and **not real AI**.
- `POST /api/si/v1/inspection-plans/:id/approve-capacity` —
  `expectedRevision`, `expectedSourceHash`, `expectedCapacityHash`,
  `selectedOptionId`, same weights, `demoMode:true`,
  `confirmApproval:true`, `confirmCrossPort`, supervisor reason.
  Returns final plan plus the issued work orders; official ERP booking is false.

### Oracle data preservation and deployment

The implementation reuses existing, distinct migrations **018** and canonical
**PR124 019** only, with a single `SI_SCHED_MUTEX` row lock, optimistic plan
version check, concurrent inspector overlap check, freeze of approved
source evidence, and one transaction spanning `SI_PLAN_ROLLING*`,
`SI_SCHED_APPROVAL`, `SI_SCHED_WORK_ORDER` and both audit tables.
It never runs or combines the **incompatible PR125 019**.

- An Oracle schema already containing the canonical 019 and its prerequisites
  is required for new unified approval. JSON-mode approval intentionally
  fails closed; it cannot guarantee atomic commits across independent files.
- Read-only capacity preview never changes NMC cases, source feeds, Excel,
  statutory plan rows, inspector bookings, or checklist dossiers.
- No reset, `docker compose down -v`, source deletion, or destructive DDL.
- Prior approved plans are not rewritten.
- CI Node + Angular + Docker must pass. Local authenticated PUBLISHER
  approval UAT and actual Oracle concurrency/rollback verification are still
  required before calling the workflow deployed or ministry-ready.

### Suggested local verification (Windows PowerShell)

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch --track origin/feature/si-capacity-first-approved-plan-weights-20261014
$dc = @("-f","compose.yaml","-f","compose.oracle.yaml",
         "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc run --rm --no-deps ai-proxy node tools/check-si-schedule-oracle.mjs
# Proceed to restart only if the database verification says READY,
# mounts/secrets are valid and Oracle backup has been verified.
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-capacity-plan.test.mjs test/si-capacity-plan-approval.test.mjs
```

Open Candidate & Targeting -> create/select a DRAFT plan -> Review & Approve
Rolling Plan -> Step 3 `Source Weights & Capacity` -> Step 4
`Unified Plan Approval` -> issued work orders.
