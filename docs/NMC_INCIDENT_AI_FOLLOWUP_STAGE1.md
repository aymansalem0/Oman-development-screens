# NMC POC — Incident AI with UNCHANGED A01 / A02 Request and Response

## Final business decision
**Use the exact existing A01 and A02 Airia pipelines and their current input/output structures.** There is no new Agent, prompt, pipeline ID, incidentTriage JSON object, incidentCompliance JSON object, separate model or additional Airia credentials.

- A02 is invoked in its **existing fleet-signal mode** (`requestedSignals: ['inspection','certificate','dataQuality']`) and must reply with the **existing `signals` array**, not a new compliance status.
- A01 is invoked in the **existing `SITUATION_ASSESSMENT` mode** (`requestedOutputs: ['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS']`) and must reply with the **existing `summary`, `whyItMatters`, `evidence`, `proposedActions`** contract.
- Requests retain the **exact existing top-level JSON properties** for the respective modes. The report is supplied as *unverified source evidence* inside the already-supported inputs: A02's `inlineContext.incidentReports`, and A01's `approvedSignalEvidence` history item `reason` plus a sourced `evidenceId`. The original stored vessel factors/severities are not changed; the augmented context is request-only.
- Because even a valid response might ignore the report, **A01 must cite `INCIDENT-<Incident_ID>` in the original `evidence[*].evidenceIds` or `proposedActions[*].evidenceIds`**. Otherwise the backend refuses to save a claimed AI-grounded incident assessment (`INCIDENT_A01_DID_NOT_CITE_REPORT`). The unverified source text is treated as data, never instructions.

This is business-data augmentation in an existing flexible context/evidence collection, **not an Airia request/response schema change**. If the current Airia prompt ignores the additional evidence, we cannot claim a live incident AI analysis succeeded merely because the call returned 200; the citation guard will correctly block it. We have not changed the actual Airia prompts.

## Workflow

```text
Google Sheet Incident_Registry (port / reporting-platform incident)
  → exact IMO link + original source description and status
  → already completed and SAVED A01/A02 vessel assessment + evidence bundle
  → existing A02 fleet-signal request → EXISTING signals response
  → existing A01 SITUATION_ASSESSMENT request → EXISTING recommendations/evidence
  → verify A01 actually cited the incident report evidence ID
  → NMC deterministic INCIDENT policy (source type/severity/location +
     existing A01 priority/action, explicit recurrence terms)
  → separate Incident Risk Score 0–100 and pending follow-up recommendation
  → human Accept / Modify / Reject with written reason
  → append AI provenance and human review rows to AI_Assessments
  → visible in Incident Intelligence / Command Center Requires Attention
```

### Independent Incident Risk Rules, NOT model-produced incident risk
The existing A01/A02 output does not contain numerical incident risk factors. The backend therefore derives 0–5 `impact`, `urgency`, `exposure`, `recurrence` **deterministically**, from unverified source facts and existing A01 recommendations. The existing A02 compliance signal factors are **vessel context only**, not proof of an incident-related legal violation.

`IncidentRiskScore=round((35×impact + 30×urgency + 20×exposure + 15×recurrence)/5)`

The source incident type and source-reported severity inform impact; reported type/priority inform urgency; whether a location was supplied informs exposure; recurrence is recognized only if the incident text explicitly mentions repeat occurrences. Missing information is flagged; unknown is never treated as verified low risk. Score bands: LOW 0–24, MODERATE 25–49, HIGH 50–74, CRITICAL 75–100.

This score is **NMC policy derived**, with A01 informed action mapping, **not a risk number produced directly by Airia**. Never combine it automatically with the original saved A01/A02 Vessel Overall Risk (e.g., 60/100).

Existing A01 `proposedActions` map to the NMC follow-up catalogue, for example `PRIORITY_INSPECTION→REFER_SMART_INSPECTION`, `ENHANCED_MONITORING→ACTIVE_MONITORING`, and `VERIFY_CERTIFICATE→VERIFY_INFORMATION`. Unknown action codes default to **VERIFY_INFORMATION** instead of legal enforcement. Officer review remains mandatory. A suggested inspection is a *pending recommendation*, not a dispatched inspection request.

## Google Sheet storage (unchanged original source records)
**[NMC POC Maritime Incident Sources & AI Triage](https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit)**

`Incident_Registry` remains the source-of-truth for `Incident_Description`, `Source_Incident_Status`, `Operational_Status`, `Reported_Severity`, `IMO` and opt-in `AI_Review_Request`. It is never overwritten by A01/A02.

`AI_Assessments` retains existing 32 columns for internal NMC recording. Columns H-K are renamed **Policy_Impact / Policy_Urgency / Policy_Exposure / Policy_Recurrence** to avoid claiming Airia output these numbers. Columns AB–AF retain existing audit/provenance fields but contain **A01 legacy evidence citations, A02 vessel signal context, and adapter contract label `A01_A02_EXISTING_CONTRACTS_V1`**. These columns belong to *Google Sheet storage*, **not extra Airia JSON output**. Officer approval appends an additional row without changing A01 recommendation or the source incident status.

## Configuration and demo
Use the same existing `AIRIA_MENA_KEY`, `AIRIA_A01_PIPELINE_ID`, `AIRIA_A02_PIPELINE_ID`, and `NMC_A01_ENABLED` / `NMC_A02_ENABLED` as normal vessel assessment. No Airia settings changes or additional environment variables are needed for manual assessment. Source Google Sheet is shared with the existing PSC Google service account as Editor.

```powershell
git fetch origin
git switch --track origin/feat/nmc-incident-existing-a01-a02-contracts-20261011
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml up -d --build --force-recreate ai-proxy nmc
```

