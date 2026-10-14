# MOEI Smart Inspection — Schedule Approval → Work Orders → Mandatory + Reviewed AI Checklist

## Intended business flow

1. **Inspection Plan**: officer has selected and supervisor has approved the vessel roster, with verified original source events (NMC, PSC or service request) and all applicable inspection regimes.
2. **SI-S01 scheduling**: planner supplies real visit port/site/ETA/ETD/inspection-duration and the server proposes a whole-plan schedule consistent with the saved ERP engineers/qualifications/leave/shifts/other bookings.
3. **Approve complete schedule**: a PUBLISHER supervisor enters a reason (8–500 chars) and selects the server-provided AI-ranked ERP-feasible variant or the baseline. The backend recalculates the schedule and verifies source hash and plan revision *again*. One approved schedule per plan; 019 stores immutable roster and audit, protects concurrent approvals.
4. **Issue work orders and prepare dossiers**: the publisher explicitly dispatches. Every physical vessel gets a dedicated work order, linked to its original plan, case, inspector, port, appointment and all inspection reasons. Existing case-creation ledger is used in transactional groups of up to 40 and reconciled on retries (not a false global XA transaction). The existing SI-02 deterministic dossier is prepared.
5. **Optional A04 before starting field inspection**: open `/moei/smart-inspection/preparation/:caseId`. An authorized operator may explicitly invoke A04 with any applicable provider cost confirmation, review AI-suggested additions, and APPROVE or REJECT them. **Unreviewed agent output is never placed in the inspector's checklist.** No mandatory statute is ever replaced by AI.
6. **Inspector signs in**: navigate to `/moei/smart-inspection/my-work-orders`. Only the authenticated user mapped to the ERP inspector ID sees and can execute their issued orders. Execution creates/pins the published **mandatory** checklist revisions, adds **human-approved A04 scope additions** to the existing lifecycle checks, and starts field execution. No fresh paid AI call on execution. Retrying the same order opens the existing state without making duplicate checklist records.
7. **Field inspection**: `/moei/smart-inspection/checklists/:caseId` contains mandatory dynamically configured checklist items; `/moei/smart-inspection/lifecycle/:caseId` includes the reviewed AI additional scope and existing field/report/CAPA stages. Both records are case-owned and audit-linked.

## Important operational limitations

- **Synthetic POC inputs are NOT official ERP appointments.** The official schedule approval endpoint intentionally rejects `demoMode:true`. In the existing POC environment, you can still preview/compare AI scheduling using synthetic engineers. For issuance and execution use a verified saved ERP snapshot and authorized inspector accounts; do not silently claim that a synthetic appointment is a confirmed operational booking.
- The schedule ledger represents **supervisor-approved planning and work orders**; it does **not write a booking into the external ERP**. Its inspector/time entries are used as internal reservations/conflict checks.
- NMC referrals must have a separately confirmed NMC scheduling record with matching inspector, port and date before case/dossier dispatch. PSC and service inspections do not require an NMC referral.
- Existing SI-A04 requirements may need a saved NMC risk assessment and verified evidence; if A04 is not enabled/ready or its draft has not been reviewed, **only the mandatory checklist** is created. An AI checklist cannot be invented to avoid source requirements.
- Checklist template publication/seed migration 017 is a prerequisite. Missing mandatory published templates STOP execution before any field lifecycle state is written.
- An authenticated inspector email must be provisioned against the ERP `inspector_id` through `SI_V2_INSPECTOR_IDENTITY_MAP_JSON` in the local, noncommitted `.env` (e.g. `{"inspector@example.org":"ERP-INSPECTOR-7"}`). The backend resolves this mapping; caller-supplied actor/engineer cannot override it.
- Roles: supervisor PUBLISHER approves and dispatches; EDITOR inspector sees only own work orders, and execute checks exact server-resolved inspector identity. Supervisor cannot impersonate inspector.
- This PR does not implement automatic official NMC closure or a cross-system ERP booking write.

## Oracle migration 019 (required, ADDITIVE)

Source: `ai-proxy/migrations/019_si_schedule_approval_and_assignment.sql`. Must be applied under the intended existing application schema (e.g. `NMC_AI`) in the correct PDB, after a verified restorable Oracle backup. First check 009/010/013/017/018 and `tools/check-si-rolling-oracle.mjs`. **Migration 019 is not applied by application startup.** It creates four tables (`SI_V2_SCHEDULE_MUTEX`, `SI_V2_SCHEDULE_APPROVAL`, `SI_V2_SCHEDULE_ASSIGNMENT`, `SI_V2_SCHEDULE_AUDIT`) plus indexes and 1 mutex row; it is rerunnable and contains NO drop, truncate or data reset.

An example DBA-safe interactive sequence from a local host with SQL*Plus or SQLcl:

```powershell
cd C:\Users\Admin\Oman-development-screens
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
        "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc exec ai-proxy node tools/check-si-rolling-oracle.mjs
# After backup/approval, run SQL*Plus / SQLcl as the application schema:
# SQL> CONNECT NMC_AI@FREEPDB1
# Password is prompted privately; NEVER paste it into shell history/chat.
# SQL> SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA'),SYS_CONTEXT('USERENV','CON_NAME') FROM DUAL;
# SQL> @ai-proxy/migrations/019_si_schedule_approval_and_assignment.sql
# SQL> SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'SI_V2_SCHEDULE_%';
```

If executing SQL*Plus inside the Oracle container instead, copy the migration to its filesystem via `docker cp`, then run the script with an authenticated **NMC_AI** session; do not use `SYS` or run it against the wrong schema/PDB.

## Running the implementation

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch feature/si-schedule-approval-work-orders-20261014
git pull --ff-only origin feature/si-schedule-approval-work-orders-20261014
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
        "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-v2-schedule-work-orders.test.mjs
docker compose @dc ps
docker compose @dc logs --tail=150 ai-proxy
```

On startup look for `[si-scheduling] WORK_ORDER_STORE_READY schema=019`. A 503 `SI_V2_MIGRATION_019_REQUIRED` means the additive DB objects or schema privileges are not ready; it is not a reason to delete volumes or create a new empty database.

## Acceptance

- Attempt to approve a schedule with 1 missing/unscheduled vessel → fail closed, no partial approved roster.
- Fresh ERP/plan source change after a previously calculated proposal → fail `SI_V2_SCHEDULE_PROPOSAL_CHANGED_REVIEW_AGAIN`, no new work order.
- Valid supervisor approval: all assigned engineer IDs, locations, time windows and plan-version/source-ref entries saved; reload persistent snapshot and compare.
- Dispatch: every vessel has one case/dossier/order; retries do not duplicate cases and safely reconcile partial batches.
- NMC referral without independently confirmed appointment remains pending; no falsified NMC booking.
- Authorized engineer can see only own orders. Wrong signed-in user or supervisor gets 403; clicking Execute twice returns same checklist.
- Mandatory published template revisions remain intact, all items initially unanswered; only a reviewed A04 overlay produces AI additions.
- Test field submission/report/CAPA after execution, not only the first screen transition.
