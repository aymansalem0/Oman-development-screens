# MOEI Smart Inspection — Complete End-to-End Cycle V1
**Status:** Integrated POC implementation + business design baseline for iterative enhancement
**Repository:** `aymansalem0/Oman-development-screens`
**Branch:** `feature/si-complete-inspection-cycle-v1`, stacked on PR #60 → #59 → #58 → #57 → #56 and prior Smart Inspection work
**Date:** 10 October 2026
**Scope:** Vessel-centric Smart Inspection POC; architecture expandable to ports, marine facilities, companies and MET audit. These additional inspection regimes are *not* implemented by this patch.
**Important:** This is an end-to-end POC BUSINESS JOURNEY and central action ledger, **not** a claim that all RFP-mandated production AI features have been delivered.

## 1. Why this version exists
The intent is to expose the entire journey in one version before iterating part by part. Existing screens for PSC targeting, Candidate Center, SI-P01, A04 Preparation and Electronic Scheduling are kept. This version adds a protected, persistent Smart Inspection Lifecycle workspace for formal scope approval, recorded assignment, inspector field checklists, deficiencies, human-reviewed inspection report, corrective actions, follow-up, and closure.

* Read-only GET never calls Airia, changes NMC risk or creates a case.
* New work only starts from an existing **Publisher-approved SI Inspection Case**.
* No new static fleet fixture. Candidate Center continues to use the shared active fleet population (420 vessels at the recorded reference baseline; actual current count comes from backend).
* A candidate view groups by IMO, whereas statutory workflows and their decisions remain separate by Inspection Regime.
* PSC Port Call import is NOT inspection selection. Under PR #59, eligible events enter the selected pool only via Publisher choice within a configurable demonstrative POC quota; quota values must not be represented as official UAE regulations.
* SI-P01 ranks only approved SI cases, not raw arrivals or pending candidates, and never edits NMC Risk Score.
* Prep A04 is an explicitly initiated paid AI request. It never replaces statutory checks, adds binding findings or makes final regulatory decisions.
* Supervisor controls material decisions. Inspector is accountable for field evidence and findings.

## 2. Process map — 17 detailed business steps grouped under the 11 BA processes

