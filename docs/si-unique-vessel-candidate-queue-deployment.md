# Smart Inspection — One Candidate Vessel Row per IMO (PR #57)

## Root cause and business correction

PR #55 originally generates individual **candidate workflows** by
`SHA(IMO + Inspection Regime)` to preserve separate PSC / Service / NMC
inspection decisions. When Service Request and PSC Excel sheets contain the
same ship, this is correct for case handling but the **candidate table
mistakenly displayed each workflow as a new vessel row**.

The business requirement is different: **ONE visible vessel row per IMO,
with ALL its source events underneath it**. Repeated uploads must NOT add a
second visible vessel. Source records and inspection-regime actions accumulate
under the existing vessel. Approval of PSC does NOT approve a Service or NMC
inspection, and regulatory cases cannot be merged as one decision.

## Contract and code

Backend `GET /api/si/v1/candidates/dashboard` now additionally returns
`vesselCandidates[]` (exactly one per IMO) and three summary counters:
- `summary.candidateVessels` — unique IMO count;
- `summary.pendingVessels` — IMO count with >=1 pending inspection workflow;
- `summary.createdVessels` — IMO count with >=1 created SI case.

Each `vesselCandidates[]` record includes its IMO, vessel metadata,
NMC saved risk as-is, distinct `sourceTypes[]`, deduplicated
`sourceEvents[]`, `regimes[]` and `workflows[]`, plus
pending/created/scheduled workflow counts. `events[]` preserve original
sourceEventId, fileName, batch, Excel row, etc.

**The existing `candidates[]` API remains unchanged** for independent
inspection decisions, SI-P01 agent source evidence, per-regime rule order,
A04 preparation and official NMC live referrals.

UI Candidate Center:
- Table rows and selected-row highlighting now use **IMO only**;
- the Sources cell grows to show **NMC + Service + PSC** badges and event
  count, without duplicated vessel rows;
- inspection regimes appear in the same row as chips;
- source filter filters **vessels**, but when a vessel is shown, all of its
  provenance remains visible;
- Review Vessel opens a new vessel-level source overview, then requires an
  **explicit regime selection** if there are multiple workflows;
- Approve/Defer/Reject continues with the original `candidateKey`
  restricted to the selected regime (never accidentally approve both);
- dashboard top KPI now displays unique vessel candidates and includes the
  underlying distinct inspection workflow count;
- SI-P01 rule preview also displays one vessel row with each regime's
  individual rank visible within that one row; no AI/NMC policy changed;
- AI rank on the main vessel row is clearly labeled the *best ranked
  inspection workflow*, not a combined official score.

### Example

Input: 24 Service Requests + 24 PSC Port Calls; 20 common IMO values.

Expected once committed:
- Unique vessel rows = **28**, not 48 (assuming no additional NMC referrals
  on new IMO values);
- Service Requests source count = **24**;
- PSC Port Calls source count = **24**;
- Total underlying inspection workflows = **48**;
- For each shared IMO: ONE table row, both source badges, two independently
  reviewable regimes, two source events.
- NMC live referral to an existing IMO ADDS source **without adding a row**.
- If the same source has multiple events for a ship, `sourceEvents` grows
  without adding a row or duplicating source badge.

The example count depends on the actual workbook IMO overlap; these counts
describe that test dataset, not a promise about the user's live Oracle state.

## Oracle migrations

**NO NEW DB MIGRATION REQUIRED FOR PR #57.**
This is an additive dashboard projection/UI fix, and does not update or
delete existing imported data. Existing migration 009 is required for the
base Candidate service; migration 011 (SI-P01 audit) is independently
required by parent PR #56 if using Oracle mode. Do not re-run existing SQL
migration files merely to fix the candidate list.

The PR is stacked on #56 → #55 → #54 → #53 → #52 → #51 → #50 → #49 → #48,
and is not merged by creation.

## Windows PowerShell — checkout without GitHub CLI

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# If status is non-empty, preserve local edits first.
git fetch origin pull/57/head:pr-57-unique-vessel
git switch pr-57-unique-vessel
git branch --show-current
```

## Docker — rebuild both API and UI

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy
```

If already using `compose.google-psc.yaml` on the POC, include it between
base and Oracle override in ALL compose calls. **Never** run
`docker compose down --volumes`.

## Business and visual verification

1. Open `http://localhost:4200/#/moei/smart-inspection/candidates` and
   perform Ctrl + Shift + R to refresh the Angular client.
2. KPI `UNIQUE CANDIDATE VESSELS` counts distinct IMOs, not individual
   inspection regimes.
3. Search for one IMO shared across Service and PSC workbook uploads; it
   occurs **once** in the table with Service + PSC badges (and optionally
   NMC, if a live approved referral exists).
4. Click `Review Vessel`; verify all original source references, filenames,
   Excel row numbers and batch IDs are retained under the vessel.
5. Click **PSC** workflow and **Service** workflow separately. Each has its
   own decision and status, and only selected regime can be approved.
6. Test one approval with approved Publisher authority: selected regime
   creates a case; the other remains pending. Unique vessel count stays one.
7. Source and status filters should show matching **ships** and not reintroduce
   duplicate rows. Source count can be 2+ for one IMO.
8. AI rule preview also shows one physical ship per IMO while exposing
   distinct per-regime scores; no AI call is triggered by viewing the table.
9. Switch Arabic/English: same MOEI Header/Footer, RTL/LTR and white sidebar.
10. Restart `ai-proxy`: existing imported source events / NMC referrals
    are preserved, without DDL or data migration.

Automated Node tests cover overlap of NMC+PSC+Service (3 workflows/1 vessel),
deduplicated source events, correct summary and source counts, independent
human approval and reload.

## Rollback

Switch to previously verified branch/ref and rebuild `ai-proxy nmc`.
No SQL/data rollback; existing source events and cases remain untouched.
Do not delete or edit Oracle rows for this display issue. GitHub CI cannot
establish visual acceptance on the user's local deployment.
