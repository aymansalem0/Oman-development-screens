# SI-01 Plan-Level Approval → Approved Inspection Plan → SI-02 Dossiers

**Branch:** `feature/si-bulk-approval-inspection-plan-dossier-20261013`, stacked on the SI-02 fix PR #91 (and prior login/Google SSO branches).

## Approved change to business flow (October 13)

Unlike the original Smart Inspection Agentic AI Integration v1.0 (12 Oct), which documents per-case `APPROVE/DEFER/REJECT`, the approved change is a **single supervisor approval on the entire set of vessels selected in the current inspection plan**. Do not confuse:
- 420 active fleet records;
- 25 expected candidate vessels;
- 4 C01 AI-recommended vessels;
- **5 selected vessels in the current plan, after officer amendments**;
- 0 official approved inspection cases before this step.

"Approve Complete Plan (5 Vessels)" means the *5 currently selected*, never the whole fleet or all candidates.

## User journey

1. System reads NMC referrals, PSC selected-port calls and service-request candidate events and evaluates C01/priority advice.
2. Officer adjusts plan inclusion/rank, with audit reason. C01 result is advisory; no official approval.
3. Supervisor expands **Approve the Inspection Plan** section. The read-only server preview shows the full list of selected IMOs and the saved plan version/hash.
4. For an IMO with multiple independent inspection regimes, supervisor explicitly chooses **one regime** for this batch. A vessel can have further valid inspections in different regimes through a future separate approved plan; the present batch never conflates them.
5. Supervisor enters a batch-level reason and clicks **Approve Complete Plan** once.
6. Backend verifies session PUBLISHER role, source version and exact plan-selected IMOs/eligible regime decisions.
7. **Atomic approval:** `SiCandidateTargeting.decideBatch` commits all selected distinct SI cases and corresponding decisions in **one Oracle transaction** (JSON POC mode uses one atomic state file). The approved cases have a shared `approvedPlanId`, human actor, source/rules provenance.
8. Job persists the approved inspection plan with IMO, selected regime, effective rank, caseId, sourceHash, approvalReason and batch status. After the atomic business approval, background orchestration:
   - Builds baseline **SI-02 preparation** (deterministic, no model call) for each approved case and saves 8 mandatory checklist checks/referenced evidence.
   - Optionally invokes **A04** to draft vessel-specific AI dossier and additional suggested checks. This is explicit opt-in and cost-confirmed for real Airia. Mandatory checks are never rewritten and additional suggestions require separate supervisor review.
   - Optionally invokes **P01** after approval to advise the **execution priority** of approved cases; this is NOT pre-approval C01 ranking, and cannot bypass protected tiers.
9. UI polls progress, displays each vessel's case ID, deterministic preparation status and AI dossier status, and deep-links directly to SI-02 Preparation.
10. Failure in one dossier after all cases were committed results in **PARTIAL** job status with item-specific error. It **does not** retroactively undo valid approved cases. Operator must review; the app does not silently rerun potentially charged Airia calls.

## APIs (new)

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | `/api/si/v1/inspection-batches/preview` | Editor | Read-only current selected IMO preview (0 AI calls) |
| POST | `/api/si/v1/inspection-batches` | Publisher | Validate one human decision and enqueue approved plan + dossiers |
| GET | `/api/si/v1/inspection-batches` | Editor | Last 5 approved plan jobs |
| GET | `/api/si/v1/inspection-batches/{id}` | Editor | Read real progress, case IDs, failures (0 AI calls) |

In `POST`, required fields are `expectedRevision`, `expectedSourceHash`, `expectedAgentRunId`, `choices` [{imo,candidateKey}], `reason` (>=8 chars), `confirmApproval=true`, `generateA04` boolean, `runP01` boolean, `confirmAiCost` boolean when AIRIA is selected. Authenticated Google ADMIN identity is the real actor; UI values cannot impersonate a supervisor. API returns 202 job snapshot, not a guarantee that all dossiers have finished.

## Data and resilience

- Approval cases/decisions: **existing Oracle SI tables** or equivalent JSON POC mode. All-or-nothing on approval.
- Baseline dossiers/A04: existing Oracle SI preparation tables or JSON POC mode, per-case independently.
- Approved plan orchestration job: **existing /data Docker volume** `SI_BATCH_PLAN_PATH` (default `/data/si-approved-batch-plans.json`).
- Requires migration **009** for case approval and migration **010** for per-vessel preparation. P01 requires migration **011** in Oracle mode if selected.
- 40-vessel maximum per batch; maximum **15 AI-enabled vessels per batch** in this POC. This is an engineering cap, not a ministry quota.
- Real Airia cost consent is scoped to this particular batch. This implementation is a single-instance POC worker. For production/HA, move the job store to **Oracle (transactional outbox)** or the authoritative Azure SQL if migrating the database, use leased workers, durable charge budgets and explicit recovery/resume controls. Do not claim this file worker provides distributed exactly-once execution.
- Scheduled/event-driven C01/P01 re-evaluation discussed in the prior conversation is a **separate automation increment**, not silently switched on by this approval work. GET, filters, page open and refresh remain free of AI calls.

## On-device execution

```powershell
git fetch origin
git switch --track origin/feature/si-bulk-approval-inspection-plan-dossier-20261013
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```

Before switching branches, preserve uncommitted local changes (including the optional photo file) and maintain your existing untracked `.env` OAuth credentials. Do not run `docker compose down -v` or reset Oracle.

Open `http://localhost:4200/#/moei/smart-inspection/candidates`, review C01 plan and **Approve the Inspection Plan**, then check `http://localhost:4200/#/moei/smart-inspection/preparation`.

## Acceptance checks

- 5 selected vessels -> **one click**, 5 approved cases and 5 baseline dossiers; no per-row official Approve button.
- AI C01 4 recommendations vs officer-selected 5 -> **approve the selected 5**, not 4, 25 or 420.
- Different regimes on one IMO -> mandatory explicit regime choice, never two unreviewed statutory inspections.
- Duplicate clicks/job replays -> no duplicate cases; committed case IDs retain shared approvedPlanId.
- New NMC change between preview and approval -> reject with 409 and require rereview.
- No stored risk -> deterministic prep still exists, A04 cannot fabricate risk or dossier claims and presents case-specific failure; no silent approval of AI optional scope.
- Airia provider -> no charge without an explicit batch opt-in; A04/P01 disabled -> cannot enable implicitly.
- Oracle failure during approval -> rollback entire case batch. Failure in one dossier afterwards -> show exact partial result; never lie that all finished.
- Supervisor scope approved manually afterwards, field scheduling/booking remains subject to deterministic ERP and applicable human approvals.