| Step | BA | Name / Business event | Actor / system | Data / action | Outcome / gate | POC implementation |
|---|---|---|---|---|---|---|
| 01 | BP-01 | Register NMC, maritime service and PSC sources | NMC / Service / PSC | Official NMC approved referral, simulated service/PSC Excel events | Source-specific provenance | Existing |
| 02 | BP-01 | PSC targeting pool, eligibility and quota selection | PSC Officer / Publisher | Per port or national monthly scope; versioned threshold | Only expressly selected PSC events enter Candidate Center | Existing (#59–60) |
| 03 | BP-01 | Normalize one vessel per IMO | Candidate engine | Linked source events, distinct inspection regimes | One vessel row without losing independent workflows | Existing (#57) |
| 04 | BP-02 | Regime, legal eligibility, duplicate and mandatory check | Business rules / Officer | Rules, open cases, official saved NMC risk | Approved/Deferred/Rejected/Review Required | Existing POC rules; complete legal validation pending |
| 05 | BP-02 | Authorized inspection decision / case creation | Publisher | Decision reason, source references, audit | SI case with UUID created | Existing |
| 06 | BP-02 | Approved-case execution prioritization | SI-P01 / Officer | Current approved cases, saved risk, business criteria | Explainable recommendation, not a regulatory order | Existing opt-in; Airia requires verification |
| 07 | BP-03 | Deterministic preparation + optional A04 dossier | Officer / A04 | Vessel master, certificates, findings, NMC risk, evidence IDs | Source-locked preparation with mandatory checks and reviewed AI overlay | Existing (#50); A04 live dependent on Airia |
| 08 | BP-04 | Dynamic scope configuration and approval | Officer / Supervisor | Mandatory eight POC checks + selected A04 suggestions | Approved scoped checklist | **New V1 central ledger** |
| 09 | BP-05 | Electronic scheduling and assigned inspector | Coordinator / ERP / NMC | Confirmed NMC referral, ERP Excel slots; separate simulated manual allocation for other sources | Confirmed NMC booking or clearly marked POC manual assignment | Existing NMC PR #46 + new ledger |
| 10 | BP-06 | Inspector readines and briefing | Inspector | Confirm identity, source status, required scope, schedule, evidence | Explicit field session start | **New V1**; mobile/offline not implemented |
| 11 | BP-07 | Execute maritime field checklist | Assigned Inspector | PASS / DEFICIENCY / NOT_APPLICABLE and notes | Required items completed | **New V1** |
| 12 | BP-08 | Capture evidence metadata and AI evidence assessment | Inspector / proposed CV & Voice Agents | Evidence IDs, images/video/voice planned | Evidence references recorded; real attachment analysis remains pending | **Metadata V1; AI pending** |
| 13 | BP-08 | Confirm deficiencies and severity, raise critical flash alert | Inspector / Supervisor / NMC | Finding, severity, regulation, supporting evidence | Auditable findings; critical NMC event flow pending | **Finding recording V1; escalation pending** |
| 14 | BP-09 | Draft and approve inspection report | Inspector / Supervisor / proposed Report AI | Completed checklist, confirmed findings, summary | Deterministic, explicitly non-AI report with approval / return gate | **New V1** |
| 15 | BP-09 | Issue corrective actions / recommend enforcement | Supervisor / Action Owner / proposed AI | One responsible action per confirmed finding; due date; legal review | Actions open and traceable. No actual enforcement or external notices in V1 | **Corrective actions V1; AI/legal integration pending** |
| 16 | BP-10 | Submit correction, verify and repeat if needed | Action Owner / Supervisor / Follow-up Inspector | Evidence refs, ACCEPT/REJECT; desk or on-site review | All actions verified; follow-up PASS | **New V1 with failed-follow-up correction loop** |
| 17 | BP-11 | Close inspection; update compliance and national intelligence | Supervisor / NMC / A02+A01 | Verified closure, audit, recommended downstream updates | SI case CLOSED; **does not automatically change NMC risk or regulatory status** | **SI closure V1; A02/A01 re-assessment & enforcement not yet connected** |

**Terminology note:** The 11 BA process names and existing NMC/A04/P01 boundaries reflect the project analysis. This exact 17-row mapping is the integrated V1 working breakdown; do not present it as a verbatim extract from the earlier 41-page v2.0 document.

## 3. Roles, separations and decisions
| Role | Responsibility | Cannot do |
|---|---|---|
| NMC Operator | Assess situation; initiate approved inspection referral; review follow-up risk evidence | Arbitrarily overwrite official risk with SI-P01 ranking |
| PSC Targeting Publisher | Select actual eligible PSC Port Call events under documented published POC targeting policy | Treat every imported Port Call as an inspection |
| Inspection Officer | Verify candidate identity, duplicates, source and eligibility | Convert AI opinion into an unreviewed statutory action |
| Inspection Supervisor / Publisher | Approve case, scope, report, correction verification, follow-up, closure | Authorize legal enforcement by proxy without applicable control |
| Inspection Coordinator | Arrange inspector/port/visit under existing ERP/NMC or POC simulation | Mislabel manual demo allocation as NMC-confirmed booking |
| Assigned Inspector | Execute checklist; submit observational evidence and report | Add AI proposals as binding findings without personal review |
| Vessel operator / Corrective action owner | Submit corrective evidence | Approve own regulatory closure |
| SI-P01 | Advise on ranking of approved case execution | Approve inspection case, modify NMC Risk Score or book staff |
| A04 | Suggest pre-inspection focus and evidence gaps | Remove mandatory checklist checks, issue detention or approve report |
| A02 + Risk Rules Engine + A01 | Post-inspection compliance evidence review, configured risk recalculation, situation assessment | Infer risk improvement merely from a cleared inspection |

## 4. Canonical data model
`Vessel(IMO)` (shared read-only fleet record) → `SourceEvent(sourceType, sourceReference, provenance)` → `Candidate(IMO, regime, eligibility, priority)` → `InspectionDecision(actor, reason, policyVersion)` → `SIInspectionCase(UUID)` → `Preparation(A04 optional, sourceHash, version)` → `LifecycleCase(CASE_ID,VERSION_NO,DOC_JSON)` → `InspectionPlan(base+extras)` → `Assignment(source,actor,port,start)` → `ChecklistItem(status,severity,notes,evidenceRefs)` → `ConfirmedDeficiency` → `InspectionReport(inspector,supervisor,source)` → `CorrectiveAction(owner,due,evidence,verification)` → `FollowUp(result,method,evidence)` → `Closure(actor,reason,time)`.

No release of actual source PDFs, photos or videos is implied by storing evidence *references*. The RFP requires full file and image acquisition, tamper evidence, offline operation and AI analysis later.

**Database migration 013** creates two additive Oracle tables with FK to existing SI Inspection Case:
`SI_INSPECTION_LIFECYCLE`, `SI_INSPECTION_LIFECYCLE_AUDIT`.
It does not alter NMC source data or prior migration tables. POC JSON mode writes an atomic state file under `/data` rather than browser localStorage.

## 5. State machine and guards
`NOT_STARTED` → `PREPARATION_READY` → `SCOPE_APPROVED` → `ASSIGNED` → `IN_FIELD` → `REPORT_PENDING_REVIEW` → `REPORT_APPROVED` → (no findings → `CLOSED`; findings → `ACTIONS_OPEN` → `FOLLOW_UP_PENDING` → `READY_TO_CLOSE` → `CLOSED`).

Exceptions:
- `REPORT_PENDING_REVIEW` → `REPORT_RETURNED` → field corrections / resubmission.
- Corrective action `PENDING_VERIFICATION` → `REJECTED` → new evidence from action owner.
- `FOLLOW_UP_PENDING` with `FAIL` → `ACTIONS_OPEN` (rework), not premature closure.
- Duplicate/mismatched version → HTTP 409; no overwrite.
- Approved mandatory checklist items may not be deleted.
- Every `NOT_APPLICABLE` requires a reason; every Major/Critical deficiency requires description and evidence reference.
- All checklist items must be completed before report submission.
- Approved, unchanged preparation required for initialization and scope sign-off.
- NMC-origin assignment must match a *real scheduled* NMC referral by inspector, port and UAE local start time; otherwise booking is rejected.
- Service/PSC case booking in this V1 is labelled `SIMULATED_POC`; no implicit ERP update.
- After `CLOSED`, lifecycle mutations are prohibited.
- Closure does not assert that NMC has recalculated the risk or that a navigation licence/NOC has been restricted.

### Required action permissions
| Action | Actor/key | Outcome |
|---|---|---|
| INITIALIZE | EDITOR | Frozen base checklist from current Preparation |
| ADD_SCOPE | EDITOR | Only reviewed A04 suggestions may be added |
| APPROVE_SCOPE | PUBLISHER | Approved scope and reason |
| ASSIGN | EDITOR | NMC-confirmed or explicitly simulated appointment |
| START_FIELD / SAVE_CHECKS / SUBMIT_FIELD | EDITOR + exact assigned inspector | Field check execution and submitted report |
| RETURN_REPORT / APPROVE_REPORT | PUBLISHER + reason | Formal supervisor report decision |
| ISSUE_ACTIONS | PUBLISHER | Per-finding correction obligations |
| SUBMIT_ACTION | EDITOR + assigned action owner | Evidence references submitted |
| VERIFY_ACTION | PUBLISHER + reason | Verified or returned corrective item |
| RECORD_FOLLOW_UP | PUBLISHER + reason | Accepted or rework-follow-up |
| CLOSE | PUBLISHER + reason | Verified SI closure and explicit non-effects |

## 6. User screens and navigation
The platform menu now includes **Smart Inspection → Full Inspection Lifecycle**:
1. **Lifecycle Case Register**: centrally stored approved SI cases, stage status, IMO/name, regimes, origin and saved NMC score.
2. **Integrated Lifecycle Case**: 11-stage visual map, current stage, case ID, provenance, required credentials.
3. **Preparation / Dossier Link**: opens actual preparation by the SI case ID; explicit A04 if enabled, no fabricated output.
4. **Scope Approval**: approved mandatory checks plus optional suggestions; human sign-off.
5. **Assignment**: NMC scheduling linkage or clearly labelled manual POC assignment.
6. **Inspector Field Workspace**: editable checks, results, severity, notes, not-applicable explanation, evidence references and controlled save.
7. **Report & Supervisor Decision**: deterministic report, findings and accept/return.
8. **Corrective Action**: assign per finding, due date, evidence submission, reviewer verification and rework.
9. **Follow-Up & Closure**: desk/on-site verification, PASS/FAIL and final signed decision.
10. **Audit History**: version, actor, action, event timestamp and reason.

URLs:
- `/#/moei/smart-inspection/lifecycle`
- `/#/moei/smart-inspection/lifecycle/<SI_CASE_UUID>`
- Existing: `/#/moei/smart-inspection/psc-targeting`, `/candidates`, `/preparation/:caseId`, `/scheduling`, and NMC case routes.

## 7. AI integration design: current vs intended
| Capability | Existing path / current status | Target capability, not represented as live V1 |
|---|---|---|
| NMC risk & A01/A02 | Current saved NMC projection; independent risk policy | Evidence-triggered A02 reassessment → deterministic Risk Engine → A01 situation reassessment; final control and publish |
| PSC selection | POC rules + human quota decisions; no automatic agent | External maritime data, legally validated dynamic PSC targeting |
| SI-P01 | Configurable criteria, preview and opt-in Airia with verified pipeline ID | Proven ranking service KPIs, calibrated explainability |
| A03 Document Intelligence | No live validation asserted in this lifecycle | Certificate PDF authenticity, validity, cross-reference checks |
| A04 Dossier | Controlled on-demand A04 with evidence ID validation | 100% pre-inspection dossiers and predictive focus, maritime-specific references |
| In-field Smart Assistance | Human checklist + evidence metadata | Native iOS/Android, offline AI, vision, voice-to-inspection, cited regulatory Q&A |
| Report AI | **Not implemented**; V1 report is deterministic | Fully sourced report draft with human review, signatures and versioned models |
| CAPA & flash notices AI | Verified human action workflow only | AI draft actions, critical flash to NMC, overdue reminders |
| Enforcement recommendations | **Not implemented** | Human-approved detention/restriction/licence/NOC downstream workflows |
| National intelligence feedback | SI closure stored, risk **unchanged** | Verified evidence handoff, A02/A01 review, official risk projection, closure synchronized with NMC |

## 8. RFP checkpoints
RFP section **5.3.5 Domain 5** requires end-to-end AI pre-inspection dossier, risk-led selection, guided inspector mobile/offline operation, computer vision, cited regulation lookup, voice input, anomaly assessment, AI report drafting, AI deficiency classification, corrective notices, human-approved enforcement, executive flash reports, compliance follow-up, and continuous learning.

Targets within 18 months of go-live in the RFP include:
- 100% AI dossier **and** risk score before vessel inspection deployment.
- At least 70% standard post-inspection reports AI-generated, without manual drafting.
- At least 80% standard corrective notices AI-drafted for officer review within 30 minutes.
- At least 65% predictive deficiency correlation with actual results within 12 months.
- At least 50% reduction in report preparation time.
- 100% inspection-triggered restriction recommendations routed to responsible MOEI officers within one hour.
There is also an agent-level 80% inspection report AI-drafting target; this must be treated separately from the 70% domain target.

**None of these numerical AI outcome targets is claimed to be achieved by this POC release.** Instrumentation and production integration are future work.

## 9. Explicit exception catalogue
- Missing or invalid IMO → hold for identity review; do not silently substitute a vessel.
- Missing NMC risk → show UNASSESSED, not arbitrary risk value.
- Multiple events for same IMO → one vessel row but separate inspection regimes and independent mandatory decisions.
- PSC Port Call not selected → remains targeting pool only; no case or SI-P01 prioritization.
- Source policy changes → versioned configuration; keep past decisions and audit.
- Draft stale against current NMC evidence → refresh before A04 / scope approval.
- Airia unavailable → deterministic preparation survives, AI overlay omitted, not invented.
- Inspector unavailable or assignment mismatched → block claimed confirmed NMC assignment.
- Field offline → **not yet supported**; no false sync claims.
- Major deficiency without evidence → block report submission.
- Critical finding → supervisor review; automated NMC flash integration is a tracked GAP.
- All-pass inspection → report approval and supervised closure possible without corrective actions.
- Return report → inspector rework, preservation of previous audit.
- Corrective action rejected or overdue → remains open; no automatic closure.
- Failed follow-up → reopen corrective obligations for new submissions.
- Official risk after inspection → never silently reduce score on inspection PASS.
- Unavailable external integration → mark SIMULATED/UNAVAILABLE and do not fabricate source validation.

## 10. Acceptance tests and traceability
| ID | Test | Expected |
|---|---|---|
| AC-01 | Load fleet and candidate center | Dynamic source, one IMO per row, separate regimes |
| AC-02 | Import unselected PSC Port Call | Not created as an SI case |
| AC-03 | Publisher selects PSC event within demo quota | Event can enter Candidate Center; quota enforced |
| AC-04 | Create case without Publisher approval | Rejected |
| AC-05 | Run SI-P01 without opt-in | No Airia charge / no implicit call |
| AC-06 | Open a case lacking preparation | Initialization blocked |
| AC-07 | Prepare without Airia | Deterministic required checks saved |
| AC-08 | Add unapproved AI-suggested scope | Rejected |
| AC-09 | NMC case manually labelled ERP-confirmed | Rejected |
| AC-10 | NMC scheduled referral but inspector/date mismatch | Rejected |
| AC-11 | Assigned inspector starts field session | Approved checklist editable |
| AC-12 | Other user submits inspector check | Rejected |
| AC-13 | Pending required check | Report submission blocked |
| AC-14 | N/A without reason | Rejected |
| AC-15 | Major or Critical finding without evidence ref | Rejected |
| AC-16 | Inspector submits valid checks | Saved deterministic draft, correct deficiencies |
| AC-17 | Supervisor returns draft | Inspector rework permitted, full audit |
| AC-18 | Supervisor approves draft | Report approved, still no risk modification |
| AC-19 | Findings exist but no CAPA | Closure denied |
| AC-20 | Action submitted without evidence | Rejected |
| AC-21 | Supervisor rejects correction | Resubmission required |
| AC-22 | Follow-up FAIL | Back to ACTIONS_OPEN |
| AC-23 | Verified actions + follow-up PASS | READY_TO_CLOSE |
| AC-24 | Supervisor CLOSE | CLOSED; version audit, no NMC risk overwrite |
| AC-25 | Second browser sends stale version | 409 conflict; saved state remains authoritative |
| AC-26 | Load screens after restart | Oracle/JSON state persists, no browser-only approvals |
| AC-27 | Arabic/English and RTL | Unified MOEI theme, responsive workflow |
| AC-28 | RFP AI outcomes | Open gap list, not represented as passed acceptance |

## 11. Environment & rollout (safe deployment)
The branch is stacked on the newest PR #60; the older PRs are **not assumed merged**. Operator must preserve local changes, use a verified recoverable backup, check previously applied migrations 009–012, and then apply **013 exactly once** under `NMC_AI` in `FREEPDB1` when Oracle mode is used.

PowerShell (Windows):
```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin feature/si-complete-inspection-cycle-v1
git switch feature/si-complete-inspection-cycle-v1
# Check migration objects and verified restorable DB backup BEFORE running 013.
docker cp .\ai-proxy\migrations\013_si_full_inspection_lifecycle.sql oracle-free-23:/tmp/si-lifecycle-013.sql
docker exec -it oracle-free-23 bash
```
Inside Oracle container: use **your existing DBA-approved, non-disclosed** NMC_AI connection and run `@/tmp/si-lifecycle-013.sql` only after confirming new tables are absent. Do not paste credentials into chat, source code or logs.

Rebuild only affected services:
```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy nmc
```
For an existing Google PSC setup, retain `-f compose.google-psc.yaml` before `-f compose.oracle.yaml`. **Never** use `down --volumes`. CI and target machine runtime verification are required before declaring this branch deployed.

## 12. Next improvement passes after V1 walkthrough
1. Source/eligibility legal matrix and PSC regime governance; matching/duplicate decision.
2. SI-P01 verified Airia contract, timing and confidence; business-configurable settings.
3. A04 dossier with all evidence and predictive shortlist; A03 validated certificates.
4. Approved dynamic inspection designer with conditional mandatory rules.
5. ERP scheduling for all source types, matching, rebooking, cross-port travel and capacity.
6. Inspector preparation, native mobile offline session, secure image/video and voice capture.
7. Actual CV/voice/regulatory assistant with verifiable provenance and human override.
8. Regulatory deficiency catalogue, critical alerts, signed reports and report AI.
9. Corrective actions to owner portal, notifications, reminders and enforcement recommendation gates.
10. A02/A01 risk reassessment and NMC resolution handoff with immutable regulatory audit.
11. Model governance, KPI instrumentation and measured RFP milestone targets.

**Product rule:** Build the engine once. Configure the maritime inspection business many times.

## 13. Pre-deployment technical and business audit — 10 October 2026

### Remediation completed during review
- **Historical visibility:** Lifecycle Case Register now sources the persisted SI Inspection Case registry. A completed/closed or NMC-resolved case remains retrievable even when the live NMC targeting queue no longer shows its referral; current projection failure does not erase historical registration.
- **Already-booked NMC referral:** Authorized, previously scheduled NMC referrals may now be linked to a single SI case **without** modifying or recreating a confirmed NMC appointment. DEFER/REJECT remain blocked for pre-scheduled referrals; repeated approval remains blocked.
- **NMC assignment correctness:** Lifecycle read-only case snapshot exposes the recorded NMC booking; frontend pre-populates exact inspector, port and Dubai-local time. Backend validates the same three values before accepting the `NMC_SCHEDULED` label.
- **Report audit:** Every Oracle lifecycle transition stores a complete `STATE_JSON` copy in the append-only audit table; JSON POC mode also stores full version snapshots in its local history. Reviewers can open saved prior report summaries through the explicit `GET /api/si/v1/lifecycle/:caseId/history` endpoint and UI action.
- **Separation of review:** A report submitter cannot approve/return their own report by the same declared identity; an action owner cannot verify their own evidence by the same declared identity. **Important:** This is name-inequality POC control on top of shared role keys, NOT equivalent to trusted individual SSO identity or legally enforceable segregation.
- **Follow-up evidence:** Every follow-up PASS/FAIL now requires at least one supporting evidence **reference**. Actual secure file submission is still a pending enhancement.
- **Oracle migration guard:** readiness now verifies the `STATE_JSON` audit column in migration 013, not just presence of both tables; migration remains unapplied.
- **Production bundle discipline:** lifecycle and legacy NMC inspection screen load lazily, retaining the original 2 MB Angular production error budget (instead of raising the budget to mask new source size).
- **Regression tests:** added archived-case register, previously scheduled NMC linked-case, returned-report historical snapshot, self-review prevention and follow-up correction loop.

### Mandatory controls before even a controlled demo on the operator's environment
1. Parent PRs #59/#60 and database migrations 009–012 must be reconciled to the actual checked-out branch and migration state; branch history is stacked and **not automatically merged**.
2. Verify an actually-restorable non-production Oracle backup; ensure neither `SI_INSPECTION_LIFECYCLE` nor `SI_INSPECTION_LIFECYCLE_AUDIT` exists before applying migration 013 **once**. If either exists, stop and reconcile schema; never rerun a partially applied DDL script.
3. Verify Oracle app schema identity, `FREEPDB1`, grants, FK references, JSON check/column and exact `STATE_JSON` contents with a read-only probe after migration.
4. Test role-key gates, idempotent source imports, approval and no duplicate scheduled NMC referrals on a **non-production clone**; never use live PSC regulatory data as pretend fixture.
5. Run complete no-findings, major/critical findings, report-return, action rejection, failed-follow-up, history-retention and simultaneous-browser conflict scenarios.
6. Visually check Angular page, navigation, Arabic and English, RTL/LTR, responsive layout, inspector fields, booking UTC/UAE conversion and historical report cards in a browser.
7. Only after the above should the operator approve a controlled deployment. No automatic deployment/merge or database migration is authorized by this review.

### Blockers to *production* operational use (outside V1 POC scope)
- Person-bound Keycloak/UAE PASS authentication, trusted user identities, service-owner access, least-privilege RBAC and independent regulatory signatures. Shared Editor/Publisher secrets are insufficient.
- Actual verified PSC legal eligibility, regulatory inspection history, source integration SLAs and NMC final compliance handoff.
- Real evidence uploads with chain-of-custody, secure blob storage, timestamps, signatures, document authenticity and safe malware scanning; current strings are references only.
- Native inspector offline support, persistent photo/video recording, regulated maritime deficiency templates, regulatory catalogue and human-approved enforcement/escalation, particularly for Critical findings.
- Verified AI/Agent integration for report drafting, deficiency correlation and notices, independent performance benchmarks under the RFP.
- Complete event-level monitoring, notifications, integration transaction guarantees, retention policy, record locking and audit tamper evidence. Append-only application writes and snapshots do **not** by themselves prove tamper-proof audit.

**Go/no-go:** Passing Angular/Node/Docker CI means a build and POC smoke check passed, **not** that this branch is approved for business execution in the ministry's operational systems. Retain Draft PR until Oracle clone verification, browser UAT and business sign-off.
