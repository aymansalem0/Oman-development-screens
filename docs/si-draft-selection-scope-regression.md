# Smart Inspection Create Draft: source obligations vs plan selection limits

## Reported POC symptom
The Create New Plan screen returned `SI_DRAFT_MANDATORY_VESSELS_EXCEED_SCHEDULER_40` **before** starting the displayed 5-batch Airia C01 request.

## Root cause in the code (not yet confirmed for the user's live Oracle snapshot)
- Previous draft preflight counted all `candidate.requiredInPlan` records as one legally mandatory group.
- `requiredInPlan` may include verified **SERVICE_REQUEST** records when a legacy, uncapped selection policy remains active. Such requests were historically forced into every new plan; they are not by that fact approved **NMC_CASE** referrals.
- The 40-vessel guard is not the actual constraint solver's maximum: `proposeMaritimeBatchSchedule` accepts up to 500 unique IMOs. The published plan policy still independently caps plans at its authorized max (up to 50), and does not make all 500 eligible for one draft.
- Never infer the customer's actual NMC/service counts from the screenshot. Inspect the new source-backed Draft Scope widget after deployment.

## New preflight / business rules
The `GET /api/si/v1/agents/candidate-selection/preview` response includes a read-only `draftScope` with:
- unique eligible IMOs (separate from the 5 C01 batches, which cover candidate/regime workflows);
- approved, legally protected NMC referral IMO count;
- verified service-request IMO count;
- legacy service-request IMOs that the existing policy was forcing into each plan;
- published service cap and overall plan cap, revision and review state.

With an uncapped legacy policy and forced service requests, `Generate Candidates + Priority + Capacity` is disabled. A **PUBLISHER** must explicitly approve and publish `serviceRequestPlanCap` and `maxPlannedVessels` in **Smart Inspection → Settings → Targeting**, including reason. The initial POC proposal is service cap 4 and total 12, **not an automatic policy override**.

With a published policy but protected NMC referrals exceeding its plan max, the blocker is separately labelled for officer-led scope allocation across separately numbered plans. **No NMC referral is dropped or reclassified**, and no real AI calls, inspection cases, work orders, or ERP bookings occur at this stage.

## UAT
1. Load Candidate Center, click Create New Plan; verify counts before checking AI cost confirmation.
2. If old policy displays missing caps, open Targeting Settings, obtain authorized publisher review and publish intended 4/12 limits as appropriate; do NOT silently publish solely to clear an error.
3. Return and click `Reload Published Policy (free)`. Confirm published limits and that eligible service requests remain in the central candidate pool.
4. Explicitly consent to C01 batches; note that paid Airia requests start only after preflight succeeds. Do not retry an existing pending job.
5. Verify candidate, priority, inspector, visit-slot and exceptions are calculated in one integrated pre-save preview.
6. Check that genuine approved NMC referrals are never omitted from the plan solely to fit quotas; if they exceed the authorized plan max, stop for officer-scope review.
7. Check backend audit hashes, ERP staff/qualification reality, preview validation and supervisor approval separately. No destructive Oracle operations.

Regression tests: `ai-proxy/test/si-draft-selection-preflight.test.mjs`. Docker image runs these together with the existing integrated draft, NMC scheduling and candidate unit tests.
