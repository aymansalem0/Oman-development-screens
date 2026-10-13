# MOEI Smart Inspection — Dynamic Checklists & Airia AI Assistants (POC v1)
**Date:** 14 October 2026  
**Branch:** `feature/si-configurable-checklist-airia-assistant-20261014` (stacked on PR #93 inspection plan stepper).

## User-approved functional scenario

1. The ministry configures many inspection checklist templates. Each checklist may target **multiple vessel types**, GT band, DWT band, several inspection regimes, and NMC/PSC/Service Request reasons. Different published mandatory checklists can all apply to **the same vessel at once**, never a single-template winner.
2. An administrator defines **Groups**, and under each Group any number of **Items**. One Item may contain **several answer fields simultaneously** (Yes/No/Not Applicable, Observation/Note, Expiry Date, Date, Number, Free Text). Each field can independently be marked Required or optional.
3. The system records an AI Assistant enable flag and editable grounded prompt instructions on **Template, Group and Item** levels. The admin can ask a dedicated Airia Checklist Builder to **suggest new groups/items**. Such suggestions are drafts (optional), never secretly replace published mandatory content; admin must review and publish explicitly.
4. When inspecting a vessel, the app selects **ALL matching published templates**, pins each revision to the approved SI case, and renders each group/question and its answer types.
5. At the **Template, Group or Item level**, the inspector chooses to send **text only, image only, or image plus text** to an explicitly configured **Airia multimodal pipeline**. Airia returns proposed answers, rationale, data gaps and confidence.
6. An AI proposal is **never** the inspector's answer: the inspector must **Accept, Edit then Accept, or Reject** separately for each suggestion. Edited answers take precedence. Every AI request, decision, image hash, agent ID, and item answer is auditable in the persisted POC case ledger.
7. Items and templates marked Required must be answered before the dynamic checklist is submitted. The existing 8-item statutory-leaning baseline remains unchanged in the prior lifecycle, and final field-report submission requires submission of any applicable configured dynamic checklists.

## Pages

**Settings:** `http://localhost:4200/#/moei/smart-inspection/settings/checklists`
- Catalog, Create template, Edit draft, Publish new immutable revision.
- Multiselect vessel types via comma separated tags; GT/DWT bands are optional.
- Regimes and source types support multiple values at the same time.
- Add/remove groups and items, choose multiple input fields and required fields.
- Optional Airia Builder suggestion on template/group/item. AI returns a reviewable response; `Add as Editable Draft` adds optional draft items, NOT automatically published mandatory requirements.

**Field Execution:** `http://localhost:4200/#/moei/smart-inspection/checklists/{approvedSiCaseId}`
- A read-only GET previews matching templates and clearly warns if constrained vessel type or tonnage is not available.
- Explicit **Start Dynamic Checklist** freezes matching `publishedRevision` snapshots for the case; new settings will not silently change in-flight inspections.
- Inspectors enter typed answers, save, and submit. The field assistant supports image JPG, PNG or WebP max **2 MiB**, text or combined.
- AI recommendation per field/group/template is a *proposal*, not compliant/noncompliant determination.
- Buttons: **Accept AI Suggestion / Accept with Modifications / Reject Suggestion**, with audit and optional private evidence reference.

Linked from **SI-02 Preparation**, **Full Inspection Lifecycle**, and **Settings → Smart Inspection → Inspection Checklist Library**.

## Business controls / legal boundaries

- Admin-authored `mandatory=true` means **configured mandatory**, not proof of official legal certification; responsible maritime SME must verify applicability and official requirements before deploying as authoritative.
- If GT or DWT is required but missing in the source vessel, the rule is **NOT silently applied**; it is listed as an applicability warning requiring verification.
- Existing 8 foundational lifecycle checks are **not editable, deleted or downgraded by an Airia model**.
- Two referral reasons for the same vessel remain separate source refs in the approved SI case/dossier, and multiple independently required checklist templates will appear together.
- The new dynamic checklist POC config, evidence and completed answers are currently JSON files in the existing protected Docker `/data` volume. The authoritative inspection case/dossier and NMC assessments remain in existing Oracle when deployed in Oracle mode. **Production** requires SQL-backed authoring/revision and field case ledger, asset scanning, encrypted approved evidence storage, RBAC matching true inspector assignments, durable AI/job queues and approved Airia provider audit controls.
- AI recommendations cannot approve official reports, detain ships, change NMC risk, or automatically create confirmed deficiencies. Images sent to Airia are sensitive inspection records; do not send confidential real images before provider privacy/data residency review.
- Photo bytes are stored in the backend private `/data/si-checklist-evidence/{caseId}/` folder, NOT as publicly served Angular assets. Audit stores reference, hash, type and size, never raw bytes.
- All AI calls are **explicit user actions**. No scheduled or automatic token-spending operation is added here; C01/P01 event/schedule orchestration remains a separate project increment.

## Dedicated Airia setup — NO fake pipeline IDs

The current NMC Airia key does **not** automatically provide a checklist AI pipeline. Provision **two real Airia pipelines** (a Builder and an image-capable Reviewer), configure their response contracts, and add to local untracked `.env`:

```dotenv
SI_CHECKLIST_AIRIA_ENABLED=false
AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID=
AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID=
# AIRIA_MENA_KEY remains configured privately for existing NMC/A04 agents
```

Once the actual pipelines have been created, access/compliance approved, output contracts validated against a non-sensitive image, and API key confirmed, add the actual IDs and set `SI_CHECKLIST_AIRIA_ENABLED=true`. AI buttons stay disabled when a pipeline is missing. A request without confirmed AI cost is rejected. Never send API secrets to source control or chat.

**Builder response contract (sample):**
```json
{
  "suggestedGroups": [{
    "title": "Certificates",
    "items": [{"title":"Check certificate expiry","description":"Check against displayed certificate",
      "fields":["BOOLEAN","NOTE","EXPIRY_DATE"],"mandatory":false}]
  }],
  "suggestedItems": [],
  "rationale": "Suggestion needs verification against approved maritime rules."
}
```

**Field review response contract (sample):**
```json
{
  "recommendations": [{
    "itemId": "<exact case checklist instance ID>",
    "answers": {"BOOLEAN":"NO","NOTE":"Observed date differs from source reference",
      "EXPIRY_DATE":"2026-12-01"},
    "rationale": "Evidence appears inconsistent; confirm with actual certificate.",
    "confidence": 0.68,
    "dataGaps": ["The issuing authority was not independently verified"]
  }]
}
```

**Input:** both pipelines receive Airia `PipelineExecution` `userInput` as JSON. The vision pipeline request includes `image: {mimeType,base64,sha256}` and can also include `operatorInput` text. The pipeline must be explicitly capable of interpreting that inline image payload; a text-only Airia pipeline is **not** acceptable as an image analysis demo. A model that returns invalid item IDs, wrong answer types or unverified data is rejected by backend validators.

## Run on Windows PowerShell (no Oracle reset)

```powershell
git status --short
git fetch origin
git switch --track origin/feature/si-configurable-checklist-airia-assistant-20261014
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
```

If the branch is already present locally use `git switch feature/si-configurable-checklist-airia-assistant-20261014`. Preserve uncommitted work, `.env` and the optional cinematic Login background. **Never use `docker compose down -v` or recreate an existing Oracle database.**

## Recommended demonstration
1. Admin creates a **Tanker / GT 5000–80000** checklist with Certificate group:
   - Question: Fire Equipment certificate valid?
   - Answer Fields: BOOLEAN + NOTE + EXPIRY_DATE, Required Fields: BOOLEAN + EXPIRY_DATE.
   - Group AI and Item AI enabled.
2. Admin creates a SECOND **Tanker / GT 40000–120000** checklist with Safety group, and publishes both.
3. Pick an approved tanker SI case whose type/GT are verified. Both checklists should apply together. The fixture fleet provides strings such as `"52,400 GT"` and `"93,500 DWT"`; parser normalizes values before applicability matching.
4. Start, record manual answers, request AI on item with non-sensitive uploaded image/text, inspect response, **Edit then Accept**, save & submit.
5. Switch back to Full Lifecycle and verify report submission cannot bypass an applicable unsubmitted dynamic checklist.
6. Publish a new settings version and verify existing case is still pinned to its old checklist revision.

## What remains to production harden
- Real Maritime regulatory knowledge/reference library and official SME review of applicability and mandatory status.
- Azure SQL or agreed Oracle persistence for authoring, AI review and typed field responses; object storage with antivirus, access policies and lifecycle retention.
- Full inspector RBAC/assignment and offline mobile synchronization, real image provenance, evidence chain-of-custody, audit export, integration with official deficiency codes and PSC/Flag State reporting.
- Confirm actual Airia Builder/Vision pipeline IDs and test multimodal schema with a safe image; test response accuracy and hallucination/uncertainty controls. No guarantee of vessel compliance from computer vision.
