# MOEI Smart Inspection — POC Business Completion & UAT Runbook
**Date:** 13 October 2026 · **Branch:** `feature/si-poc-business-completion-20261013`
**Status:** Draft UAT; provider contract mocks explicitly identified. No production regulatory release.

## 1. Basis / acceptance criteria
Source: `POC_Business_Case__Smart_Inspection(5).docx` (MOEI, 3 pages).
The brief calls for the future state from targeting to follow-up, field evidence, report, exceptions, a new category-specific mandatory check, and management visibility. It explicitly permits synthetic data and simulated unavailable external integrations, provided assumptions are stated. That permission **does not** mean POC mocks are real AI.

| Requirement | Demonstration route | Nature |
|---|---|---|
| Identify/prioritize eligible vessels | Candidate & Targeting → Create Rolling Plan → available vessel grid → optional C01 | Current NMC/PSC/Service candidate sources, versioned manual choices; MOCK C01 default; Airia only when confirmed and configured |
| Inspection preparation | Approved Plan wizard → SI-02 dossier → A04 | Existing deterministic dossier; A04 MOCK when SI provider mock, Airia conditional |
| Dynamic checks | Dynamic Inspection Checklists → author/publish category rules → inspector run | Existing Oracle 017 revisioned checklists (ship type/GT/DWT/regime/source scope) |
| Assign and schedule | Electronic Scheduling / Lifecycle assignment | Existing NMC confirmed booking or clearly labelled POC manual assignment; S01 mock preview only |
| Field checks/evidence | Dynamic Checklist execution + Lifecycle | Structured results, private image evidence in existing checklist module; metadata lifecycle; offline mobile sync not implemented |
| Findings/classification | Lifecycle field save/report + V01 mock | Human-confirmed findings, severity and evidence IDs; V01 explicitly no CV/media analysis |
| Reports/follow-up/closure | Lifecycle report approval, CAPA, verification, follow-up, close | Existing supervisor gates and audit; R01 drafts only, never official |
| Compliance impact | Lifecycle closure / cross-domain follow-up note | Closure tracked; **not automatic** NMC risk, regulatory enforcement or cross-domain updates |
| Management insight | Smart Inspection Management dashboard | Existing case metrics, findings, repeated issues |
| Non-happy-path: recurring deficiency, expiring certificate, conflicting new evidence | Lifecycle → X01 → checkbox **Synthetic exception scenario** | Three distinctly labelled SAMPLE alerts; inspector must verify actual files and history; never creates official deficiency |
| Change challenge: new mandatory item for a vessel category | Dynamic Checklist settings → publish applicable template → start selected inspector checklist | Business-configurable conditions; human publish gate, no code migration |

## 2. Rolling planning semantics (SI-01)
- Creating a plan is **no-cost** and immediately stores an Oracle 018 DRAFT containing a snapshot of the currently **eligible pending** C01 candidate keys, source-event IDs and risk references. It does not run an agent.
- The page immediately displays vessel candidates. `Available` can exceed `Selected`; zero selected is a valid newly created draft, **not** an empty source pool.
- The officer may `INCLUDE`, `NOT_SELECTED`, `DEFER` with next-review date, or `NOT_APPLICABLE` with auditable reason. The last action is blocked for protected approved NMC mandatory referrals. A plan-scoped disposition does not delete a source event or constitute a legal PSC rejection.
- A new plan (even on the same day) reads the **latest legitimate candidate pool**. Vessels not selected before remain eligible; previous explicit dispositions and review-after dates are carried forward with prior plan ID. A future deferral prevents automatic C01 selection until due; an officer can explicitly override with a new reason.
- C01 can be explicitly run **on the pending maritime candidates now available**, not yesterday's already-approved cases. Its `SI-C01-v1` request/response is validated by the existing candidate agent. It can suggest inclusion and priority but **never** approves or changes the official NMC score.
- A manually selected plan can be officially approved **without C01**. A C01-assisted plan can also be approved. The four-step wizard obtains the latest source events and refuses duplicate previously approved reasons or stale selected evidence.
- Supervisor approval creates actual SI Inspection Cases; SI-02 is deterministic. Optional A04/P01 follow their existing modes and must be consented to when paid.
- Frozen approved vessel rows, all source event IDs and complete plan history stay unchanged when tomorrow's candidate pool changes. Linked cases run until closure; the plan does not auto-close at midnight.
- No `Port` field in plan creation; existing Oracle nullable PORT column is preserved as historical schema compatibility only.

