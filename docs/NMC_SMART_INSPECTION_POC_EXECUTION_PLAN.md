# MOEI NMC Smart Inspection POC — Electronic Scheduling & A04 Execution Plan
**Working baseline:** 10 Oct 2026 · **Implementation branch:** `feature/nmc-smart-inspection-scheduling-poc-v1` (stacked on PR #45; do not merge until parent accepted).  
**Business reference:** `MOEI_NMC_POC_AI_Business_Scenario_and_Integration_Specification_v3.1` (07 Oct 2026).  
**Scope:** POC, not a ministry production inspection service. Source fleet = 420 synthetic/deterministic vessels; AI data is never a regulatory decision. SLA management/escalation excluded.

## 1. Clear distinction: currently available versus still to build

| Capability | Pre-existing in PR45 | This branch (first increment) | Later POC milestone |
| --- | --- | --- | --- |
| Service / foreign PSC / NMC inspection candidates | Synthetic targeting source catalogue | Not modified | Unified operational scheduling intake |
| Real NMC referral from A01 | Human-accepted PRIORITY_INSPECTION → Oracle-persisted case referral | Reused | More intake source types |
| Electronic scheduling | Future datetime + free-text port/inspector; no capacity check | Inspector overlap check, duration/end, availability API, live schedule & counters | Capacity calendar, holidays, work shifts, reassignment, cancellations |
| Inspection checklist | Eight core checklist areas, manual Pass/Deficiency/N/A, result persisted in NMC Case | Unchanged | A04 dossier overlay + inspector evidence upload |
| A04 Smart Inspection Agent | NOT live | NOT invoked (no new AI charges) | Dossier, evidence analysis, report draft |
| A02 evidence refresh / revised risk | Pending; source risk immutable | Still pending | New evidence-linked A02 snapshot + deterministic score |
| A01 post-inspection reassessment & closure | Closure blocked if result lacks reassessment | Still pending | Post-action A01 recommendation, human closure |
| Google Drive synthetic document pack | Scope defined; 10 pilot folders, first complete 10-PDF vessel in v3.1 | Not touched | Pilot 10, then expand/validate 420 |
| Oracle central Risk Settings | Versioned tables exist in user's environment; local GET returned 503 | Not altered | Fix readiness, verify publication and full-screen consistency |

**Important:** The three inspection candidate sources in the existing UI are not three real booking workflows. This first scheduling increment operates **only on centrally saved NMC case referrals**. Do not present synthetic Service Request/PSC candidate counts as booked appointments.

## 2. Electronic Scheduling — POC business lifecycle

1. **Intake and eligibility.** Service Request / PSC / NMC Case candidate is identified. POC Phase S1 books only an NMC Case referral approved by a human officer after real A01 proposed action review.
2. **Scheduling Queue.** Coordinator sees source case, IMO, priority, evidence IDs, source risk, requested regime and status `PENDING_SCHEDULING`.
3. **Slot proposal.** Coordinator enters local date/time, port and inspector/team, and selects 30–240-minute duration.
4. **Availability preview.** `GET /api/ai/inspection-schedule/availability` detects an overlapping `SCHEDULED` appointment for the **same normalized inspector/team**, even if port differs. No AI calls.
5. **Confirm reservation.** `POST /api/ai/cases/:id/inspections/:referralId/schedule` validates/serializes in a single POC Node process, rechecks slot availability, case version and referral status, records UTC start/end, role and audit. Duplicate booking returns 409.
6. **Electronic schedule.** The board displays upcoming/scheduled, elapsed but not completed, completed and pending; scheduled tasks remain visible after refresh and in case audit.
7. **Assignment and field execution.** Inspector navigates to Smart Inspection, completes mandatory checklist; results cannot be submitted until the matching referral is SCHEDULED.
8. **Completion.** Persist inspected findings and mark the referral COMPLETED; **do not automatically lower source risk**.
9. **Verified reassessment.** Future milestone: A02 re-evaluates only changed evidence, deterministic rules re-score, A01 interprets impact, supervisor resolves case if justified.

**Current deliberate exclusions:** real inspector roster/shift roster, resource calendars, public customer booking, appointment SMS/email, physical port constraints, multi-node transaction-level slot locks, cancellation/reschedule with reasons. Until dedicated DB constraints/service exist, single-instance slot serialization is **not** a guarantee against conflicting schedules from multiple backend replicas. Never market it as production-grade capacity booking.

### Current POC appointment DTO additions
`scheduledAt` (UTC ISO), `scheduledEndAt` (UTC ISO), `durationMinutes`, `port`, `inspector`, `scheduledBy`. Stored with case `DOC_JSON` and versioned `NMC_CASE_AUDIT`, no new Oracle migration in this increment. Existing pre-upgrade appointments fall back to a 60-minute duration for overlap computations; no historical record is rewritten.

### Electronic scheduling acceptance tests
- SCHED-01: Authorized coordinator can schedule an approved NMC A01 inspection only; synthetic candidates don't materialize bookings.
- SCHED-02: 60 and 120-minute UTC bookings survive API refresh, preserve IMO/case provenance.
- SCHED-03: Two concurrent overlapping bookings with the same inspector (different ports) → exactly one success, one 409.
- SCHED-04: Different inspector or non-overlapping interval → accepted; repeated scheduling of one referral → 409.
- SCHED-05: Past dates, missing port/inspector, duration outside defined options → fail; original saved AI risk unchanged.
- SCHED-06: Queue shows PENDING / SCHEDULED / COMPLETED and the audit has `INSPECTION_SCHEDULED`.
- SCHED-07: No Airia invocation for viewing calendar, availability or confirming appointment.
- SCHED-08: More than one API process must **not** be accepted as safe without central Oracle locking/capacity table.

## 3. Smart Inspection AI POC, complete target flow

| Phase | Human / project action | AI action | Persistence / authority | Exit acceptance |
| --- | --- | --- | --- | --- |
| SI-00 | Operator chooses any of 420 synthetic vessels; assemble vessel context | None | IMO-bound bundle, source provenance | Correct IMO shown; no hard-coded Gulf Horizon |
| SI-01 | NMC alert acknowledged; officer creates case | **A01** situation assessment proposals on explicit Create | Immutable source assessment; case shell/plan; no auto tasks | Evidence-linked proposed actions |
| SI-02 | Officer accepts/rejects/modifies actions | None | Oracle case audit; approved action materializes task | Rejected actions create no task |
| SI-03 | Coordinator allocates inspection | None | Electronic schedule and inspector assignment | SCHED tests pass |
| SI-04 | Inspector opens scheduled visit and reviews dossiers | **A04** PRE_INSPECTION_DOSSIER (explicit trigger) | Versioned overlay on existing eight checklist IDs; source refs | Mandatory checklist preserved; provenance present |
| SI-05 | Inspector records Pass / Deficiency / N/A, severity, notes, photo/PDF | **A04** EVIDENCE_ANALYSIS only on explicitly chosen evidence | Candidate finding not accepted until inspector confirmation | No AI-generated official deficiency |
| SI-06 | Inspector requests first draft | **A04** REPORT_DRAFT using confirmed findings only | Draft review + human sign-off; no invented findings | Submitted inspection result verifiable |
| SI-07 | Project refreshes post-inspection evidence | **A02** compliance refresh (A03 only for changed PDF when needed) | New saved signals; no rewrite of original assessment | Source version and changed evidence IDs identifiable |
| SI-08 | Deterministic risk engine scores new signal set | No LLM for numerical score | Separate assessment/revision, old score remains intact | Reproducible 5-factor calculation |
| SI-09 | Duty officer requests post-action interpretation | **A01** post-action reassessment | Evidence-linked advisory, no automated enforcement | What changed and next step explained |
| SI-10 | Supervisor closes / monitors case | None | Case history + resolution note | Closure blocked until mandatory requirements met |

### Evidence and AI constraints
- A01/A02 signals: movement, inspection, certificate, dataQuality, history; severity 0–100, confidence, evidence IDs. Official score is deterministic.
- A04 dossier: focus areas, predicted concerns, `checklistFocus.existingItemId` limited to the eight existing IDs; must never replace mandatory inspection sections.
- A04 evidence analysis: photo/voice/PDF becomes a *candidate* finding with `requiresInspectorConfirmation=true`; inspector records final legal observation.
- A04 report: derived only from confirmed checklist and findings. Cannot declare risk reduction such as a fake “-18 points.”
- Pilot document source: dedicated read-only scoped Google Drive POC folder `MOEI-NMC-POC`. Credential remains backend-only, never in Angular or Airia payload.
- A03 handles actual file extraction/validation only when requested; absent or conflicting files yield `INSUFFICIENT_EVIDENCE`.
- No autonomous paid AI rerun for 420 vessels. Manual A04 and post-inspection refresh require visible user triggers, validation and billable-call review.

## 4. Implementation work packages and checkpoints

| Package | Order / effort estimate | Actual start state | Deliverables | Gate |
| --- | --- | --- | --- | --- |
| **S0 — Baseline & Safety** | First · 1–2 dev days | Pending local | Resolve local risk-policy 503, verify 005/006/007, establish baseline counts/scheduler false; Oracle backup | Health + central policy GET 200; existing data unchanged |
| **S1 — Electronic Scheduling Foundation** | 2–3 dev days | **Started on this branch** | Time-window validation/availability; collision-safe local single-instance submit; board, DTO, tests | Unit/CI + local Oracle two-referral acceptance |
| **S2 — Full coordinator workbench** | 3–5 dev days | Not started | Inspector roster, shifts, port calendar, slot suggestions, reschedule/cancel, explicit notifications, distributed Oracle locks | Cross-case scheduling, conflicts, audit, permission checks |
| **S3 — A04 Pre-inspection** | 3–5 dev days (AI team dependent) | Not started | Dossier contract + Airia integration, A03/Drive select-document tool, checklist focus overlay | Validated actual A04 response for pilot IMO |
| **S4 — Inspector field execution** | 4–6 dev days | Checklist exists; AI incomplete | Persistent per-check item notes/evidence; candidate finding review; report draft + sign-off | No unconfirmed official findings, refresh/reopen survives |
| **S5 — Post-inspection** | 4–6 dev days | Not started | A02 refresh → official deterministic recalculation → A01 reassessment → case resolution rules | Immutable before/after assessments + audit |
| **S6 — Pilot evidence & acceptance** | 4–6 dev days, some parallel | Partial Drive pilot described | 10 varying IMOs covering 4 risk bands; Google Drive content fetch; negative/security tests; expand toward 420 as ready | Signed end-to-end UAT, no hard-coded vessel |

**Effort is indicative**, not a committed delivery date. S0 blocks local end-to-end demos. S2's inspector calendars and database-level locks should be done before anyone calls this a general appointment scheduling service. SI integration depends on actual Airia pipelines, stable A03/A04 schemas and the approved Drive document connector.

## 5. UAT demo scripts (what MOEI should see)

**D1 — Routine:** normal-risk vessel; no invented critical reason; inspector queue remains unchanged without human decision.

**D2 — Risk to inspection:** saved High/Critical or independently critical-open-finding A01/A02 evaluation → NMC alert → acknowledgement → case → real A01 action recommendations → supervisor/officer acceptance → dedicated scheduling queue → availability → confirmed appointment → assigned Smart Inspection. Verify source AI score has not changed.

**D3 — Same inspector clash:** two approved requests, overlapping slots/different ports, second blocked; change to free inspector to confirm. Refresh browser: both requests and audit remain.

**D4 — A04 AI overlay (future):** scheduled inspector requests pre-inspection dossier → existing eight checklist items highlighted, not replaced → evidence file inspected by A03/A04 → inspector approves finding → AI report draft → human signs.

**D5 — Safe reassessment (future):** confirmed deficiency resolution → A02 refreshed signals → deterministic new score → A01 post-action recommendation → human closes case. Neither policy edits nor physical inspection alone is allowed to silently overwrite the historic saved score.

**D6 — Security/degradation:** Airia down means no invented actions/dossier. Missing Drive file is explicit. Unassessed vessel remains unassessed. Local Risk Policy 503 must be resolved before claiming policy-wide recalculation.

## 6. Safety, deployment and verification for this first increment
- Code exists only on a **new stacked feature branch**. Never merge PR45, reset data or run migrations as a side effect of this branch.
- **No Oracle schema or data changes have been executed remotely**. `NMC_CASE.DOC_JSON` is extended only when a human confirms a new schedule.
- Backend CI / Angular CI validate code only; **local Oracle end-to-end validation remains a separate mandatory step**.
- Keep `NMC_FLEET_AUTO_ENABLED=false` in the **actual Docker Compose environment**, not just PowerShell process memory. Confirm inside container before restart.
- From a clean worktree and after S0: `docker compose $compose build ai-proxy nmc`, check success, `docker compose $compose up -d --no-deps --force-recreate ai-proxy nmc`. Never `down -v`.
- Read-only smoke: `GET /api/ai/inspection-referrals`, `GET /api/ai/inspection-schedule/availability`, `GET /api/ai/health`. Explicit booking requires existing approved A01 referral and existing operator staging key.
- Human case creation triggers **one billable A01 call** by design; never press Create Case / Retry while only testing scheduling without permission.

### Stakeholder responsibilities (POC)
- **Business/Maritime lead:** confirm inspection type sources, ports, inspector capacity/eligibility, ability to cancel/reschedule, and officer/supervisor sign-off.
- **Application team:** Angular board, scheduling API, Oracle audit, checklist + case integrations, backward compatibility and regression.
- **AI team:** working A04/A02/A03/A01 post-action modes, structured schema, test fixtures, confidence/evidence provenance and error contracts.
- **Integration/security:** Google Drive scoped read-only tool, runtime secrets, staging POC role key; real Keycloak/UAE PASS is a later production requirement.
- **QA:** normal, conflict, missing evidence, multi-vessel, cancelled slot, concurrency, immutable risk and cost containment test evidence.

**Release decision:** S1 can be *code complete* before S0 is operationally unblocked. Do not promote the whole Smart Inspection POC as complete until D1–D6 pass in the owner's environment.
