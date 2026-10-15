# Smart Inspection — Automatic C01 Selection → Priority → Inspector Capacity → Final Draft

## Confirmed operator requirement
After one explicit `Generate Candidates + Priority + Capacity` action:
1. C01 reviews all source-eligible candidate workflows; its source-verifiable `SELECT_RECOMMENDED` outcomes plus genuinely protected regulatory referrals produce the **initial shortlist** under *published* PSC/UAE/service and overall plan caps. No rejected/deferred or unverified C01 candidate is silently promoted.
2. The shortlist is ranked automatically using the **agreed execution priority policy**: verified future ETD first; subsequently human-reviewed active incident severity. Vessel risk is not execution rank. The result is transmitted as one ordered roster into the capacity engine without another click.
3. Calculate feasible visits from vessel **ETA/verified berthing → final ETD**, intersecting the Execution Plan period and qualified inspector shifts, leave, port, travel and bookings. Among equally feasible maximum-coverage schedules, prefer higher execution priority.
4. The **final Draft** contains ONLY vessels with qualified proposed inspector assignment. Optional selected vessels that cannot be fitted get `OUTSIDE_CURRENT_DRAFT_CAPACITY` with source IMO, original priority, and blocking reason. Their source records remain in the central Candidate Pool for later plans.
5. Mandatory source-approved **NMC referrals** without capacity stay visible as protected unresolved exceptions and prevent Ready for Approval. Nothing automatically rejects or reschedules an approved regulatory referral.
6. Saving writes the source-bound selection, ranked preliminary roster, feasible selected IMOs and excluded reasons in the initial Oracle plan/audit transaction; it does not create work orders or official ERP bookings. Supervisor approval is a separate explicit, server-revalidated action and cannot silently re-add previously excluded vessels.

## UAT example — capacity constrained
- 99 source-eligible physical IMO vessels, 112 source/regime candidates.
- **Example only**: C01 recommends 5 vessels within the published quota.
- Priority order: #1,#2,#3,#4,#5 according to saved ETD/incidents; not generated risk scores.
- The deterministic solver has feasible slots for three: #1,#2,#4 (availability and qualifications permitting).
- Preview: `AI Selected=5`, `Prioritized=5`, `Inside Final Draft=3`, `Outside Draft=2`; both excluded IMOs show exact capacity reason and remain in Candidate Pool.
- Saving and reopening shows `Planned Vessels=3`; optional overflow is audit-visible, not silently marked 'included'.
- If a mandatory NMC referral has no feasible assignment: DRAFT exception, **not Ready for Approval**.

## What this change does NOT do
- It does not force C01 to fill quota if its validated output recommends only one vessel. Inspect the C01 response and source eligibility if the customer still sees one selected.
- It does not fabricate vessel ETA, berthing, verified ETD, regulatory obligations or staff qualifications.
- It does not make an unreviewed AI judgement the official execution priority, automatically approve a plan, issue work orders or create a live ERP booking.
- It does not automatically create a second/overflow plan.

## Test / support
New `ai-proxy/test/si-auto-draft-pipeline.test.mjs` checks step ordering, final roster vs capacity overflow, protected NMC exceptions, and fail-closed source/solver mismatches.
Added a competing-vessels single-engineer test to `si-maritime-batch-scheduling.test.mjs`.
Run (no Oracle reset):
```powershell
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```
Do not recreate the ai-proxy container while a C01 analysis is active. Runtime UAT against the actual Oracle, current saved ERP, and Airia is required in addition to tests.
