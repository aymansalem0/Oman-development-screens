# MOEI Smart Inspection — Remaining POC Implementation Matrix

**Reviewed:** 2026-10-14. **Working integration branch:** `feature/si-scheduling-board-v2-20261014` (Draft PR #114, stacked on #113). This file is an implementation tracking note, **not** a statement that all eight capabilities have been delivered.

| # | Capability | Existing grounded implementation | Outstanding acceptance criteria | State |
|---|---|---|---|---|
| 1 | AI Scheduling Board | V2 approved-plan read-only constraint solver + now engineer/day/vessel board, ERP roster, unscheduled reasons | Real SI-S01 advice grounded in verified schedule and ERP evidence; operator preview across plan without implying AI has booked anybody | PARTIAL — PR #114 board |
| 2 | Whole Schedule Approval | Source-final ETD preserved; plan roster approval exists independently | Authorized supervisor revises slot assignment, approves full schedule revision once; rechecks time windows, qualifications, leaves, capacity, port access, conflicts and saved plan NMC refs; prevents double-confirm/replay | NOT IMPLEMENTED |
| 3 | Automatic Inspection Dossier | Existing SI-02 case preparation and optional A04 work after an approved SI case | Generate one case-scoped dossier per newly approved/confirmed scheduled vessel; preserve every source reason and regime; idempotent, traceable and only after schedule approval | PARTIAL / NOT ATTACHED TO SCHEDULING |
| 4 | My Assigned Inspections | Approved-case lifecycle and manual assignment modules exist | Authenticated engineer sees their actual confirmed assignments; filtered by authoritative authenticated identity / ERP ID, not arbitrary typed name; status, start, checklists, read-only other engineers | NOT IMPLEMENTED |
| 5 | AI Checklist Preparation | Oracle 017 dynamic checklists, mandatory baseline, SI-A04 optional dossier suggestions | Resolve mandatory templates from vessel/regime/referral sources at scheduled-case creation, preserve immutable published revision, put A04 suggestions in human review queue and log acceptance | PARTIAL |
| 6 | AI-Assisted Execution | Dynamic field checklist evidence and optional V01; report / CAPA assistants have guarded entry points | From **saved** image or text evidence per item, AI suggests answer/observation/deficiency/action; inspector accepts/edits/rejects; never silently issues statutory findings or closes checklist | PARTIAL |
| 7 | NMC Closure Integration | NMC ↔ SI referral and status controls partly implemented | After approved final report and CAPA/follow-up, send idempotent inspection outcome and evidence links to originating NMC case; notify its owner; keep NMC case open until responsible officer decision; don't rewrite statutory risk without rule-gated reassessment | NOT IMPLEMENTED END TO END |
| 8 | End-to-End Tests | Component, backend, Oracle and CI regression tests exist | Role and data-driven E2E: approve plan → prepare board → supervisor schedule approval → unique case/dossier → assignment visibility → checklist/V01 → approved report/CAPA → NMC notification; include stale plan, conflict, duplicate booking, leave, missing ETD, permissions and retries | PARTIAL |

## Sequence and gating

1. **#1 Board** (PR #114) is read-only, grounded in saved ERP POC snapshot and approved vessel roster. It groups the same proposed appointments by engineer, UAE day and vessel. No paid Airia calls or transactional side effects.
2. **#2 Approval** is the next transactional milestone, and **must be designed together with #3** to prevent an approved slot without the associated case / dossier. Existing plan-approval action creates the roster only, not inspection cases.
3. **#4 Engineer workspace** relies on committed assignment rows + authenticated ERP personnel mapping; no employee name free-text identity.
4. **#5–6** leverage existing Oracle dynamic checklists and image evidence controls, extending only missing verified data/UX and human review hooks.
5. **#7** sends a reviewable outcome to NMC; **SI closure never auto-closes the NMC case**.
6. **#8** cross-service E2E runs after the write-side contract is frozen. It must cover no-MOCK fallback in real Airia mode.

## Database migration decision

- **PR #114: NONE** — all preview and grouped board data are projections; no tables, indexes, seed writes or columns changed.
- Before item #2 is implemented, prepare an **additive, backup-gated Oracle 019 migration** (after existing Oracle 017/018), reviewed against live schema and existing SI/NMC rows. Likely data entities: versioned whole-plan scheduling approval, confirmed inspector assignments / uniqueness and idempotency, approval audit, case/dossier linkage and transactional outbox for NMC notification. The actual DDL must be generated against the reviewed persistence model and never blindly applied.
- Never issue DROP, TRUNCATE, or `docker compose down -v`. New outbound NMC actions require idempotency and an operator-controlled success/failed status, not fire-and-forget.
- For approved cases already created via legacy routes, preserve original IDs and audit, and reconcile before attaching new V2 schedule IDs.

## Essential acceptance checks for the preview board

- Exactly one proposed row per approved vessel IMO.
- UAE local dates, engineer display name, site / port and slot display are identical across all board views.
- Unscheduled vessels have traceable blocker codes; cannot disappear on a view switch.
- A modified berth, ETA/ETD-free operator input or duration immediately invalidates the stale proposal.
- No HR phone/leave notes or secrets in the workforce projection; only active staff, regime qualifications and capacity.
- Board viewing / preview causes **zero** new inspection cases, bookings, dossiers, NMC mutations or Airia calls.
