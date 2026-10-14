# MOEI Smart Inspection — capacity-first integrated inspection plan (approved business direction)

## Decision
A ministry supervisor must approve **one coherent plan** consisting of
selected source-backed candidate vessels **and** their validated inspectors,
ports, start/end times, travel and capacity reservations. Only after that
approval may the system issue work orders. The old two-approval model
(roster approval, then independent schedule approval) is to be retired
after the integrated implementation is verified.

## Planning wizard
1. Candidate vessel source snapshot and statutory/mandatory flags.
2. Candidate source contribution preferences: NMC referrals, PSC port calls,
   maritime service requests, and a saved NMC vessel-risk factor.
   Provide accessible percentage sliders and a total that must equal 100.
   The sliders are *planning prioritization* inputs, **not** official NMC
   risk-engine configuration or automatic legal exclusion criteria.
3. Read real ERP inspector rosters, qualifications, shifts, leave, port
   affiliations, approved travel matrix, capacity and available vessel
   visit windows. Missing evidence is a named exception.
4. SI-S01/Airia proposes alternative fully evaluated plans, balancing
   statutory obligations, priority, and feasible resources. It can suggest
   cross-port inspectors or out-of-hours shifts, but unapproved overtime
   must remain **conditional**, never silently treated as confirmed capacity.
   Cancellation/deferral requires an explicitly documented legal permission
   and authorized human decision; missing authorization is a hard stop.
5. Supervisor reviews the full vessel + inspector + visit allocation,
   exception decisions, source provenance and versioned snapshot, and
   approves it **atomically**. Work orders are issued idempotently only
   for the approved assignments. Keep immutable plan revision and audit
   history; no work orders for merely proposed overtime or unresolved
   mandatory vessels.

## Integration requirements
- Keep the existing SI-S01 Airia request/response schema unchanged.
- Adapt data inside the server; do not add unadvertised fields to the
  external AI contract or invent AI evidence.
- Introduce a server-side, versioned planning draft/config and a
  transactionally validated approval command, then migrate Angular
  to it. Keep old APIs functional until the replacement passes UAT.
- Preserve the canonical Oracle migration 019 from PR #124; do not
  execute the competing 019 from PR #125.
- Verify plan revision, capacity snapshot, conflicting bookings and
  candidate source hashes again at approval time.
- Handle concurrency with Oracle transaction locking and unique
  plan/IMO work-order constraints; do not create duplicate assignments.
- Existing approved plans are grandfathered/read-only; do not reinterpret
  historical approvals as integrated ones.

## Implementation status in this branch
The candidate source/risk weight sliders are **UI draft controls only**,
with visible 100% validation feedback. They are not persisted or used to
score candidates, and do not yet change approval behavior. The integrated
capacity-first optimizer, Oracle transaction, AI adapter, and final
five-stage wizard remain pending implementation and tests. Do not deploy
this branch as if it has the complete integrated workflow.
