# PR #56 — Smart Inspection SI-P01 AI Candidate Prioritization

## Business objective

After importing Service/PSC candidate feeds and receiving **live approved NMC referrals**,
the existing Candidate & Targeting Center lets ministry officers:
1. See official saved NMC risk **unchanged** (a missing risk stays missing).
2. Configure and publish **inspection-specific** weighting and trigger reasons
   in Settings → Inspection Settings → Targeting & Priority Rules.
3. Preview a **deterministic rule-based** priority order without spending AI tokens.
4. Explicitly authorize **one paid** SI-P01 Airia analysis to suggest ordering
   and evidence-backed explanations. Only pending review candidates are sent.
5. Review a permanently saved, provenance-linked advisory ranking before
   human **Approve / Defer / Reject**; never auto-create inspection cases.

### Important: NOT an official regulatory finding

The example operational weights and NMC/Service/PSC source-severity numbers
are **POC business defaults, not Ministry statutory rules**. Approved NMC
referrals are placed in a protected operational tier (not a claim of mandatory
PSC legal inspection). AI may change order **inside a tier only**; it cannot
overturn that protected order, redefine legal eligibility or official NMC risk.

## Data contract

Input to SI-P01: current **saved** candidate source events with IDs,
source references, port/ETA when available, vessel IMO/type, official NMC
risk **if assessed**, source assessment ID, active published policy version,
NMC risk revision, source provenance and exact allowed evidence references,
deterministic factors/score (partial if some evidence absent), and missing
factor list.

Published priority criteria (sum 100%): saved NMC risk 30, inspection
trigger 25, inspection history 20, timing 15, operational urgency 10.
Source trigger priorities (0–100): NMC approved referral 90, Service
Request 55, PSC Port Call 65. The values are editable, versioned and
Publisher-approved. No inspection-history or operational-urgency signal
is invented where the source lacks verified evidence. The arrival ETA from
PSC files is interpreted as **Dubai local (+04:00)**.

Expected structured Airia SI-P01 response:
```json
{
  "recommendations": [
    {
      "candidateKey": "<one exact key from input>",
      "suggestedRank": 1,
      "rationale": "A source-grounded explanation of priority",
      "evidenceRefs": ["<exact provided sourceEventId / eventKey / assessmentId>"],
      "dataGaps": ["MISSING_HISTORY"],
      "confidence": 0.84
    }
  ]
}
```
Every input candidate must appear exactly once, with unique ranks 1..N,
no foreign IDs, reason longer than 10 characters, bounded gap strings and
0..1 confidence. Incompatible/unsafe response → FAILED audit run, never
a fabricated valid priority. AI recommendations are NOT automatically
accepted as official findings.

**No vendor-provided SI-P01 pipeline ID has been verified.**
P01 is OFF by default and a real chargeable test requires agreement on this
request/response contract with Airia, a real tenant pipeline ID and API key.

## Files / changes

- `ai-proxy/si-ai-prioritization.mjs`: strict snapshots, provenance validation,
  hard-tier deterministic order, explicit on-demand AI execution, immutable
  result/failure history, stale fingerprint, no retries or background agents.
- `ai-proxy/migrations/011_si_ai_prioritization_history.sql`: new append-only
  `SI_AI_PRIORITY_RUN` Oracle table and audit index. Does NOT update any
  existing Oracle records.
- `ai-proxy/si-candidate-targeting.mjs`: extended published settings (five
  percentage weights + three source priorities), legacy policy compatibility;
  evidence context included for SI-P01; source NMC risk unaltered.
- `ai-proxy/server.mjs`: secured preview/run/status/history APIs.
- `src/app/pages/si-targeting-settings.component.ts`: priority and source
  settings controlled by business Publisher, sum-100 validation and impact
  preview.
- `src/app/pages/si-candidate-workbench.component.{ts,html,css}`: separate
  rule preview (no AI), explicit consent checkbox, run button, saved ranks,
  stale-warning, explainability/evidence and human decision unchanged.
- `ai-proxy/test/si-ai-prioritization.test.mjs`: mocked-contract regression
  tests; not a live Airia tenant test.

## API and roles

- `GET /api/si/v1/prioritization` — Editor key: latest result, stale flag,
  current snapshot and whether P01 is enabled (no AI).
- `POST /api/si/v1/prioritization/preview` — Editor key: current
  deterministic tier/rule order and `snapshotHash` (no AI, no writes).
- `POST /api/si/v1/prioritization/run` — Editor key, JSON:
  `{"actor":"Inspector Officer","confirmCost":true,"expectedSnapshotHash":"<preview SHA-256>"}`.
  Explicit call requires <100 candidates, current snapshot and enabled pipeline.
  On failure, saves FAILED run with no successful recommendation; do not retry
  blindly. A source/policy change before execution returns conflict without AI.
- `GET /api/si/v1/prioritization/history` — Editor key: last 15 audit records.
- Existing `/api/si/v1/rules/impact-preview` — Editor.
- Existing `/api/si/v1/rules/publish` — **Publisher only** with version and
  audit reason; never auto-invokes SI-P01.
- Officer **APPROVE** remains **Publisher only**.

