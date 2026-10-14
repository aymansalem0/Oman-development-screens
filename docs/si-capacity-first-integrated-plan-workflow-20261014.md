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
2. Two **independent percentage selection factors**, not percentage weights:
   (a) PSC + Risk Factor: percentage of the DISTINCT eligible PSC-vessel IMO
       candidate pool; saved NMC vessel-risk score only ranks PSC choices,
       with unassessed risk preserved as missing. This planning factor never
       changes the published PSC Excel monthly quota measured in port-call
       EVENTS.
   (b) UAE-flagged vessels: a separate percentage of the DISTINCT eligible
       UAE-flagged IMO candidate pool, regardless of PSC membership. Flag must
       be source-supported, never inferred from a UAE port call.
   There is no combined 100% total. Each target uses
   floor(eligible_own_pool * own_rate_percent / 100).
   The resulting sets are combined by unique IMO, and overlap is shown.
   NMC mandatory referrals and legally required service inspections remain
   outside optional percentage selection and cannot be erased by a quota.
   Both controls are *planning selection* inputs and must never mutate the
   official NMC risk-engine factor weights or statutory inspection obligations.
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
Both independent PSC+risk and UAE-flag percentage sliders are **draft UI
controls only**. They calculate live source-backed, IMO-deduplicated eligible
pool sizes and selected count previews using the existing candidate dashboard
and a side-effect-free quota projection. They are not persisted or used to
commit candidate decisions, and do not yet change approval behavior. The integrated
capacity-first optimizer, Oracle transaction, AI adapter, and final
five-stage wizard remain pending implementation and tests. Do not deploy
this branch as if it has the complete integrated workflow.
