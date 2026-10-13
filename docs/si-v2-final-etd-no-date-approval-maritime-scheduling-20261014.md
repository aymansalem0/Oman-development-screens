# MOEI Smart Inspection V2 — Final ETD, Comprehensive Maritime Scheduling & NMC Integration

**Status:** V2 foundation, Draft PR #108. The full post-schedule execution / image-AI / NMC-closure workflow is **not** implemented yet.

## A. Final business decisions

1. **A source ETD is final immediately on MSW import.** No additional "review/approve ETD" step; Dubai-local `etd_local` must be syntactically valid and after arrival `eta_local` for PSC. The source identity, spreadsheet batch and original row remain auditable. A synthetic POC input is *final for simulation*, **not a certified live-MS W fact**. Arrival ETA is NEVER substituted for ETD.
2. **No GT/tonnage-range eligibility field is required for scheduling.** Gross tonnage may appear in vessel particulars and inspection dossier if available, but the engineer assignment engine never excludes staff because `GT_Authorizations` or GT limits are missing. Regime, vessel type, location authorisation, qualifications, leave, shifts, capacity, berth safety and travel remain hard gates.
3. **Option B:** the coordinator presents a *whole-plan* provisional inspector/date/site schedule; the supervisor approves that combined schedule. **Schedule approval is a different decision from ETD finality.** No date-by-date approval gate.
4. **Approving the inspection plan creates no inspection cases or dossiers.** The human-approved roster and ALL source reasons, including NMC referrals, are frozen in Oracle 018 with a NULL CASE_ID; inspector work orders are reserved for the later confirmed scheduling stage.
5. **NMC case integration:** NMC cases/referrals cannot be manufactured through MSW Excel. The source remains the human-approved NMC workspace. Already scheduled/closed NMC referrals must not receive a second booking. An NMC referral with no departure window must remain UNSCHEDULED until an operator enters the final operational window directly; the system never invents ETD from risk/incident/ETA.
6. **PSC selection is a separate statutory gate**; a port call and final ETD do not automatically make the vessel selected for PSC inspection.
7. **Agentic AI is advisory.** Current implementation is a traceable deterministic scheduling optimizer, *not yet an Airia AI scheduling agent*. Any future AI suggestion cannot bypass eligibility, approve visits or close NMC cases.

## B. Source and maritime data design

The importer accepts the original seven-column MSW source format plus an eighth `etd_local` column. The enhanced template is the recommended one. The new workbook generator assigns unique **ETD-v2 source event IDs** instead of overwriting previously imported immutable source events.

| Service Request | PSC Port Call |
| --- | --- |
| request_id | port_call_id |
| request_reference | port_call_reference |
| imo | imo |
| port | port |
| request_date | eta_local |
| service_type | visit_purpose |
| notes | notes |
| etd_local **(final)** | etd_local **(final)** |

Date pattern `YYYY-MM-DDTHH:mm` is UAE local (UTC+04:00). Backend `departureAt` stores the offset-qualified representation. New importer `sourceApprovalStatus=SOURCE_FINAL` means final **DATE**, not an inspection approval. The commit response explicitly returns `requiresDateApproval:false`. Historical source rows with no ETD continue to work but do **not** gain an invented ETD; re-uploading the old event ID with changed content returns an idempotency conflict.

**Source confidence separation:** `provenance=POC_SIMULATOR` remains. Live source certification must be supplied by future MSW integration, not inferred from `SOURCE_FINAL`.

## C. Operational scheduling constraints and maritime realism

**Vessel availability:** source ETA-to-ETD window for PSC; service visits or NMC referrals without arrival need a separately entered final earliest start. The assigned slot must fit entirely within the operative window. Physical accessibility (berth/anchorage/terminal) is a distinct confirmation flag and does not follow automatically from vessel location or ETA.

**Maritime inspection scope:** Port State Control, maritime service, flag-state/focused inspection and follow-up have distinct qualified engineer scopes. If a single physical visit covers several sources/regimes, **every** required regime qualification must be held by the assigned engineer; otherwise it must be split into separately authorized visits in a later workflow revision, never hidden as one "inspection approved" decision.