## Windows PowerShell — PR checkout WITHOUT GitHub CLI

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# STOP and preserve local changes before switching, if status not empty.
git fetch origin pull/56/head:pr-56-si-p01
git switch pr-56-si-p01
git branch --show-current
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
```

## Oracle migration 011 — BACKUP, PREFLIGHT, APPLY ONCE

This PR **does require** additive **Oracle schema migration 011**, but
does not require data backfill or update/delete NMC historical data.

Apply after ensuring migrations 009/010 are deployed on this POC
installation. A **verified restorable Oracle backup** and DBA-approved
recovery plan are mandatory first. DDL auto-commits; `ROLLBACK` cannot
undo partially created objects.

From PowerShell:

```powershell
docker ps --filter "name=oracle-free-23"
docker cp .\ai-proxy\migrations\011_si_ai_prioritization_history.sql oracle-free-23:/tmp/si-p01-011.sql
docker exec -it oracle-free-23 bash
```

Inside container:

```bash
sqlplus -L /nolog
```

At SQL prompt, connect exactly as in the earlier successful migrations:

```sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SELECT USER AS USERNAME, SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
-- Expected: NMC_AI, FREEPDB1
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
  ('SI_CANDIDATE_EVENT','SI_INSPECTION_CASE',
   'SI_PREPARATION_DOSSIER','SI_AI_PRIORITY_RUN') ORDER BY TABLE_NAME;
-- Preflight: first THREE tables exist, SI_AI_PRIORITY_RUN MUST NOT EXIST.
SELECT COUNT(*) AS NMC_ASSESSMENTS_BEFORE FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS RISK_PROJECTIONS_BEFORE FROM NMC_RISK_POLICY_PROJECTION;
SELECT COUNT(*) AS SI_CASES_BEFORE FROM SI_INSPECTION_CASE;
-- Only after confirming restore-capable backup and all prerequisite tables:
@/tmp/si-p01-011.sql
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME='SI_AI_PRIORITY_RUN';
SELECT COUNT(*) AS P01_RUNS FROM SI_AI_PRIORITY_RUN;
SELECT COUNT(*) AS NMC_ASSESSMENTS_AFTER FROM NMC_AI_ASSESSMENT;
SELECT COUNT(*) AS RISK_PROJECTIONS_AFTER FROM NMC_RISK_POLICY_PROJECTION;
SELECT COUNT(*) AS SI_CASES_AFTER FROM SI_INSPECTION_CASE;
EXIT
```

Initial `P01_RUNS = 0`. Existing before/after counts match. If the
new table exists already, **STOP — do not rerun** migration. On any
`ORA-` error, stop, inspect possible partial DDL, involve the DBA.

## Docker rebuild — both proxy and Angular

```powershell
# In .env, safe baseline:
# NMC_DB_MODE=oracle
# NMC_FLEET_AUTO_ENABLED=false
# SI_P01_ENABLED=false
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=120 ai-proxy
Invoke-RestMethod http://localhost:4200/api/ai/health
```

When Airia provisions an actual SI-P01 pipeline **and its response contract
is verified**, set these in PRIVATE local `.env`:

```dotenv
SI_P01_ENABLED=true
AIRIA_SI_P01_PIPELINE_ID=<REAL-UUID-FROM-AIRIA>
AIRIA_MENA_KEY=<PRIVATE-SERVER-SIDE-TOKEN>
```

Then recreate only the proxy:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml up -d --force-recreate ai-proxy
```

With `SI_P01_ENABLED=false`, policy publishing, rule preview and normal
candidate decisions remain available but the paid AI run is disabled.

If your existing stack uses `compose.google-psc.yaml`, insert
`-f compose.google-psc.yaml` after base and before Oracle in **every**
Compose command. **Never use `docker compose down --volumes`**.

## Acceptance tests

1. Settings → Inspection Settings → Targeting & Priority Rules: adjust five
   weights (must total 100); edit per-source reason priorities; Editor
   previews; Supervisor publishes with reason. NMC Risk/AI scores unchanged.
2. Candidate & Targeting Center: enter Editor key in Operator & Access.
   Click `Preview Rule Order (No AI)`, verify no Airia usage and that the
   known NMC approved referral retains protected tier.
3. Verify **missing risk remains NULL**, not 0; partial score is clearly
   labeled provisional; no made-up inspection-history signal.
4. With P01 off, disabled AI button and clear configuration message.
5. Once Airia pipeline is configured, authorize exactly one test call,
   check returned candidate-key coverage, unique suggested ranks and
   evidence references. Invalid foreign references fail closed in audit.
6. `AI Rank / Advice` appears in candidate queue. Click Review for
   rationale, evidence IDs, gaps and human action.
7. Re-import source Excel or publish different weights: saved run shows
   `STALE` and is **not used** to sort candidates until a new explicit run.
8. Review/approval rules unchanged: SI Case only after Publisher decision,
   no auto-referral, no auto-inspection or findings.
9. Refresh and restart proxy: immutable history is preserved in Oracle.
10. Check Arabic/English and RTL/LTR under shared MOEI platform theme.

## Rollback

Rollback UI/backend separately to a known-good previous Git ref and rebuild
`ai-proxy nmc`, preserving all volumes. Do **not** drop `SI_AI_PRIORITY_RUN`
or existing data without a DBA-approved recovery plan. A paid Airia request
is not refundable if remote API execution occurred.

GitHub CI proves Angular build, JS syntax, backend mock regressions and Docker
POC startup; it cannot prove the user's local Oracle migration, a live
Airia tenant contract or real-browser acceptance.
