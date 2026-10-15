# External PSC Google Sheets Integration — Docker POC

## What works immediately

Default `docker compose up -d --build` runs in **snapshot** mode. It derives
the same versioned *fictional* 420-vessel PSC dataset used to populate the
Google Sheet. **This is not a live Google connection**. UI and API must display
`LOCAL_FIXTURE_SNAPSHOT`, never claim that Google credentials were used.

Google Sheet created for POC:
https://docs.google.com/spreadsheets/d/1sefQv6E-Avvgmklv4WQbpFBEc7MmlCAcOc0c-rI_Wmg/edit

## Enable live read-only Google Sheets access

1. In your own Google Cloud project, enable the Google Sheets API. Create a
   dedicated **service account** for this POC. Create a short-lived,
   appropriately controlled JSON key for local Docker testing; do not send the
   JSON, key or access token to ChatGPT, Airia, Angular or GitHub.
2. In the spreadsheet's Share dialog, grant the service-account **client_email**
   Viewer permission, scoped to this specific spreadsheet. ChatGPT's linked
   Google Drive connection does **not** authorize the user's Docker container.
3. Save the service-account JSON as
   `C:\Users\Admin\Oman-development-screens\secrets\nmc-psc-google.json`.
   This folder is gitignored and Docker build-ignored. Never commit it.
4. Launch via:

   ```powershell
   cd C:\Users\Admin\Oman-development-screens
   docker compose -f compose.yaml -f compose.google-psc.yaml up -d --build
   Invoke-RestMethod http://localhost:4200/api/ai/psc/health
   Invoke-RestMethod http://localhost:4200/api/ai/psc/vessels/9328471
   ```

5. Confirm `sourceMode=GOOGLE_SHEETS_LIVE` on the selected-vessel response
   and `googleSheetsConnected=true`. If auth fails, the API returns 503
   `PSC_DATA_UNAVAILABLE` and does **not** use snapshot as a hidden fallback.

To return to **snapshot** mode, use `docker compose down`, then
`docker compose up -d --build` **without** the Google override.

## Read-only APIs

- GET `/api/ai/psc/health`: mode, readiness, dataset version.
- GET `/api/ai/psc/vessels/{imo}`: selected IMO only; normalized
  inspections, deficiencies, detentions, evidence IDs, status and provenance.
- The adapter caches the four source tabs for 120 seconds to reduce API calls;
  it validates the 420 known IMOs and all PSC provenance markers.
- There is **no Google token** or Drive key exposed to Angular/Airia.
- Records remain FICTIONAL; the Google live mode means they were fetched
  from the configured workbook, not that they were issued by any authority.
- PDFs not included; A03 document extraction remains separate/unimplemented.

**Caution:** current local Docker proxy binds to 127.0.0.1 and is for POC
only. A deployed system needs server-side authentication/authorization,
credential rotation, audit and least-privileged workload identity (avoid
long-lived service account keys where possible).
