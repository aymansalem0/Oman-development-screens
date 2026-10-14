# Smart Inspection — Plan-driven electronic scheduling with SI-S01

## Requested business workflow

The default **Electronic Scheduling** menu MUST NOT be the NMC-only referral scheduler. It is a workflow for the vessels included in an **approved Inspection Plan**:

```text
Approved Inspection Plan (NMC referrals + PSC Excel + service requests)
 -> Plan-specific visit inputs: vessel / IMO / scope / port / verified ETA & ETD
 -> Verified ERP workforce snapshot: engineers, qualifications, shifts, leave,
    site/port availability, booked inspections, capacity and travel constraints
 -> Free deterministic, HARD-CONSTRAINT complete-plan scheduling proposals
 -> Confirm ONE potentially billable SI-S01 Airia advisory call
 -> AI ranks up to THREE full, source-verified schedules of equal vessel coverage
 -> Officer reviews AI rationale + engineer/port/date per vessel
 -> FUTURE: versioned supervisor schedule approval -> inspector assignments,
    dossiers, field inspection -> report / CAPA -> NMC outcome
```

**UI paths**
- `/#/moei/smart-inspection/scheduling` — all APPROVED rolling inspection plans, vessel counts from versioned backend plan list, draft plans redirected for review. No need for a pending NMC referral to show PSC/service vessels.
- `/#/moei/smart-inspection/scheduling/plan/:planId` — full plan vessel roster, editable final scheduling facts when missing, verified engineer snapshot, free proposal button, explicit SI-S01 AI button, vessel/engineer/date views.
- `/#/moei/smart-inspection/scheduling/referrals` — *legacy* individual NMC referral scheduling (preserved for compatibility).
- `/#/moei/settings/ai-governance` — per-agent SI-S01 setting, pipeline UUID, provider and enable state.

## Back-end contract and evidence

- `GET /api/si/v1/inspection-plans` lists sanitized plan status and vesselCount.
- `GET /api/si/v1/maritime-scheduling/plans/:planId/context` requires approved plan and saved verified ERP snapshot.
- `POST /api/si/v1/maritime-scheduling/plans/:planId/preview` uses user-provided **real visit facts** with backend source validation; no AI calls or writes.
- `POST /api/si/v1/maritime-scheduling/plans/:planId/ai-recommend` must include identical `requests`, `expectedProposalHash`, `confirmRun:true`, `confirmCost:true`. Requires `SI_AI_PROVIDER=airia`, `SI_S01_ENABLED=true`, configured Airia S01 pipeline. Server regenerates ERP-feasible schedules using fresh plan/ERP/policy before any paid call and refuses stale hash. Calls Airia **once** with `userInput` as a serialized JSON string and `asyncOutput:false`.
- Request to SI-S01: `feasibleSlots` (each is a fully feasible, equal-coverage schedule containing source verified ISO/engineer/port/time), `currentSnapshot.slotSetHash`, `outputContract`, `businessGuardrails`. The partner model NEVER has authority to create new options.
- Expected SI-S01 reply: `{bookingConfirmed:false, slotSetHash, rankedOptions:[{optionId,rank,confidence,rationale,evidenceRefs}]}`. IDs MUST match one of the current server generated whole-plan alternatives, no duplicate ranks, confidence 0..1, refs from allowed evidence. Bad output fails closed with 502; **NO partial booking, case or approved plan mutation**.
- The returned recommended `proposal` remains `DRAFT_REQUIRES_SUPERVISOR_APPROVAL`. It is **not** a booked schedule or formal regulatory decision.

## S01 boundary versus AI assertions

The feasibility engine must verify qualifications for each regime, shift capacity, approved leave, existing bookings, port access/time windows, inter-port travel and daily work limits. The AI ranks feasible choices, not guesses them. A disabled S01, a nonexistent Airia key, changed source, missing berth, obsolete ERP snapshot, or absent verified ETD must produce clear blocked or unscheduled status rather than fabricated dates.

For large rosters the bounded heuristic is not guaranteed globally optimal. The 500-vessel cap is only technical input validation; actual ERP capacity may leave many vessels unscheduled. **Schedule approval, Oracle reservation ledger Migration 019, case creation and dossier dispatch are NOT provided by this PR**; these are subsequent work items, do not activate incomplete Migration 019 from another branch.

## Local activation and safe test

```powershell
cd C:\Users\Admin\Oman-development-screens
git fetch origin
git switch --track origin/feature/si-scheduling-plan-driven-airia-s01-20261014
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
        "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-maritime-batch-scheduling.test.mjs test/si-maritime-plan-source.test.mjs test/si-plan-s01-advisor.test.mjs
docker compose @dc ps
```

In AI Governance, ensure **SI-S01 only** has its intended structured JSON pipeline (partner guide 14 October, `eee9e630-ec5c-4ad8-b23e-59119696f837` baseline) and set SI provider to Airia only after secure credentials and cost review. Do not print API keys or run new paid tests repeatedly when the pipeline is unverified. The first scheduling step is free. The second SI-S01 button discloses a one-call cost possibility.

**Database Migration:** none required by this change. Oracle 018 must already be present for persisted rolling inspection plans. No destructive DDL or Docker volume deletion.
