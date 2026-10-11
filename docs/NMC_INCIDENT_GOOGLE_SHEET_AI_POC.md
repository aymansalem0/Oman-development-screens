# NMC Incident Google Sheet and Existing Airia A01/A02 Reuse

**Final decision:** The existing Airia A01 maritime intelligence and A02 compliance pipelines retain their existing request/response formats; no additional Airia agent or output extension is introduced.

The reference implementation and authoritative setup/limitations for this POC stage are in [NMC Incident AI Stage 1](./NMC_INCIDENT_AI_FOLLOWUP_STAGE1.md).

## Google Sheet
[MOEI NMC POC — Maritime Incident Sources](https://docs.google.com/spreadsheets/d/1fl6rCjHNTPKZTeS76PLSy_ylrClLQQ0Yvq12A7nhfy8/edit)

`Incident_Registry` stores original synthetic port/reporting-platform descriptions and status. The same Google PSC service account can read/write this Sheet only after it has Editor sharing permission.

`AI_Assessments` (32 columns) holds the separately computed **NMC policy Incident Risk Score**, A01 action/citation provenance, existing A02 vessel compliance-factor context, and the separately appended human follow-up decision. Policy risk factors in H–K are NOT model-generated values. Neither agent writes official vessel risk.

`Source_Catalogue`, `Scoring_Policy`, `Data_Dictionary` describe source types, business rules and evidence ownership.

## User experience
- Command Center: incident summary, source-linked affected vessels in Requires Attention Now and incident-severity-colored ship markers with A01/A02 risk distinguished.
- Incident Intelligence: review a source incident, manually request current A02 `signals` and A01 `SITUATION_ASSESSMENT`, see the NMC rules-based separate risk and pending follow-up, and accept/modify/reject with evidence and officer reason.
- Background source triage is OFF by default and calls Airia only after explicit opt-in.

## What remains unverified
The actual A01 pipeline may not cite the supplemental report evidence even though it was included inside the existing `approvedSignalEvidence` fields. That is a genuine compatibility dependency, not proof that a contract was changed. The backend rejects such output with `INCIDENT_A01_DID_NOT_CITE_REPORT` rather than claiming incident AI analysis. Local Docker/Angular and live Airia requests have not been verified.

No automated incident restriction, actual inspection request, case closure or change to authoritative vessel risk is executed here.