**Workforce:** ERP snapshot must include active engineer, per-regime/vessel-type qualification and expiry, authorized port access, shift, approved/pending leave, existing work orders, daily capacity and travel matrix. No overlap or infeasible cross-port travel. The optimizer maximizes feasible assignments then scores options under a bounded beam-search: auditable and efficient for POC-sized batches, **not guaranteed global mathematical optimum**. If no feasible slot, return a specific UNSCHEDULED reason.

**Safety:** POC engineer availability, berth and final dates are test assumptions unless verified through official ERP/MSW/port systems. No surprise paid Airia calls. An unconfirmed berth may mean the ship is physically inside a port but unsafe or impossible for the planned inspection.

## D. NMC functional bridge (partial implementation)

The new batch scheduler checks each approved plan's `inspectionReasons` for NMC source event IDs, resolves them against `NmcCaseWorkspace.listInspectionRequests()`, and refuses a referral that is closed, missing, tied to another IMO, or already scheduled. In source-context presentation NMC referral IDs remain visible next to MSW and PSC reasons; duplicates are not silently auto-booked.

The **future confirmation handler** must atomically/transactionally recheck NMC referral version/status and ERP capacity, book the inspector, create the assigned job, and initiate SI-02 dossier + published base/AI-suggested checklists. Event delivery to NMC should use a durable idempotent outbox. At Smart Inspection completion send `INSPECTION_COMPLETED_READY_FOR_NMC_OFFICER`, notify the responsible NMC Officer, and let that officer review and close the NMC Case; do not auto-resolve a regulatory case purely from an AI output.

## E. V2 routes and current implementation limits

| Endpoint | Capability | Writes |
| --- | --- | --- |
| `POST /api/si/v1/inspection-plans/:id/approve-for-scheduling` | Supervisor freezes the selected whole-plan roster and all evidence | Oracle 018 approved plan/version/reasons; **0 SI cases** |
| `GET /api/si/v1/maritime-scheduling/plans/:id/context` | Aggregates source-final ETA/ETD, NMC referral links and ERP ports | None |
| `POST /api/si/v1/maritime-scheduling/plans/:id/preview` | Proposed time/site/engineer for the entire approved roster | None |
| Angular `/moei/smart-inspection/scheduling/plan/:planId` | Full-plan input, final ETD locked, berth access & exceptions board | None |
| `/api/si/scheduling/proposals` **legacy** | Single-NMC-referral scheduler | Legacy behavior unchanged |

**NOT included yet:** persisted supervisor confirmation of all proposed slots, atomic full-batch ERP booking and NMC updates, auto-generated SI-02 dossier to inspector inbox, dynamic published checklist + image AI item completion, regulatory report supervisor signoff, and NMC closure notification. Therefore do not advertise this branch as full end-to-end POC delivery. The legacy inspection-batches endpoint still exists for compatibility; the updated **Create Inspection Plan Wizard** chooses the new zero-case V2 approval route instead.

## F. Repeatable local test

```powershell
cd C:\Users\Admin\Oman-development-screens
if (git status --porcelain) { throw "Review local changes first" }
git fetch origin
$branch="feature/si-v2-maritime-batch-scheduling-foundation-20261014"
if (git branch --list $branch) { git switch $branch; git pull --ff-only origin $branch }
else { git switch --track "origin/$branch" }

$dc=@("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_FLEET_AUTO_ENABLED="false"
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
docker compose @dc config --quiet
docker compose @dc up -d --build ai-proxy nmc
docker compose @dc ps
```

**Use the two regenerated ETD-v2 workbooks** with new event IDs. Inspect `Candidate Source Imports → Preview`: ETD displayed as final and no date signoff button. PSC still needs its independent quota selection. Create a new inspection plan, select vessels, and use the new **Approve for Scheduling** step; it must not increase `SI_INSPECTION_CASE` count. Open the new full-plan scheduling board and fill missing berth access, location, NMC final window, and duration. Click Generate Preview, verify multi-regime eligibility and no double-booking. Do not mistake the preview for an approved or executed schedule.

**No DB reset or destructive migration required.** The authoritative 99 IMO identities and all historic Oracle data are preserved.
