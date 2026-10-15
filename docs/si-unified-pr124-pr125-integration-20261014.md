# MOEI Smart Inspection — PR #124 + PR #125 compatibility integration (DRAFT)

## Branch lineage and deliberate conflict resolution

- Upstream: PR #122 approved-plan + SI-S01 whole-plan scheduling.
- Preserve PR #124 **as the operational canonical implementation** of synthetic POC
  schedule approvals, case/dossier preparation, mandatory checklist snapshots,
  separate human scope approval, explicit FIELD start and auditable MOCK delegation.
- Port from PR #125: **authenticated assigned-inspector-only work-order roster**,
  session email to ERP inspector ID mapping, "My Assigned Inspections" UI route,
  tighter field-start authorization and regression checks.
- **DO NOT execute** PR #125 alternate `019_si_schedule_approval_and_assignment.sql`.
  It expects `SI_V2_SCHEDULE_*` objects incompatible with the existing PR #124
  `SI_SCHED_*` schema. Canonical **single** migration:
  `ai-proxy/migrations/019_si_schedule_work_orders.sql` (fixed for first-time
  SQLPlus execution using dynamic SQL for mutex seeding). Historical PR #125
  alternative remains available on its original branch for reference only.
- This is NOT an unqualified merge of alternate approval engines. PR #125's
  **approve -> separately dispatch** implementation is reconciled into PR #124's
  POC-specific **approve + issue orders -> individually activate -> scope approve
  -> inspector start** workflow. Do not run both ledgers/routes simultaneously.
  External ERP booking and confirmed NMC referral schedule remain independent.

## Unified business journey

```
NMC / PSC / Service sources
 -> Candidate Center + SI-C01 advisory + rules/quotas
 -> Rolling Inspection Plan / supervisor human approval (018)
 -> Complete ERP-feasible plan schedule + optional SI-S01
 -> Supervisor approval, saved versioned per-vessel work orders (canonical 019)
 -> Officer activates order: inspection case + SI-02 dossier + mandatory checklist
 -> Optional A04 recommendations require separate human review
 -> Supervisor approves checklist scope (mandatory always preserved)
 -> Authenticated assigned engineer starts field inspection (new "My Work Orders")
    OR supervisor explicitly authorizes MOCK-only recorded delegation
 -> Inspections/checklists/results/report/CAPA/follow-up via existing SI lifecycle
```

## Identity and authorization

1. Put `SI_V2_INSPECTOR_IDENTITY_MAP_JSON` **in your existing local, uncommitted
   .env**. Example:
   `SI_V2_INSPECTOR_IDENTITY_MAP_JSON={"inspector@example.org":"ERP-INS-007"}`
   Use an actual authenticated MOEI email and an actual ERP inspector ID.
   Do not commit users' identities or credentials to source control.
2. API `GET /api/si/v1/maritime-scheduling/my-work-orders` derives identity from
   the authenticated MOEI session, returns **only assigned orders**, and never
   accepts caller supplied actor/inspector ID.
3. `POST .../plans/:planId/work-orders/:orderId/start` checks the same mapped
   ERP inspector ID, requires a prepared mandatory checklist and separate
   supervisor scope approval. Valid real-session starts are audit-linked.
4. `confirmPocDelegation:true` is allowed **only** when the stored approved
   schedule is clearly `POC_MOCK`, the caller has PUBLISHER supervisor rights,
   and the action is explicitly audited as `POC_DELEGATED_FIELD_START`.
   The delegated action is not inspector login or regulatory authorization.
5. No implicit `actor===inspectorName` trust, no default untrusted session
   name, and no use of an HTTP supplied assignment identity.
6. Original PR #124 supervisor schedule approval still depends on a complete
   approved roster, refreshed source hash and hard-constraint feasibility. No
   AI output can introduce a booking or mandate a checklist question.

## Installation (Windows PowerShell, LOCAL POC only)

Do NOT reset Oracle 23c, drop 009–019 tables, or delete Docker volumes.
A verified recoverable backup of Oracle + /data is required before schema DDL.

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch --track origin/feature/si-unified-inspection-poc-124-125-20261014
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
      "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
$env:NMC_FLEET_AUTO_ENABLED="false"
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
# READ-ONLY Oracle 019 check against the existing NMC_AI/FREEPDB1:
docker compose @dc run --rm --no-deps ai-proxy node tools/check-si-schedule-oracle.mjs
# Only if status READY and a restorable backup has been verified:
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-inspector-identity.test.mjs test/si-schedule-orders.test.mjs
docker compose @dc ps
docker compose @dc logs --tail=100 ai-proxy
```

If 019 is MISSING, run only canonical `ai-proxy/migrations/019_si_schedule_work_orders.sql`
after a backup and DBA review; **never** run the alternate PR #125 migration.
All five prerequisite migrations must be present, including 017 and 018.
If the user's database already has the four `SI_SCHED_*` tables and required
indexes/mutex, do not reapply any DDL.

## UI and API

- `/#/moei/smart-inspection/scheduling` — approved inspection plan center.
- `/#/moei/smart-inspection/scheduling/plan/:planId` — POC schedule approval,
  order activation, supervisor scope approval and explicitly delegated MOCK start.
- `/#/moei/smart-inspection/my-work-orders` — **new** signed-in inspector-only
  roster. An assigned inspector can start an already prepared/scope-approved order.
- `/#/moei/smart-inspection/checklists/:caseId` — mandatory checklist.
- `/#/moei/smart-inspection/lifecycle/:caseId` — field/report/CAPA workflow.

## UAT gates before release

- Verify 018 and the canonical PR #124 019 are READY in the correct PDB/schema.
- Confirm **only one** schedule per plan and the existing plan history is retained.
- Synthetic POC assignment remains labelled and has **zero official ERP bookings**.
- "My Assigned Inspections" displays **only** work orders for the authenticated
  identity whose email is mapped to the saved ERP inspector ID.
- A supervisor without matching mapping cannot impersonate a real engineer.
- Supervisor MOCK delegation requires separate PUBLISHER permission and audit.
- No field start before mandatory checklist preparation and supervisor approval.
- A04 draft recommendations are never promoted without human review.
- No automatic paid Airia call on GET/navigation/preview.
- Verify both Angular build and Node tests, then run real browser UAT against
  local Oracle. CI cannot prove local runtime/Oracle/IAM integration.
- Treat NMC closure and external ERP booking writes as separate acceptance gaps.

**Status: DRAFT integration, not deployed and not production-ready.**
