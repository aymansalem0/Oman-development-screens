# MOEI Smart Inspection — SI-C01 Configured AI Selection UAT

**Status:** draft / controlled UAT. Scope is the **Candidate Center (Pool B)**, the **published PSC Port Call event gate**, the **independent PSC + Saved Risk and UAE Flag selection rates**, and the **existing SI-C01 agent**. This procedure neither resets Oracle data nor authorizes a real inspection.

## Preconditions

- Use the PR #133 build only in a designated POC/UAT environment; retain the current deployed configuration until the test is approved.
- Check that the backend, Oracle `NMC_AI` schema and actual source feeds are available. Existing selected PSC Port Call events and approved NMC referrals must be visible in Candidate Center. No raw ship-register row becomes an inspection candidate merely because its flag is UAE.
- Sign in as an **authorized publisher** to publish policy versions, or **Editor** for read-only preview and explicit AI advice.
- Ensure the SI-C01 provider really is **AIRIA** before reporting live-AI findings; **MOCK** is a deterministic test fixture, never an actual maritime AI judgment.
- Do not enter, email or copy API keys, session cookies, user passwords, or complete personal/vessel dossiers into a support ticket.
- SI-C01 runs on AIRIA are expected in this POC. Explicitly trigger the run from Candidate Center after verifying the policy and source snapshot; the batch count is shown for completeness. Preview does not call Airia.
- Keep a copy of the current policy **version + exact configuration** before any approved publication. No SQL reset or `docker compose down --volumes` is needed.

## A. Read-only baseline

1. Open `/moei/smart-inspection/settings/targeting` and confirm the **four tabs** appear:
   **Eligibility & Selection**, **Priority Rules**, **AI Advisory Configuration**, **Policy Impact & Publishing**.
2. Read the current policy version and verify Pool **B** says **source-eligible Candidate Center vessels only**, never all ships registered under the UAE flag.
3. In **Eligibility & Selection**, record the draft **PSC + Risk %** and **UAE Flag %**. These are **independent vessel-level rates**; they are neither additive nor a replacement for the **earlier published PSC Port Call event gate**.
4. Set **Service Request Plan Cap = 4** and **Maximum Plan Vessels = 12** as POC defaults. These control the draft rolling-plan cohort, **not** regulatory eligibility or deletion of saved service requests. In **Priority Rules**, verify the protected two criteria: **earliest verified future ETD** followed by **highest current human-reviewed NMC incident severity**. A missing field does not authorize fabrication or a general vessel-risk execution rank.
5. In **AI Advisory Configuration**, confirm permitted signals, minimum confidence (0–1), source-grounded selection instructions and priority explanation instructions. Changing inputs in the editor does **not** publish.
6. Open **Policy Impact & Publishing** → **Preview Configured Policy Impact**. Record:
   - candidate distinct IMO count;
   - optional PSC eligible IMO count / PSC target cap;
   - optional UAE-flag eligible IMO count / UAE target cap;
   - approved NMC mandatory IMO count; verified service-request IMO queue and maximum service IMOs per current plan;
   - total-unique-IMO max (12), theoretical projection and unverified paths kept in source review;
   - policy version and source snapshot reference.
7. Check **integer floor rounding**: target cap = `floor(eligible distinct IMO × percent / 100)`. **Example:** 4 optional PSC IMOs × 15% = **0**. Do not silently raise the rate or pretend one vessel was selected.
8. Confirm preview **does not** call Airia, write a policy version, change a saved NMC assessment, create a case, or modify an approved plan.

## B. Authorized publication — separate operator action

1. Obtain ministry/business-owner approval for the proposed numeric rates. **15% PSC and 0% UAE are system defaults for editing, not published maritime regulations.**
2. Return to **Policy Impact & Publishing**, enter a specific business reason and select **Publish** only with Publisher authorization.
3. Confirm the policy version increments by exactly one, the new values are reloaded from the backend, and the old version remains in history/Oracle `SI_TARGETING_RULE_VERSION`.
4. Open Candidate Center again. The source-eligibility count must remain independently determined by published PSC event selection, approved NMC referrals and eligible service-request events. Publishing AI guidance does not manufacture or approve source events.
5. Any **previous SI-C01 snapshot** must be marked stale after publishing. Do not silently reuse an old AI proposal.

## C. Explicit SI-C01 AIRIA execution