1. Confirm `GET http://localhost:4200/api/ai/nmc/incidents/health` reports `sourceConfigured:true` and `aiConfigured:true` (this checks switches and key only, not live inference).
2. Open `http://localhost:4200/#/moei/nmc/incidents`; use a report with an IMO that has a **completed saved A01/A02 vessel assessment**.
3. Click **Analyze with AI**, explicitly confirm the **two** possible billable Airia calls.
4. If A01 cites incident evidence, verify the separate NMC policy score, original A01 action rationale, A02 vessel signals, and pending follow-up.
5. Accept/Modify/Reject as an officer with a written reason. Verify two append-only rows in the Sheet and that `Incident_Registry.Operational_Status` / saved vessel score are unchanged.
6. Confirm the incident in Command Center's **Requires Attention Now** and its severity-colored map marker.

Optional scheduled automatic analysis remains OFF by default and MUST be deliberately enabled via `NMC_INCIDENT_AUTO_TRIAGE_ENABLED=true` after manual success and source opt-in `AI_Review_Request=YES`. It uses two Airia calls per incident, with cap/interval configured in `compose.incident-google.yaml`.

## Validation/limitations
A V8 in-memory test validates that A02 uses the current fleet-signal property set, A01 uses the current situation-assessment property set, both receive the report in existing evidence/context fields, A01 must cite it, original vessel score is unchanged, and separate score/follow-up are derived. The full Node suite, Angular build, local Docker and live Airia incident demonstration are **not yet verified**. If the live pipelines do not cite additional incident evidence in their normal response, manual review remains required; don't silently invent model analysis.

No automatic maritime enforcement, incident confirmation, actual case creation, legal restrictions or Smart Inspection referral is implemented in this stage.


## Stage 1B — Automatic intake + central Case Management (current)
**Supersedes earlier manual Analyze/Approve UI instructions above.** The user requested that incident triage start automatically when a Google Sheet source row arrives, and all officer action decisions be managed inside the same NMC Case Management system.

### Runtime behavior
- With `compose.incident-google.yaml`, the incident worker starts **automatically on backend startup** and polls every **5 minutes**. It processes up to **3 opted-in reports per cycle** (`AI_Review_Request=YES`). Each previously unassessed case uses exactly A02 then A01 with their existing schema, up to two Airia calls per incident. Existing saved assessments are reused; a browser refresh never triggers AI.
- The worker skips already assessed unchanged descriptions, resolved/closed source reports and rows without opt-in. If A01 does not cite the incident evidence, it fails closed; no fake score/case.
- After a valid saved incident assessment, the worker **automatically opens ONE active central NMC Case per vessel or links the incident to an existing active case**, with append-only case audit; it creates **zero approved tasks/inspections** at intake. Already assessed reports (e.g. `INC-POC-0001`) are backfilled into Cases on the next tick without repeat Airia spend.
- The Incident Intelligence screen is **read-only for AI evaluation and human follow-up**. It displays background assessment status and a link to the vessel's central `/moei/nmc/vessel/<IMO>/case` page once the case is linked. The old incident `/review` API is disabled with 409; no dual approval history.
- Inside **Case Management**, the NMC officer reviews each incident report and recommendation, chooses **Accept / Modify / Reject**, provides name and reason, and approves mapped Case tasks. Tasks have proper accountable roles, status, evidence and case audit. Smart Inspection referral is created **only after the human approval**, in `PENDING_SCHEDULING` state, never automatically dispatched.
- Case resolution remains blocked while incident decisions or mandatory follow-up tasks are outstanding; completion of a real inspection requires post-inspection evidence/reassessment before closure. No source `Incident_Registry.Operational_Status` is silently updated.

### Configuration
```ini
NMC_INCIDENT_AUTO_TRIAGE_ENABLED=true
NMC_INCIDENT_AUTO_INTERVAL_MINUTES=5
NMC_INCIDENT_AUTO_MAX_PER_CYCLE=3
```
The Compose overlay now defaults to these values. Disable the worker explicitly with `NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false` if you want to stop recurring Airia charges. All 3 current synthetic source incidents have `AI_Review_Request=YES`, so initial startup may trigger paid calls for those that lack a saved assessment and already have a completed saved A01/A02 vessel snapshot.

### Oracle compatibility
An incident-source case has no source alert; it stores `SOURCE_ALERT_ID=NULL` in existing `NMC_CASE`. When Oracle's existing `SOURCE_ALERT_ID` is NOT NULL, a DBA must review/run `tools/oracle/nmc-incident-case-source.sql` once so incident-sourced records can be saved without an artificial alert. No new tables are needed. The case link failure is logged and retried on the next poll without repeating successful AI calls.

### Demo acceptance
1. Open `/moei/nmc/incidents`. The **Analyze** and separate follow-up approval buttons should be absent.
2. For a new opted-in source report, check the backend `[nmc-incidents] STARTUP_TRIAGE` or `TRIAGE_TICK` logs. After a valid, evidence-citing A01 response, the Incident AI score is appended automatically to `AI_Assessments`.
3. Confirm the source event is linked to the central Case screen. Two reports for the same IMO should appear **inside one active Case**, with zero tasks before approval.
4. Select one incident inside Case Management, enter officer name/justification, and click Accept/Modify/Reject. Only then does the Case populate assigned tasks and optional pending Smart Inspection referral.
5. Confirm the Case audit shows `INCIDENT_CASE_CREATED` / `INCIDENT_LINKED` / `INCIDENT_DECISION_*` and that Source Operational Status and saved Vessel Overall Risk are unchanged.

### Limitations
The current Case Management schema may need the nullable-source-alert migration noted above. Live Airia, full Angular build, Oracle database DDL and Docker runtime have **not** been independently verified here. Automatic polling is not event-triggered streaming; up to five minutes of latency applies.
