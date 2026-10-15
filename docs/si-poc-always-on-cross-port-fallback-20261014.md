# MOEI Smart Inspection POC scheduling — always-on mock input and cross-port fallback

## Business requirement

The **Comprehensive Electronic Inspection Scheduling** page is an explicitly
synthetic presentation mode. Its `Use complete POC mock data` checkbox is
removed from this page: the Angular component always requests `demo=1`, passes
`demoMode=true` to preview/SI-S01/approval, and displays the existing prominent
**POC DEMO · SYNTHETIC SCHEDULING DATA** provenance banner, POC vessel badges,
POC engineering roster, and explicit `operationalBookingConfirmed:false`.

## When no inspector is available at the vessel's port

- The scheduler tries **qualified local inspectors**, then retains **qualified
  cross-port candidates** as fallback alternatives instead of excluding them
  merely because the inspector's home port differs.
- A cross-port engineer must have a valid inspection-regime/vessel-type
  qualification, a currently allowed `Travel_Matrix` route with finite travel
  duration, a shift covering travel+preparation+the inspection, no approved
  leave/port blackout/booking conflict, and capacity. Same-engineer cross-port
  tasks must satisfy inter-port travel and configured buffer between visits.
- Bounded solver keeps *both local and remote engineers* in the proposal option
  pool (diversifies by inspector ID) so a locally available but already booked
  engineer does not mask a feasible remote alternative.
- In **POC only**, the synthetic inspector has **one** home-port assignment
  instead of false all-port membership, and cross-port availability is enabled
  in a temporary calculation policy even if the published real-ERP policy has
  it disabled. Original ERP snapshot, policy, cases and imported Excel are
  **not modified**.
- Each cross-port proposal is visibly tagged with origin home port, destination,
  estimated (POC synthetic) travel minutes, and a supervisor approval warning.
- Supervisor must explicitly confirm cross-port reassignment in a **separate**
  dialog before whole-plan approval. Backend recalculates the current plan and
  refuses cross-port assignment without `confirmCrossPort:true`. Confirmation,
  actor and per-vessel origin/destination/travel are written to the existing
  canonical PR #124 Oracle 019 `SI_SCHED_APPROVAL.DOC_JSON` and audit event
  (`SI_SCHED_ORDER_AUDIT`). No new DDL is required.

## Deliberately NOT bypassed

- Final-source ETA/ETD, approved vessel roster, port and vessel-type source
  locks; stored NMC referrals require independent officer-confirmed booking.
- No fake inspector certification, impossible travel, forbidden travel route,
  blackout, approved leave, shift overrun, inter-port collision, or concurrent
  booking; those must remain visible as actionable unscheduled exceptions.
- **POC supervisor approval and generated work order are NOT a live ERP booking
  or official regulatory authorization.** No new paid AI calls, no autonomous
  inspector assignment, no Oracle reset.

## Local validation

CI runs Node POC fixture tests and PR #124 work-order tests in the Docker image.
Regression scenarios include (1) only remote qualified engineer, (2) simultaneous
visits requiring an eligible remote engineer to complete whole-plan coverage,
(3) prohibited route stays blocked, (4) cross-port order refuses missing
supervisor confirmation and logs evidence on approved order.

Windows PowerShell:

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch --track origin/feature/si-poc-default-cross-port-fallback-20261014
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml",
      "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED="false"
$env:NMC_FLEET_AUTO_ENABLED="false"
# Requires existing local .env, Oracle NMC_AI/FREEPDB1, canonical PR124 019,
# and service-account mount for Google PSC if the extra overlays are used.
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc run --rm --no-deps ai-proxy node tools/check-si-schedule-oracle.mjs
# ONLY if status READY and verified backups exist:
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-scheduling-poc-fixtures.test.mjs test/si-schedule-orders.test.mjs
```

Open `http://localhost:4200/#/moei/smart-inspection/scheduling`, select an
approved plan, calculate feasible slots, review remote engineer travel,
explicitly approve cross-port exceptions, and issue work orders.

**Deployment status:** Not automatically deployed; review CI and run
Oracle-backed browser UAT before promoting this draft.
