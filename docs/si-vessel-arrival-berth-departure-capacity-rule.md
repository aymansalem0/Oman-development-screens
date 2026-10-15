# Smart Inspection — ETA / Confirmed Berth / ETD scheduling window

## Business acceptance
An inspection may begin only while the vessel is physically available. Use **verified ETA** as the earliest possible date when berth/site access is confirmed. Where an officer has **actual verified berthing time**, begin no earlier than that timestamp. **ETD is the latest allowed *completion* time, not the earliest or preferred start time**. A plan Execution From/To is an additional constraint.

Effective proposed appointment window (UAE local time, UTC+04):
- `availableFrom = max(source ETA, officer-confirmed berth time (if provided), execution plan first day, current time)`;
- `availableUntil = min(source-final ETD, midnight immediately after the last execution plan day)`.
- An inspection is feasible only if a **qualified** engineer's available shift, port access, travel, leave and existing bookings allow the **entire inspection duration** within these bounds.

Important distinction: If a ship arrives on October 20 and departs on October 23, it remains eligible for an October 21–22 execution plan when staff and site access are available. The planner must **search between ETA and ETD** for a feasible engineer slot; not pick an ETD-based visit automatically and fail approval later.

## Berthing evidence
- Current Excel/POC MSW sources provide ETA and ETD; **berth timestamp is not guaranteed**.
- A new optional **berthAtLocal** can be supplied by an officer, together with `berthConfirmed=true`, confirmed berth/site access and a berth movement evidence reference. In live mode it must be no earlier than verified ETA and earlier than source-final ETD.
- Neither berth input nor synthetic POC data rewrites original source ETA/ETD.
- Operational MSW arrival/departure may supply timing to a genuine NMC referral, without fabricating a PSC trigger.

## Backend implementation
- `maritimePlanSchedulingContext`: select verified ETA/ETD from the same port call, if possible, and expose officer berth fields.
- `validateOperatorScheduleAgainstSource`: forbid client mutation of final ETA/ETD and require evidence for reported berth; reject berth outside source window.
- `boundMaritimeVesselWindow` **runs before** `scheduler.buildOptions` and clips its search window to plan dates, ETA/berth and final departure. This fixes a historical false negative in which a limited first set of slots before the Execution From date was discarded after option generation.
- After option generation, `proposeMaritimeBatchSchedule` also verifies each start/end against the clipped interval, even if an external option provider returns incorrect slots.
- Calculated `visitWindow.feasibleFromLocal` and `feasibleUntilLocal` are visible in the integrated Draft Preview.
- Official bookings and work orders are *not* created by the draft calculation. Supervisor must explicitly approve a freshly revalidated plan.

## UAT examples (2026)
1. ETA Oct 20 06:00, ETD Oct 23 22:00, plan Oct 21–22: preview offers qualified engineer visit on Oct 21 or 22 if available.
2. Same trip, officer confirms berth Oct 22 12:00: no options before Oct 22 12:00; ETD still unchanged.
3. ETA Oct 13, ETD Oct 20, plan Oct 16–19: existing in-port vessel can still be inspected.
4. ETA Oct 24, plan ends Oct 22: inclusion blocked as an outside-plan source conflict.
5. Inspection Oct 23 after plan ends Oct 22: schedule rejected.
6. Any visit whose end exceeds final ETD: rejected even if its start was before ETD.
7. Missing final ETD, unverified berth or invalid evidence: capacity blocker rather than a fabricated official date.
8. POC demo synthetic date is **not inferred by subtracting time from ETD** and remains clearly labelled synthetic.

## Validation
Node regressions in `si-maritime-batch-scheduling.test.mjs` and `si-maritime-plan-source.test.mjs`. The exact end-to-end Oracle/ERP/Airia integration must be validated in the live POC environment before merge.
