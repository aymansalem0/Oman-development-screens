# MOEI Smart Inspection — 99-Vessel Operational Master with ETD (POC)

Date: 14 October 2026. **The 99 demo identities are sourced from Airia Partner Guide §8; all MSW source events, ports, ETAs and ETDs are generated synthetic POC data, not verified real-vessel movements or production MSW exports.**

## Delivered reproducible Excel files

| Workbook | Import sheet | Records | Import supported |
|---|---|---:|---|
| `MSW_Service_Requests_POC_99_WITH_ETD.xlsx` | `SERVICE_REQUESTS` | 60 | YES, Candidate Source Imports → SERVICE_REQUEST |
| `MSW_PSC_Port_Calls_POC_99_WITH_ETD.xlsx` | `PSC_PORT_CALLS` | 45 | YES, Candidate Source Imports → PSC_PORT_CALL |
| `MOEI_Vessel_Master_POC_99_WITH_ETD.xlsx` | `VESSEL_MASTER` | 99 unique IMO | Reference workbook only; not a registered importer |

All three carry `etd_local` as **YYYY-MM-DDTHH:mm** in **Asia/Dubai (UTC+04:00)**; the six shared IMOs have exactly matching ETD and port across both MSW feeds. PSC ETA is a separate field and must precede ETD. Service-only vessels have no fabricated ETA.

**User business decision:** a syntactically valid imported ETD is `SOURCE_FINAL` immediately, without an additional approval step for the date. This does **not** waive PSC selection, inspection-plan supervisor approval, whole-plan schedule approval, or NMC officer control.

## Operational Vessel Master integration

- `GET /api/si/v1/vessel-master` (Editor role) returns the 99-vessel operational read model.
- `GET /api/si/v1/vessel-master?imo=9247813` returns the named IMO row.
- The base IMO/name master is untouched. The current ETD is joined on IMO from **actually saved** Source Events (Oracle/JSON).
- Before a source is imported, that vessel's current ETD is **MISSING** even if the standalone Excel reference sheet contains an ETD sample.
- Supported statuses: `FINAL_POC`, `MISSING`, `HISTORICAL_ONLY`, `CONFLICT`.
- Two differing future ETDs or port locations for the same IMO produce **CONFLICT** and no silently selected date.
- Vessel 360 shows the joined operational ETD and explicitly labels the synthetic/POC nature. It never shows AIS ETA as ETD.
- No new Oracle column or migration is created; ETD is a mutable voyage/port-call fact, **not** immutable vessel identity data. This ensures older official registry entries, case records and historical assessments are untouched.

## Generate on Windows / Docker

```powershell
cd C:\Users\Admin\Oman-development-screens
$dc=@("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
$exportDir=Join-Path (Get-Location) "MSW_POC_Imports"
New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
docker compose @dc run --rm --no-deps -v "${exportDir}:/exports" ai-proxy node tools/generate-msw-demo-feeds.mjs --out=/exports
Get-ChildItem $exportDir -Filter "*ETD.xlsx"
```

The generator refuses to overwrite existing files unless explicitly supplied `--overwrite-poc-only`.

## Import and validate

1. Preview/Commit the **Service Requests** source workbook under Smart Inspection → Candidate Source Imports.
2. Preview/Commit the **PSC Port Calls** workbook separately. PSC quota/selection controls remain applicable.
3. Check the Vessel 360 page for a vessel IMO with a source event and confirm **Current ETD (UAE local)**. Or inspect the read-only Vessel Master API.
4. Re-run C01 for a **draft** inspection plan after sources have changed; approved plans remain immutable.
5. Never upload the **Vessel Master reference workbook** to an unrelated source importer.

### Duplicate-source warning

Existing 7-column source events in Oracle are immutable. The new Excel source files deliberately use new `*-ETD-*` event identifiers. **Importing them while legacy source events remain may add duplicate operational candidates / parallel source-event history.** Preview existing events and reconcile if necessary; do not delete Oracle records, perform reset, or reassign inspections automatically.

## Safety and scope

No NMC case is closed from importing ETD. No inspector is scheduled from simply updating master. No Airia C01 request is issued on a GET or Excel generation. All changes are additive, testable and POC-scoped. A production Vessel Master needs a real MSW port-call versioned integration, formal source timestamps and an approved conflict-resolution policy.