1. Open **Smart Inspection → Candidate Center**, select/create an **editable draft rolling plan** and load its latest source snapshot.
2. Inspect readiness, missing saved vessel risk, verified ETD/incident data, and current provider type.
3. Click **Generate AI Selection & Priority**. The confirmation must show provider and **number of agent batches**. AIRIA is the intended POC provider; run it to obtain real AI selection, not just MOCK.
4. SI-C01 request **must** include `policyRevision`, `snapshotHash`, `aiAdvisory`, `configuredSelectionPolicy`, global `eligibleSelectionPool` caps, `pscQuotaPolicyRevision`, evidence-backed candidates, and unchanged per-candidate `outputContract`.
5. Response must provide one `SELECT_RECOMMENDED | DEFER_RECOMMENDED | MANUAL_REVIEW` recommendation per input candidate with `confidence`, `reason`, `evidenceRefs` and `dataGaps`. The backend verifies every candidate key/evidence reference and quarantines unsupported responses.
6. Inspect **SI-C01 Configured AI Vessel Selection Proposal**:
   - PSC selected IMO count **≤** published optional PSC cap;
   - UAE Flag B selected IMO count **≤** published optional UAE cap;
   - approved NMC referrals included **outside** all optional caps; **verified service requests remain in the pending source queue**, with at most four selected for this POC plan;
   - IMO overlap deduplicated **once**, with all original reasons retained; total vessel count **≤12** unless protected NMC obligations exceed the configured cap, which must become an explicit exception;
   - PSC optional candidate with **missing saved risk** stays outside AI auto-inclusion and is sent for review;
   - any below-minimum-confidence optional recommendation does not result in automatic selection;
   - quota-excluded AI proposals listed, not silently substituted by deterministic risk selections;
   - evidence IDs belong to the saved source snapshot; confidence is model output, not a statutory score.
7. Verify `mock:true` means **NO LIVE AIRIA ANALYSIS**, and the UI labels the fixture clearly. **Do not sign off an Airia test based on MOCK.**

## D. Plan/capacity integration — no regulatory approval in this UAT

1. Open **Plan Wizard** for the same draft: the **two selection rates** must be read-only and equal to published values.
2. Check that current C01 evidence-backed IMO selection reaches the draft roster and that an extra arbitrary optional vessel is not backfilled to reach the cap.
3. Review all NMC and Service Request reasons, even for vessels qualifying for both factors.
4. Run the **capacity context / preview** only. It must respect source hash, policy version and plan revision; changing policy or source data must require a fresh C01 run.
5. **Do not click final supervisor approval / issue work orders** as part of this selection UAT. That is a separately authorized step requiring verified workforce/ERP feasibility and Oracle readiness.
6. Confirm unchanged baseline counts for `NMC_CASE`, `NMC_CASE_AUDIT`, `NMC_ALERT`, `SI_INSPECTION_CASE` and work-order tables. Published policy versions and draft-plan evaluations are the only intentional mutations in a controlled live UAT.

## Failure conditions

- Published selection percent is overridden from browser-controlled draft sliders.
- UAE numerator/denominator includes any vessel **not** already eligible in Candidate Center.
- Raw, unselected PSC Port Call or an **UNVERIFIED-only** service request enters the C01 request.
- Quota counts use candidate regimes/events rather than distinct IMO, or protected NMC rows consume optional caps, or verified service requests are all forced into the same plan.
- A C01 recommendation with invalid/unproven evidence is shown as **verified selected**.
- A new policy version leaves the old AI result usable.
- Any preview, mock run or AI advice creates an official inspection case, approves a plan, updates authoritative NMC risk, or books ERP staff.

## Repository automated checks

```powershell
# Run in checked-out feature branch; no Oracle, Airia or production data accessed.
node --test ai-proxy/test/si-configured-c01-selection.test.mjs
node --test ai-proxy/test/si-c01-policy-lifecycle-uat.test.mjs
node --test ai-proxy/test/si-integrated-capacity-plan.test.mjs
```

CI: Angular Build + dashboard-backend regression + Windows Node 24 JSON persistence + Docker POC validation.

## Sign-off evidence to capture

Record environment (MOCK or AIRIA), timestamp, published version, service-request cap (4), total plan cap (12), remaining verified service queue, current PSC quota version, non-sensitive snapshot hash, pool denominators and caps, distinct AI-selected IMO count, mandatory count, overlap count, missing-risk count, verified/invalid AI-response counts, explicit AI call count, and proof that no official cases/work orders were created. If AIRIA cannot be reached or the run returns a contract-validation error, mark the live-agent step **NOT EXECUTED / FAILED**, not PASSED.
