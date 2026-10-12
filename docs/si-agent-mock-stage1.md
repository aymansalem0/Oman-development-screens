# Smart Inspection — internal AI MOCK stage 1 (12 Oct 2026)

This is **development wiring**, not a completed Airia integration or a MOEI regulatory decision. It adds source-aware deterministic test responses through the **same downstream response validators** that accept the eventual Airia output.

## Scope
| Agent | Existing business route | Mode MOCK | Does it change business state? |
|---|---|---|---|
| SI-C01 Candidate Selection (NEW) | `GET /api/si/v1/agents/candidate-selection/preview` and `POST /run` | Dynamic candidate keys + **fixed advisory rules/reasons**. NMC risk missing -> manual review. | NO: recommendation is not an APPROVE, DEFER or REJECT operation. |
| SI-P01 Approved Case Priority (EXISTING) | `POST /api/si/v1/prioritization/preview` then `POST /run` | Exact previous Airia schema `recommendations[]`. Protected rule tiers still enforced by existing backend. | Saves explicit mock run/history only; NO inspection approval. |
| SI-A04 Dossier / Optional Checklist (EXISTING) | `POST /api/si/v1/preparations/{caseId}/prepare`, `/generate`, `/review` | Exact existing A04 output fields; ONE clearly MOCK optional checklist suggestion. | Saves reviewable MOCK dossier only; optional additions still require human review and separate scope action. |

**Not yet implemented**: SI-S01 AI scheduling reranking, SI-V01 real photo upload/image analysis, SI-R01 report drafting, SI-X01 exception detection. Existing deterministic ERP scheduling remains operational and unchanged.

## Switch

`compose.yaml` defaults **only Smart Inspection AI** to `SI_AI_PROVIDER=mock`. NMC A01/A02 risk and incident paths do not share this switch. All mock calls execute inside Node and require **no Airia key**.

When ready **after provider response-contract signoff**, use `SI_AI_PROVIDER=airia`. The existing P01/A04 pathways then resume their previous real-gated pipelines. The NEW C01 pathway additionally requires:
- `SI_C01_ENABLED=true`, `AIRIA_SI_C01_PIPELINE_ID=<approved UUID>`, and `AIRIA_MENA_KEY` (never check into Git);
- explicit `confirmRun=true` **and** `confirmCost=true`;
- verified live schema compatibility. The backend accepts a provider adapter returning the same `recommendations[]`, and fail-closes on unknown candidates, evidence or illegal status.

### Safe local PowerShell steps

Only after a successful fetch + merge:
```powershell
$env:SI_AI_PROVIDER='mock'
$env:NMC_FLEET_AUTO_ENABLED='false'
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml',
      '-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```
Before recreating: inspect `docker compose @dc config --format json` for `SI_AI_PROVIDER=mock`, fleet auto false, incident auto false, and existing Oracle mode/secrets. Recreating `ai-proxy` is necessary for backend code changes; **do not recreate Oracle**.

### No-cost API verification
```powershell
$base='http://localhost:4200'
$key='<your existing Dashboard Editor key>'
$headers=@{'X-NMC-DASHBOARD-KEY'=$key}
Invoke-RestMethod "$base/api/si/v1/agents/configuration" -Headers $headers
$preview=Invoke-RestMethod "$base/api/si/v1/agents/candidate-selection/preview" -Headers $headers
$preview | Select-Object provider,eligibleCount,snapshotHash,externalCalls
```
Mock run **only if eligibleCount > 0**:
```powershell
$body=@{actor='si-poc-reviewer';confirmRun=$true;
        confirmCost=$false;expectedSnapshotHash=$preview.snapshotHash} |
        ConvertTo-Json
Invoke-RestMethod "$base/api/si/v1/agents/candidate-selection/run" `
 -Method POST -Headers $headers -ContentType 'application/json' -Body $body
```
The response should contain `provider=MOCK`, `externalCalls=0`, `status=ADVISORY_REVIEW_REQUIRED` and one recommendation per pending **inspection regime**. An empty or stale source returns an error rather than inventing ships. The UI route is `http://localhost:4200/#/moei/smart-inspection/candidates` under **Stage 1 — SI-C01**, before existing SI-P01.

### Trust boundaries
- No browser load, GET, map reset, source import, rule publish, or preview can generate a chargeable Airia request.
- Each C01 response is validated against the latest backend-source snapshot and source-provided evidence IDs.
- C01 mock results are **ephemeral**, kept in memory for local review only; the actual APPROVE/DEFER/REJECT continues to use the existing backend audit and role controls. A persistent, versioned agent run store should be added before production use.
- A04 never removes mandatory checks, never creates confirmed findings, and never silently adds optional items to the case.
- Mock outputs should **not** be presented as genuine intelligence, actual photographic findings or real provider cost data.
- The open feature branch is a Draft POC implementation and requires deployment/testing against the existing local Oracle and Google feeds.

## Automated regression
`node --test ai-proxy/test/si-agent-mock.test.mjs` from repo root **after installing ai-proxy dependencies**. CI runs this in the backend job, not in the Angular job. It covers no-cost preview, no-case-mutation contract, provenance/missing-data controls, stale snapshots, cost consent on real mode, forged evidence rejection, unchanged P01 response and validated A04 optional output.
