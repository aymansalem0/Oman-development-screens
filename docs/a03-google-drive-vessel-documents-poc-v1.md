# A03 Google Drive Maritime Document Intelligence — Integration V1 (MOEI POC)

## Source discovery (10 October 2026)

The **connected Google Drive** has a synthetic POC maritime evidence folder organized as:

```text
/vessels/                        [Folder ID 1WtGOWP1CY7LRvXFXDV-EJseNXJNyLM9W]
  /9328471 - MV Gulf Horizon/  [Folder ID 1qggwEw8r9B7aRTc8lkDHT67KnBcdeio9]
     VESSEL-DOCUMENT-PACK-9328471.pdf
```

The vessel PDF is an **11-page multi-document pack** with synthetic registration, classification, safety construction/equipment/radio/security certificates, manning, P&I, latest inspection and deficiency evidence. This is NOT an official certificate repository. The Google Doc named **MOEI NMC POC Document Repository Guide** states these 420-vessel documents were generated from the synthetic POC fixture. **Connected ChatGPT Google Drive credentials are NOT the Docker application's credentials.**

## Delivery in this branch

| Step | Behavior | Limitations |
|---|---|---|
| 1. Google Drive metadata | Dedicated service account, read-only. Scope restricted to configured `vessels` root folder and exact `IMO - Vessel Name` immediate subfolder, or root filenames containing the exact IMO. | Service account must be explicitly granted Viewer access. No Drive API credentials in browser or GitHub. |
| 2. View in Vessel 360 | New **Documents / A03** tab shows PDF, TXT or Google Doc metadata and statuses. | No silent AI on GET or tab open. |
| 3. Extract document text | Downloads only a single selected file, max 8 MiB, `pdftotext` for text PDFs (including 11-page pack), Google Docs text export. | Scanned PDFs require OCR; unsupported files fail safely before invoking Airia. Input text max 14,000 characters and marked truncated if longer. |
| 4. A03 Agent | Explicit Editor action, actor name and cost confirmation. Calls configured `AIRIA_A03_PIPELINE_ID` once for that file. Requested output: one overall extraction + optional multiple subdocuments and verbatim evidence quotes. | **Airia provider response contract is not yet verified live.** Invalid AI output is rejected; costs may apply only after explicit run. |
| 5. Validate/Review | Validate quoted evidence exists in downloaded text; IMO must match selected vessel before APPROVE; review note required. Preserve DRAFT/FAILED/APPROVED/REJECTED + versioned audit. | Human approval is **not** authority/issuer certificate authenticity verification. |
| 6. A02 | Only human APPROVED and still-current Drive extracts passed as additional evidence to the **next separately authorized** A02 fleet assessment. | Never automatically re-runs A02 or rewrites prior Oracle fleet risk. Fleet auto-assessment remains opt-in. |
| 7. A04 | Only approved, current extracts included in Smart Inspection preparation context and evidence refs. | A04 remains OFF unless `SI_A04_ENABLED=true` and operator initiates an explicit paid run. Existing mandatory checklist unchanged. |

### Data contract (A03)

Prompt requests one JSON object similar to:

```json
{
  "extracted": {
    "imo": "9328471",
    "vesselName": "MV Gulf Horizon",
    "documentType": "Vessel Document Evidence Pack",
    "certificateNumber": null,
    "issuingAuthority": null,
    "issueDate": null,
    "expiryDate": null
  },
  "confidence": 0.85,
  "evidenceQuotes": ["IMO: 9328471"],
  "documentEntries": [
    {
      "imo": "9328471",
      "documentType": "Cargo Ship Safety Construction Certificate",
      "certificateNumber": "SC-284711",
      "issuingAuthority": "Global Marine Classification",
      "issueDate": "2026-01-08",
      "expiryDate": "2026-11-02",
      "status": "CONDITIONALLY VALID",
      "evidenceQuotes": ["Certificate Number SC-284711"]
    }
  ]
}
```