## 3. Agent inventory and exact integration boundary

| Code | Business role | Current backend | Response contract | Safety |
|---|---|---|---|---|
| NMC A01/A02/A03 | Saved risk / incidents / validated documents | Existing NMC real integrations as configured | Original NMC/Airia integration | Do not trigger fleet auto during demos; role/cost controls |
| SI-C01 | **New plan vessel inclusion and priority** | Existing SI-C01 agent, MOCK default or controlled Airia endpoint | `SI-C01-v1` input; `recommendations[]` validated against live source candidate keys, risk/evidence | Only explicit run; AI advisory; human choose/approve |
| SI-P01 | Order already-approved SI cases | Existing SI-P01 with MOCK or controlled Airia | `SI-P01-v1` `recommendations[]` + rule tiers | Does not overwrite NMC Risk |
| SI-A04 | Case-specific dossier/scope assistance | Existing deterministic preparation + A04 MOCK/controlled Airia | Existing A04 `focusAreas/checklistFocus/suggestedAdditionalItems` | Inspector must review suggested additions |
| SI-S01 | Scheduling suggestions | New provisional backend response | `SI-POC-ADVICE-v1-PROVISIONAL`, `advice[]` | Suggests obtaining ERP slot, **does not assign** |
| SI-V01 | Field evidence prompts | New provisional backend response | Same `advice[]` | **No actual image recognition**, references metadata |
| SI-R01 | Report draft | New provisional backend response | `advice[]` + `draft` derived from human findings | No write to official report |
| SI-X01 | Exception / escalation demonstration | New provisional backend response | `advice[]`, synthetic marker per sample item | Requires explicit simulation checkbox; no false verified deficiency |

**Important:** Airia has **not supplied approved response schemas** for S01/V01/R01/X01. The provisional JSON response is a **new internal POC contract**, not a claim of Airia compatibility. No real external network/model call is made by these four services, irrespective of `SI_AI_PROVIDER`. It must be replaced/revalidated once provider docs arrive. Current real-provider integrations may only be enabled after confirming exact request/response, pipeline IDs, legal/cost approvals and robust contract tests.

`GET /api/si/v1/advisors/coverage` — contract coverage read-only.
`POST /api/si/v1/lifecycle/:caseId/advisors/SI-S01/run` (or SI-V01 / SI-R01 / SI-X01) — synchronous mock; source is **persisted approved case snapshot**; human session and CSRF required. `{"scenario":"RECURRING_DEFICIENCY_CERT_EXPIRY_CONFLICT"}` only for explicit X01 SAMPLE. All return `provider:"MOCK"`, `simulationLabel:"MOCK_POC_NOT_REAL_AI"`, `externalCalls:0`, `caseMutations:0`, and `regulatoryDecision:false`.

## 4. Safe Windows PowerShell rollout to existing local Oracle

**Precondition:** Confirm a restorable backup of Oracle FREEPDB1 NMC_AI and the existing Docker `/data` named volume, as well as a clean working tree. The branch builds atop existing checklist Oracle migration 017 and rolling migration 018; they were *already* confirmed as READY in the user's existing local environment. No new SQL migration is required.

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
git fetch origin
git switch --track origin/feature/si-poc-business-completion-20261013
# If branch already exists: git switch feature/si-poc-business-completion-20261013
# and git pull --ff-only

# Disable accidental real AI; saved LIVE runtime settings may override env!
# In AI Settings & Governance, publish NMC_FLEET_AUTO_ENABLED=false,
# NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false and SI_AI_PROVIDER=mock for UAT.
Invoke-RestMethod http://localhost:4200/api/ai/health |
  Select-Object status,fleetAutoEnabled,persistenceHealthy
# Require fleetAutoEnabled = False before cost-sensitive UAT.

