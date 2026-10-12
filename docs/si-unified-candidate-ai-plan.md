# Smart Inspection Candidate & Targeting — Unified AI Inspection Plan

Status: **POC development branch**, 12 Oct 2026. Not a production MOEI regulatory authority.

## Screen

Route: `http://localhost:4200/#/moei/smart-inspection/candidates`

The FIRST Smart Inspection screen now uses one workflow:
**Actual source-backed statistics → One consolidated candidate grid → AI selected / ranked vessels → Officer inline amendment → Explicit SI-C01 re-evaluation.**

No separate Stage 1 / Stage 2 panels, separate candidate grids, repeated tables, or unnecessary metadata sections.

Six compact statistics:
1. Active fleet (from saved NMC snapshot).
2. Assessed vessels (from NMC).
3. Expected candidate vessels (unique IMO from existing NMC referrals, service import and **PSC records explicitly selected into candidate targeting**).
4. AI recommended vessels (NULL / dash until C01 run; advisory).
5. Vessels included in the current planning list (after officer changes).
6. Official approved inspection cases (from existing supervised business decisions).

The grid is **one vessel per IMO**. Source events and distinct inspection types stay visible. Orders apply only to the *proposed planning list*, not actual inspection-case approvals.

## Backend

New protected endpoints:

| HTTP | Endpoint | Behaviour |
|---|---|---|
| GET | `/api/si/v1/inspection-plan` | Read source, last saved C01 advice, audited plan overrides and UI grid. **0 AI calls**. Editor key needed. |
| POST | `/api/si/v1/inspection-plan/rerank` | Explicit initial C01 evaluation OR one officer change, re-run C01, validate provider and server rules, then persist a new version and audit entry. Editor key needed. |

### Initial run request

```json
{
  "actor": "Inspection Officer",
  "expectedSourceHash": "<64-digit hash from GET>",
  "expectedRevision": 0,
  "confirmRun": true,
  "confirmCost": false
}
```

### Officer removes AI-recommended vessel

```json
{
  "actor": "Inspection Officer",
  "expectedSourceHash": "<source hash from last GET>",
  "expectedRevision": 1,
  "confirmRun": true,
  "confirmCost": false,
  "change": {
    "imo": "9328471",
    "selected": false,
    "requestedRank": null,
    "reason": "Confirmed port-arrival change requires removal from this proposed plan"
  }
}
```

### Officer adds vessel or requests a priority

```json
{
  "actor": "Inspection Officer",
  "expectedSourceHash": "<source hash from last GET>",
  "expectedRevision": 2,
  "confirmRun": true,
  "confirmCost": false,
  "change": {
    "imo": "9400409",
    "selected": true,
    "requestedRank": 2,
    "reason": "New operational evidence requires priority reassessment"
  }
}
```

The response includes `revision`, `sourceHash`, `aiRecommendedVessels`,
`selectedForPlan`, `externalCalls` and `rows`, each with `imo`,
`aiRecommended`, `planSelected`, `selectionOrigin`, `modelRank`,
`effectiveRank`, `selectionReason`, `priorityReason`,
`evidenceRefs`, `requestedRank`, `officerActor` and `officerReason`.

### Agent contract

**SI-C01** still uses its existing `SI-C01-v1` request / `recommendations[]`
envelope, extended to include `suggestedRank` (integer for recommended
candidates; null otherwise) and `priorityRationale`. MOEI officer's
requested rank is carried as a separate immutable human amendment with actor,
reason and timestamp; it must never be misrepresented as a pure model output.

Mock selection uses existing **approved NMC referrals with saved real risk and
evidence** and other source-backed **PSC/service candidate workflows meeting
the published targeting risk threshold**, strictly as advisory suggestions.
Candidates without saved risk or source evidence stay manual review.
The protected NMC tier ranks first; other selected vessels follow saved risk. The backend
enforces the protected NMC referral first-tier on every re-rank. Future Airia
responses must pass this same strict candidate key, evidence and priority
validation.

No initial C01 run, initial GET, refresh, filtering or expansion ever makes
a paid provider request. Each confirmed officer change makes one C01 call;
when `SI_AI_PROVIDER=mock`, `externalCalls=0`. In real Airia mode, another
explicit user confirmation sets `confirmCost=true`.

### Storage and production limitation

The proposed plan, revisions and bounded audit (`/data/si-inspection-plan.json`)
live in the **existing Docker persisted /data volume**, with atomic rename and
single-process concurrency/version guards. This is deliberately separate from
the existing Oracle-regulated `SI_INSPECTION_CASE` decision ledger. For
production/multiple replicas, migrate the plan & audit to an Oracle
transactional table and add full identity management. The UI describes these
as *AI planning recommendations*, not confirmed inspections.

The underlying PSC selection service intentionally keeps unselected port
calls in its PSC targeting pool. They are NOT yet all exposed on the unified
candidate grid: PSC must first be selected through the existing Publisher
quota control. This is a residual scope decision, not silently represented
as a complete set of every port call.

## Safety

- A candidate plan amendment is **not** an inspection APPROVE/DEFER/REJECT.
- The existing Publisher case approval and case preparation links remain
  available in the row's expandable detail.
- A model cannot manufacture IMO entries or source evidence, select missing
  risk automatically, bypass protected referral priority, or mutate published
  NMC policies / Oracle cases.
- Source revisions, and the plan revision both use optimistic concurrency.
- Missing saved NMC risk stays null, never zero.
- Provider failure causes **zero saved officer-plan mutation**.
- All C01 mock content must be labelled MOCK; no actual Airia reasoning claims.

## Tests
```powershell
node --test ai-proxy/test/si-agent-mock.test.mjs
node --test ai-proxy/test/si-inspection-plan.test.mjs
node --test scripts/test-si-unified-candidate-grid.mjs
node --test scripts/test-si-c01-visible-access.mjs
npm run build
```

Run Node backend tests after installing `ai-proxy` dependencies, or via CI.
Build & live Docker validation are separate from unit tests. Do **not**
recreate Oracle to publish this candidate screen.