This is **the requested integration contract**, not an assertion of what the existing remote Airia A03 pipeline actually emits. The backend accepts permitted wrappers but requires supported evidence citations. If remote output differs, adapt A03 pipeline and validation **after observing one controlled response**, not by fabricating certificates.

## Oracle and local Docker rollout

**Not deployed by ChatGPT.** PR should remain Draft until DBA approval, staged migration and browser UAT. The implementation is stacked on PR #62 (risk notification supersession), itself stacked on #61. Current `main` does not include either.

1. Take a verified restorable backup of NMC_AI data in `FREEPDB1`; preserve current Oracle container and Docker volumes. Check schema before running anything.
2. **Apply migration 014 first if not already applied**, then apply new migration `ai-proxy/migrations/015_nmc_google_drive_a03.sql` **once** to the existing NMC_AI account. Oracle DDL auto-commits; if partly applied, stop for DBA recovery. Do not use `docker compose down -v`.
3. Create a dedicated **read-only** Google Cloud service account, enable the Google Drive API, and share only the POC `vessels` folder (Viewer access). Save the JSON account key locally at `secrets/nmc-drive-google.json`. Do not put it in the repository, frontend, chat, logging, or screenshots.
4. Configure the **local** `.env` (these are non-secret switches/IDs; existing Airia key and editor key stay outside Git):
   ```env
   NMC_DRIVE_ROOT_FOLDER_ID=1WtGOWP1CY7LRvXFXDV-EJseNXJNyLM9W
   NMC_A03_ENABLED=false
   ```
   Start with `NMC_A03_ENABLED=false` to verify folder listing without paid AI. After approving the actual A03 schema and confirming Airia costs/privacy, set `NMC_A03_ENABLED=true`.
5. Checkout `feature/a03-google-drive-document-intelligence-v1`, inspect local uncommitted changes:
   ```powershell
   cd C:\Users\Admin\Oman-development-screens
   git status --short
   git fetch origin
   git switch feature/a03-google-drive-document-intelligence-v1
   git pull --ff-only origin feature/a03-google-drive-document-intelligence-v1
   docker compose -f compose.yaml -f compose.google-drive.yaml -f compose.oracle.yaml config --quiet
   docker compose -f compose.yaml -f compose.google-drive.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
   docker compose -f compose.yaml -f compose.google-drive.yaml -f compose.oracle.yaml logs --tail=130 ai-proxy
   ```
   Add `-f compose.google-psc.yaml` alongside the existing stack if it is used, preserving the base and Oracle order. Check existing external network `nmc-oracle-link`. Do not restart or recreate the Oracle volume.
6. Open `http://localhost:4200/#/moei/nmc/vessel/9328471` → **Documents / A03**. Confirm `VESSEL-DOCUMENT-PACK-9328471.pdf` appears and no Airia request runs on opening the tab.
7. Run one explicit paid A03 analysis and compare extracted fields and citations against the synthetic pack, especially `CERT-SC` **SC-284711**, **expiry 2026-11-02**, conditional validity, and the intentional classification-vs-certificate conflict. If A03 contract differs, keep REVIEW blocked and record exact shape without secrets.
8. Review and approve with a reason, confirm the approved evidence appears in future A04 inspection context and in A02 input at its next permitted fleet run. No old risk / statutory case rewrite. Update PDF in Drive and confirm stale approval is excluded from both.
9. Run `npm --prefix ai-proxy test` and the Angular build, plus live browser and Oracle UAT.

### Known gaps / V2

- OCR for scanned PDF/image files is not implemented.
- Foundation model, multimodal PDF input, and exact remote Airia A03 response schema are not independently confirmed.
- No new live A02 compliance assessment is automatically initiated after approval. The scheduler is cost-controlled and normally disabled.
- The A03 review operation uses existing shared Editor key as POC authorization; production IAM requires Keycloak/UAE PASS RBAC and real authenticated identities.
- No official maritime certificate issuer/flag registry authentication API.
- This demo folder is synthetic; never present its contents as verified Riyadh MoU, registry or statutory evidence.
- Sensitive files should be used only after confirming data transfer/privacy approvals to Airia.