.\scripts\si-rolling-docker.ps1 -Action Build
.\scripts\si-rolling-docker.ps1 -Action Preflight
# Expect Oracle 018 READY (45 tables / 26 indexes).
.\scripts\si-rolling-docker.ps1 -Action Start -BackupVerified
.\scripts\si-rolling-docker.ps1 -Action Verify
```

**Stop** if Oracle readiness fails, backups are unverified, fleet auto is unexpectedly enabled, or NMC/Checklist health fails. Never run `docker compose down -v`, never delete or recreate Oracle, do not remove or overwrite existing `/data`. **Do not run Migration 018 again just to fix application code.** Confirm your current Compose override files and domain-specific secrets were preserved.

## 5. Browser end-to-end business UAT (Admin session)
1. Open `http://localhost:4200/#/moei/smart-inspection/candidates`; check Active Fleet, available sources and Oracle status. Authenticate in the same browser.
2. Click **Create New Plan**, enter **POC Test 01** and dates, save. Do not select a port. Verify a numbered DRAFT in plan history and **eligible vessels already visible**, with `Selected=0`. Do not run AI yet.
3. Choose a pending source-backed vessel with NMC or eligible PSC/Service reason; **Include**, enter an auditable 8+ character reason. Check `Selected=1` and READY_FOR_APPROVAL, still `agentRunId=null`. Optionally choose another as **Defer** with future review date. For a nonmandatory source, demonstrate **Not Applicable**; for mandatory NMC, show it is blocked.
4. Create **POC Test 02** on same day. Verify Test 01 is intact; deferred vessel visible with previous plan reference, date and reason (if source still eligible); other never-selected candidates remain available.
5. In Test 02, select **Generate AI Selection & Priority** **explicitly**. With SI_AI_PROVIDER=mock the backend applies C01 shape-compatible deterministic recommendations (NOT real model analysis), using **today's pending source set**; review proposed ranks and human changes. If there are no eligible source-backed vessels, correct source ingestion; never invent a vessel.
6. Open Review & Approve Wizard for Test 01/02 after valid selection. Inspect all referral reasons, regime scopes and optional A04/P01. Choose no paid calls for first UAT. Supervisor confirms whole plan. Verify batch executes and creates actual approved SI inspection case and SI-02 evidence dossier. Reopen prior plan to verify frozen snapshot.
7. Open Preparation Queue → case → dynamic checklist. Review published mandatory vessel-category template, add/upload a safe test image only according to privacy controls, and have inspector accept/reject AI suggestions manually.
8. In **Full Inspection Lifecycle**, initialize case when prep ready; scope approval; assignment/booking (NMC confirmed or labelled POC manual); inspector start; complete checks and evidence refs; submit human findings; review/approve report; issue corrective actions, verify, follow up, close. Do not skip role gates.
9. In the Lifecycle **POC Advisory Response Simulator**, run SI-S01, V01, R01 and X01. Show the clearly labelled MOCK responses and no database mutations. For Exception Challenge, explicitly check synthetic scenario and run X01; show the three SAMPLE alerts.
10. In Dynamic Checklist Settings, draft/publish a new mandatory inspection check for a particular vessel category and inspect an **eligible newly-started** case; verify applicability and immutable revision history. Do not rewrite the mandatory scope of an already frozen field run.
11. Open Smart Inspection Management to show current workload, findings, closed cases and repeat issues; verify all case IDs and source event keys remain traceable. Risk reassessment/cross-domain compliance update is only a proposed, not automated, step.

### Read-only verification / operational gates
```sql
SELECT PLAN_NO,STATUS,START_DATE,END_DATE,VERSION_NO
FROM SI_PLAN_ROLLING ORDER BY CREATED_AT DESC;
SELECT PLAN_ID,IMO,CASE_ID FROM SI_PLAN_ROLLING_VESSEL;
SELECT PLAN_ID,IMO,EVENT_KEY FROM SI_PLAN_ROLLING_REASON;
```
No Oracle DDL or DML required for this verification.

## 6. QA and limitations
- Specialized tests:
  `node --test ai-proxy/test/si-rolling-plans.test.mjs ai-proxy/test/si-rolling-endtoend.test.mjs ai-proxy/test/si-rolling-oracle.test.mjs ai-proxy/test/si-poc-workflow-advisors.test.mjs`.
- GitHub Actions `SI Rolling Inspection Plan Regression` and **actual Angular build** need to pass on the final commit. Existing NMC Dashboard / case-workspace tests are independent gates; do not dismiss them silently.
- **Real Oracle + browser UAT on the user's PC is not yet performed by a remote code commit.** GitHub passing does not deploy.
- Mobile native offline synchronization, AI photo authenticity/vision, full file evidence chain-of-custody, official maritime regulations/enforcement, cross-domain vessel compliance handoff and live Airia contracts for four future assistants remain beyond this mock-enabled POC. These must **not** be shown as delivered production capabilities.
