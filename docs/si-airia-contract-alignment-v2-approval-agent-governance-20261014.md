# Smart Inspection — Airia 14 Oct contract alignment / V2 Approval / Agent-level Governance

**Authoritative references:** `MOEI_NMC_Partner_Airia_API_Guide(20261014-035328).pdf` §§1, 2.1, 4, 7b; `MOEI_Smart_Inspection_Agentic_AI_Business_Scenario_and_Integration_Specification_v1.0_20261012(3).docx` §§6–12 and 15–16.

## Transport — all structured AI agents
`POST https://api.mena.airia.ai/v1/PipelineExecution/{pipelineId}`, headers `X-API-KEY` (server-side secret), `Content-Type: application/json`; body `{"userInput":"<JSON.stringify(request)>","asyncOutput":false}`. Successful HTTP transport is NOT sufficient: parse the JSON execution result, validate scope, evidence and human-controlled status. Conversational SI / NMC / SDB pipelines return prose and must not be substituted into structured SI JSON routes.

| Agent | Airia pipeline UUID (guide §7b) | Request / response source | Must preserve |
|---|---|---|---|
| SI-C01 | `f0799e63-387e-44dd-a451-cdffef96ee0d` | SI Spec §6 (`candidates[]` and `recommendations[]`) | Exact candidateKey/IMO/regime/evidenceRefs; advisory; supervisor approves. **No mandatory `suggestedRank` in the documented C01 response.** |
| SI-S01 | `eee9e630-ec5c-4ad8-b23e-59119696f837` | §9 (`feasibleSlots[]` / `rankedOptions[]`) | Only source-verified `optionId`, matching `slotSetHash`, `bookingConfirmed:false`. |
| SI-V01 | `5006d8c4-f8b5-4811-b767-704daab16e6a` | §10 (case-owned scanned media / candidateFinding) | `officialFindingCreated:false`, inspector confirms. |
| SI-R01 | `d0efe143-96ee-4fc0-8f15-93cc81ac97d3` | §11 (confirmedChecks / report/CAPA draft) | Confirmed source findings, `requiresSupervisorApproval:true`, no official risk modification. |
| SI-X01 | `b82d5bb0-3e84-4265-b8ed-8eb38989b30f` | §12 (historical findings / flags) | Preserve evidence conflict until authorized verification. |
| SI-A04 | `bad751da-0e11-48fd-861d-5bde1afbbd8d` | §8 (dossier / focus overlay) | Mandatory checklist stays intact; optional scope requires review. |
| SI-P01 | No dedicated MENA pipeline confirmed; retired from current POC | §7 (approved-case ranking) | Do not use C01 to impersonate post-approval P01. |

**C01 observed adapter mismatch corrected:** earlier code required `suggestedRank: 1..100` for every `SELECT_RECOMMENDED`, although the published example (§6.2) only supplies `candidateKey, recommendation, confidence, reason, evidenceRefs, dataGaps`. That made otherwise well-formed agent suggestions fail validation. C01 now treats `suggestedRank` as optional legacy advice, never invents one and leaves statutory priority ordering to deterministic verified-ETD / reviewed-incident policy. The saved NMC `currentRisk.assessmentId` is included in `allowedEvidence` when it exists in the candidate source. No outside/model-invented references are admitted.

## SI_V2_PLAN_APPROVAL_INVALID root causes
Current repository V2 `approve-for-scheduling` calls `siBulkPlan.preview(planId)`, produces a whole selected-vessel roster, then `SiRollingPlanStore.approveForScheduling`. Previously the latter used a generic `SI_V2_PLAN_APPROVAL_INVALID` for: missing plan id/revision/actor/reason/source hash, **more than 40 vessels**, missing/duplicate IMOs, invalid rank, empty scopes and missing source events. This was misleading when approval was meant to freeze only a roster, not create the 40-case execution batch.

Replaced generic errors with:
- `SI_V2_PLAN_APPROVAL_INFORMATION_INVALID` (missing/invalid meta or reason)
- `SI_V2_PLAN_APPROVAL_NO_VESSELS`
- `SI_V2_PLAN_APPROVAL_ROSTER_LIMIT_500`
- `SI_V2_PLAN_APPROVAL_IMO_INVALID`
- `SI_V2_PLAN_APPROVAL_DUPLICATE_IMO`
- `SI_V2_PLAN_APPROVAL_RANK_INVALID`
- `SI_V2_PLAN_APPROVAL_REGIMES_MISSING`
- `SI_V2_PLAN_APPROVAL_SOURCE_REASONS_MISSING`

The roster-only approval cap is 500 vessels. Existing optimistic revision/source hash and human publisher authorization remain mandatory. Approval does **NOT** automatically create a regulatory inspection case, dossier, ERP booking or NMC closure. The UI preflights malformed ranks/scopes/evidence and displays bilingual errors.

## AI Governance per-agent sections
Navigation remains `http://localhost:4200/#/moei/settings/ai-governance`. Each named agent is a collapsible heading with the original backend settings. The grouped registry covers A01/A02/A03/A04, DQ-01, SI-C01/P01/S01/V01/R01/X01, Checklist Builder/Vision, Conversational SI, NMC Desk and SDB Journey. Shared provider, fleet scheduling, alerts and transport appear after agent sections. API credential rotation remains in the original secure write-only area. All keys/values, versioned backend settings endpoint, publish approval/cost controls and saved overrides are unchanged; only UI presentation changed. The registry integrity test fails if any setting is omitted or duplicated.

## Test and release checklist
```powershell
cd C:\Users\Admin\Oman-development-screens
git fetch origin
git switch --track origin/fix/si-airia-contracts-v2-plan-approval-20261014
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build ai-proxy nmc
docker compose @dc exec ai-proxy node --test test/si-agent-mock.test.mjs test/si-rolling-plans.test.mjs test/ai-governance-agent-sections.test.mjs
docker compose @dc ps
```
Run Angular build independently with the repository's documented npm command. Verify the V2 approval for 64 selected, source-backed vessels. Verify Arabic/English agent headings, retained published pipeline IDs, and a harmless non-cost setting edit/discard; **do not** enable any paid agent or rotate credentials as part of layout testing. Review actual Airia C01 execution response in a controlled provider test only after confirming pipeline ID/charged-call count.

**Migration:** No new database DDL migration. Existing Oracle 018 rolling-plan schema must already be installed. Scheduling approval 019 on another draft branch is unrelated, incomplete and must not be applied for this fix.
