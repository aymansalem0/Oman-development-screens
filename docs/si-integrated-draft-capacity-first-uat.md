# SI Integrated Draft Creation — Candidate + Priority + Qualified Engineer Capacity

## Business rule
An operator must inspect a **single, unified** vessel selection, statutory execution priority, qualified inspector assignment and source-backed visit feasibility **during Create New Plan, before saving the first DRAFT**. Airia SI-C01 is optional advisory and needs explicit cost consent; final authorization always belongs to the Supervisor.

## From Candidate Center
1. Open `/moei/smart-inspection/candidates` and select **Create New Plan**.
2. Enter title, execution period and notes. Default POC period starts tomorrow and spans seven days so demo synthetic visits are not automatically outside the plan.
3. Choose explicit **POC synthetic workforce** or the existing saved ERP workforce. The demo data is not an official source and never changes the imported Excel.
4. Confirm C01 analysis and, if Airia is active, confirm **all expected batch costs**. No calls happen merely by opening the Create form.
5. Press **Generate Candidates + Priority + Capacity**. The backend runs C01 once against the current authoritative candidate snapshot, validates source IDs/AI fields, applies the published PSC/UAE/service selection policy, derives execution priority from verified future ETD then human-reviewed incident severity, and solves qualified inspectors/ports/available visit slots.
6. Inspect the combined priority/inspector/slot/capacity table. Mandatory NMC referrals are not silently excluded; optional candidates outside available resources remain in the central candidate pool.
7. In non-demo mode, correct only non-final visit site/port/window data and press **Recalculate Capacity**; this has **zero new Airia C01 calls** and does not save or approve the plan.
8. Press **Save Complete Integrated DRAFT**. The backend rechecks the authoritative source hash, C01 selection, published policy and current ERP/current bookings; if hashes diverge, it fails with a stale-preview code. Otherwise it saves the roster, all reasons, priorities, proposed engineer assignment and exception set in the initial Oracle rolling-plan transaction. No work orders or ERP bookings yet.
9. Supervisor approval later uses the existing capacity wizard and revalidates live source/ERP. Publisher role and an approval reason are required before canonical work orders can be issued.

## Operational protections
- **No source fabrication:** unverified service requests/PSC port calls cannot become inspection candidates; AI recommendations cite original allowed evidence only.
- **No invented capacity:** source-final ETA/ETD and source port are immutable; source-empty non-demo windows are UNSCHEDULED until completed by the officer.
- **No hidden loss:** the technical 40-vessel solver limit is not applied by truncating mandatory or optional approved source events. Over-limit requires explicit business scoping / additional separately supervised plan(s).
- **No paid auto-retry:** preview is an explicit request; recalculation and saving use cached validated C01 results and make no further Airia calls.
- **Preview is ephemeral:** session-bound (30 minutes), one process only. Server restart/expiry requires a newly confirmed C01 run, and the operator must consent to any external cost.
- **No official reservation on Draft:** capacity allocations are proposed, not HR/ERP bookings or regulatory inspector sign-offs.

## UAT checklist
- [ ] Create form exposes candidate selection, priority and capacity as one **pre-save** action.
- [ ] Airia vs MOCK provider is visible and paid batch count confirmed.
- [ ] A successful demo preview shows candidate count, C01 selected count, feasible assigned count, unscheduled count and per-vessel engineer/visit; synthetic provenance is conspicuous.
- [ ] Real-mode missing ETD/berth/site access produces blocking capacity reason rather than invented values.
- [ ] Recalculation changes the proposed slots but does not re-run C01 or save.
- [ ] Save restores a new rolling plan with an initial saved C01 result, capacityDraft proposed assignments and source evidence at revision 0.
- [ ] Expired preview or different signed-in session is rejected.
- [ ] Source/ERP change before Save rejects stale hash; no orphan plan is created.
- [ ] Protected NMC referral without a qualified engineer cannot be approved.
- [ ] Existing plan approvals/work orders, Oracle migrations 018/019, NMC AI flows and Airia key privacy remain unaffected.

## Current validation
New tests: `ai-proxy/test/si-integrated-draft-creation.test.mjs`. Production-like UAT must exercise real customer's Oracle 018/019, saved ERP Excel and Airia pipelines. These connections are **not** proven by an Angular or Docker CI build alone.
