# SI-01 Inspection Plan Wizard — Preserve All Source Reasons (v2)

**MOEI Business Design Update · 13 October 2026**

This change supersedes the previous inline "Approved Inspection Regime" dropdown / batch v1. The rule is simple:

> If one vessel is referred for inspection for two or more independent reasons, all of the verified reasons MUST be included automatically in its approved inspection scope. The supervisor must not choose one and discard the others.

## 1. User journey

**Inspection Candidate & Targeting** stays a monitoring/AI-planning screen with one vessel row per IMO. Its **Create Inspection Plan** button opens a **separate route**:

`/#/moei/smart-inspection/plan/create`

This route is a four-step business wizard:

| Step | Purpose | Main fields |
|---|---|---|
| **1. Selected Vessels** | Verify all vessels selected by the saved C01/officer plan, including effective ranks | IMO, name, priority, referral count, count of inspection scopes |
| **2. All Referral Reasons** | Expand a vessel to see **all** triggering NMC/PSC/Service Request events, deduplicated by eventKey | Source type, source reference, actual source reason or "not provided", evidence references, inspection regime |
| **3. AI & Preparation** | Present the post-approval work without confusing AI with legal approval | Mandatory baseline SI-02 preparation, optional A04 AI dossier, optional P01 execution-priority recalculation; AIRIA requires cost consent |
| **4. Review & Approval** | One supervisor decision for the **whole current selected plan** | Count of vessels, total reasons, total source-specific scopes, approval notes, and **Approve Full Plan & Create Dossiers** |

The wizard shows **no inspection-regime dropdown** and does not allow discarding a source trigger as a side-effect of approving the plan. To change which vessels enter the plan, the user returns to the existing Candidate & Targeting grid and records a normal audited operator inclusion/exclusion/rank change.

## 2. Provenance and data contracts

For every selected IMO, the backend reads all eligible `dashboard.candidates` groups for that vessel (including multiple regimes). It collects **all related source events** and deduplicates on source eventKey while retaining:

- `sourceType` / `sourceEventId` / `sourceReference`
- `candidateKey` / `inspectionRegime`
- `reason` (existing source note, nullable — never generated or invented)
- `sourceApproval` and `sourceProvenance`
- `evidenceIds` source references.

The shared approved-plan batch has **one vessel-level inspection case per IMO**, with arrays:

`candidateKeys[]`, `regimes[]`, `inspectionReasons[]`, `inspectionScopes[]`, `sourceEventKeys[]`, and `approvedPlanId`.

The `regime` field remains for backward-compatible consumers as a primary routing label chosen deterministically (an approved NMC referral receives precedence), but **does not filter out other regimes** or override their independent statutory obligations. Each preserved `inspectionScope` keeps its original event keys and `requiresRegulatoryReview=true`.

**IMPORTANT:** The coordinated SI POC preparation case can unify field inspection work, **not** magically combine or eliminate distinct regulatory authorizations. Production statutory regime cases/decisions must remain separate wherever legally required.

## 3. Atomic approval and error behavior

`POST /api/si/v1/inspection-batches` accepts no `choices` array. A request attempting to choose a single source is rejected. The backend re-fetches real stored candidate source events (it does not trust browser-provided reasons), validates every reason against the saved C01 version/hash and **atomically commits one case per selected vessel in Oracle**. It also saves each vessel's source reasons and legal scope breakdown.

The old single-vessel endpoint `POST /api/si/v1/candidates/decision` refuses `APPROVE` with `SI_APPROVAL_REQUIRES_COMPLETE_PLAN` (409). Existing DEFER/REJECT actions remain available, but cannot approve a single reason behind the complete-plan wizard.

After case approval, the job builds the SI-02 base dossier for every case. Its context includes all `inspectionReasons`, all `inspectionScopes`, and `sourceInspectionObjectives` (one verifiable field objective for each source reason), plus all referenced evidence IDs. The base checklist remains protected; A04 receives these complete source reasons and can produce additional **draft** focus recommendations subject to human review. P01 may recalculate actual execution priority after cases exist.

**Safeguards:** stale plan → 409, missing or invalid source → approval blocked, incomplete dossier → job PARTIAL with real case ID, no automatic schedule/detention/report approval. AIRIA A04/P01 uses explicit configured and confirmed cost settings. No paid AI on GET.

## 4. Local POC instructions (Windows PowerShell)

```powershell
git status --short
git fetch origin
git switch --track origin/feature/si-inspection-plan-stepper-20261013
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```

Keep existing local Google OAuth settings, previously installed optional login artwork, Docker volumes and Oracle databases unchanged. **Do not run `docker compose down -v`.** Requires already reviewed Oracle migrations 009 and 010 for case/dossier use (P01 needs its existing migration if enabled).

1. Open `http://localhost:4200/#/moei/smart-inspection/candidates` and check current C01 plan.
2. Click **Create Inspection Plan**.
3. Review **Selected Vessels → All Referral Reasons → AI & Preparation → Review & Approval**.
4. Enter a source-grounded plan approval note and confirm once.
5. View progress and open **SI-02** for any approved case.

**Still separate:** Hybrid event/scheduled C01/P01 re-evaluation discussed earlier must be implemented separately, and real AIRIA model calls require verified connected provider configuration.

## 5. Regression coverage

- One IMO with two separately valid source reasons has exactly **one selected vessel row, two reasons and multiple preserved scopes**.
- Backend approval **never requires or accepts picking one regime**. All case source keys are saved and the non-primary group is marked linked/handled.
- One supervisor approval batch commits all selected vessel cases or none.
- SI-02 dossier stores every source trigger and turns each into a separately traceable field inspection objective.
- Existing approved cases and AI drafts remain individually reviewable. An unsuccessful A04 creates an explicit partial-work state without reversing legal approval.
