# NMC External PSC Simulation — 420 Vessel Fixtures

**Not Riyadh MoU data.** This dataset is an internally generated, fictional
Port State Control inspection-history test corpus for the MOEI NMC Business POC.

## Live Google Drive dataset

Google Drive folder: **MOEI-NMC-POC / External-PSC-Simulation**

Google Sheet: **NMC_External_PSC_Simulation_420_Vessels_v1**

- Workbook ID: `1sefQv6E-Avvgmklv4WQbpFBEc7MmlCAcOc0c-rI_Wmg`
- Tabs: `Overview`, `Vessels_420`, `PSC_Inspections`, `PSC_Deficiencies`, `PSC_Detentions`
- Version: `PSC-SIM-v1.0`; as-of: 2026-10-08
- 420 catalog IMO entries (matches NMC Angular), 1,624 PSC inspections,
  1,548 deficiencies, 73 fictional detentions; 14 intentionally have
  **NO_RECORD_IN_FIXTURE** to test missing-history handling.
- Dates and findings are deterministic and based on vessel ID, age and type,
  **not** the existing NMC baseline risk score.
- Country/port/authority labels are part of the synthetic scenario and do
  **not** imply those authorities conducted any of these inspections.
- No PDFs are uploaded by this generator; `NOT_UPLOADED` is explicit.
- The dataset is not connected live to the Angular NMC or Docker proxy yet.

## Reproduce an offline CSV snapshot

From the repository root, using Node.js 20+:

```bash
node tools/psc/export-psc.mjs
```

This creates four CSVs and a metadata JSON locally under
`data/generated/external-psc-v1`. The generated directory is intentionally
not committed. The Google Sheet was populated independently using this exact
generator. If source-vessel catalog data changes, regenerate and reconcile
before replacing the Google Sheet; do **not** silently overwrite manually
reviewed PSC records.

## Next integration step

The Docker AI Proxy will need a dedicated **read-only Google Sheets/Drive
credential** authorized for this specific workbook. The user's ChatGPT Drive
connection does not automatically grant credentials to Docker or Airia.
The connector should fetch only the selected IMO, normalize source and
confidence fields, retain inspection/deficiency/detention IDs, flag
`NO_RECORD_IN_FIXTURE` as **unknown** rather than zero-risk, and deduplicate
against internal MOEI inspection IDs before AI scoring. A02/A01/A04 may cite
PSC-SIM evidence IDs but must not represent them as verified PSC findings.

Data contract target:

```text
GET /api/v1/poc/external-psc/vessels/{imo}
  -> {imo, sourceSystem, dataNature, inspections, deficiencies, detentions,
      evidenceIds, retrievedAt, coverage}
```

The adapter must preserve independent provenance:
`MOEI Smart Inspection` != `EXTERNAL_PSC_SIMULATED`.
The simulated data should not be used for official enforcement.
