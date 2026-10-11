# NMC POC — Vessel 360 Operational Audit & A03 Factor Retirement
**Date:** 2026-10-12. **Scope:** existing Angular 18 Vessel 360, NMC risk policy, source adapters, menu defaults. A POC with clearly marked synthetic inputs, not a production authority integration.

## Non-negotiable design decisions
1. The NMC official **vessel-risk score** has **five A01/A02 factors only**: `movement (25%)`, `inspection (28%)`, `certificate (20%)`, `dataQuality (14%)`, `history (13%)`. The independently computed **incident-risk score** remains separate. A03 `documentIntegrity` is completely removed from current risk editing, fleet scoring, saved current projection, alerts and risk explainability. An old stored assessment can retain historical A03 evidence **immutably**, but any new current projection always ignores that retired sixth signal.
2. The active centrally published policy with an old **positive** A03 weight is **NOT silently reweighted**. Backend returns `RISK_LEGACY_A03_REBALANCE_REQUIRED` until an authorized business supervisor redistributes its weight across the five factors and publishes an auditable revision. A legacy 0%-weight key can be migrated off new drafts.
3. The separate `A03` document-analytics API code remains available for independent evidence workflows, but the **Vessel 360 Documents / A03 tab, documentary risk factor, document-only quality panel and A03 follow-up navigation** have been removed. Google Drive **read-only listing metadata** is still shown as an explicitly synthetic document source if available; this metadata is not an A03 risk score and has no dead UI link.

## Tab-by-tab traceability and functional actions
| Tab | Shown when | Current data provenance | Genuine operator action |
|---|---|---|---|
| **Overview** | Always for a catalogued IMO | Vessel catalog and POC vessel evidence bundle, clearly synthetic; saved A01/A02 vessel score if available; actual connected source counts; recorded timeline events only | Provenance details, connected-source Refresh, Risk Explainability link, Case Management link |
| **Movement** | Always | Original synthetic vessel navigation context (IMO, MMSI, position, speed, course, ETA) plus **saved A01 movement signal**, reason and actual evidence IDs; no invented anomalies | Back to Overview; risk evidence/view other tabs |
| **Compliance** | Always | Saved A02 inspection/certificate/dataQuality severities/reasons/evidence; source-owned POC registration/certificates; connected synthetic PSC and recorded incident references | PSC tab, conditional Accidents tab, central Case Management |
| **Inspection** | Always | Same POC `bundle.inspections` and `bundle.deficiencies` used by the demo; counters are dynamic; not a genuine signed MOEI inspection or detention | Evidence/provenance view, actual Case Management follow-up link |
| **External PSC** | Always | Existing PSC reader (`GOOGLE_SHEETS_LIVE` synthetic data or `LOCAL_FIXTURE_SNAPSHOT`); 0 or unavailable is never inferred legal clearance | Explicit refresh and existing source evidence links |
| **Certificates** | Always | Same synthetic `bundle.certificates`, selected record detail and original record IDs. **No artificial flag-versus-RO 'conflict' based on vessel risk score** | Select certificate / inspect stated POC provenance; no fake task creation |
| **Data Sources** | Always | Actual API reads of PSC, incident Google Sheet, Google Drive read-only listing, Case Management referral/case statuses and saved quality comparisons, plus clearly marked local fixture rows and `Unavailable` feeds | Refresh source API reads, follow an existing route only |
| **Accidents & Incidents** | **Only when Google Sheet returns at least one report matching the exact 7-digit IMO** | The immutable original report description, source authority as reported, source reference, incident type, time, state, and the separately calculated saved incident risk (only when available); case link **only if actually created** | Open Incident Source; open linked Case Management; no AI billing and no automatic enforcement |
| **Documents / A03** | **Removed** | No fifth/sixth documentary-risk assessment in Vessel 360 | None |

## Eliminated false affordances / claims
- Removed **Export vessel brief** no-op button.
- Removed **Start/Create certificate verification task**, hard-coded task `VER-2026-00872`, and fake 15-minute due-time.
- Removed **Create priority inspection** client-only checkbox/flag: now offers genuine Case Management route where all actions are human-authorized, assigned and auditable.
- Removed fabricated "external RO vs MOEI certificate conflict" and static external update timestamps; not a valid independent authoritative comparison. Real saved two-sided source mismatches remain in Data Sources.
- Removed fabricated **Movement** and source **placeholder** tabs; each now has source-linked content.
- Removed fabricated timeline events and fake source confidence/provenance percentage bars (trust, identity match, freshness). Source data remains explicitly synthetic and unauthenticated; read-time and unknowns are displayed honestly.
- Replaced Command Center's no-op **Review Maritime Event** with a central Case Management link.

## Navigation & entry
- Root `/` and wildcard unmatched routes redirect to **`/moei/nmc`** Command Center.
- Existing Oman approvals route is **preserved** and is **not shadowed** by the `/moei/nmc` route (caught during route audit).
- Unified NMC/Smart Inspection/Settings sidebar is a hidden/offscreen overlay by default on desktop/mobile with all groups collapsed, an accessible ☰ control and dismissible backdrop. Clicking links closes it. No 240px blank gutter.
- Query `?tab=accidents` waits for incident source read before navigating to that tab; when the source returns none or errors, default back to Overview.

## Existing integrations / remaining dependencies
- **Actual MOEI/foreign flag/RO/radio/AIS national authorities** are NOT connected; the POC's internal fleet/registration/movement/inspection/certificates remain synthetic. Their values cannot establish official registration, vessel detention, compliance clearance or a legal violation.
- **Google Sheets PSC/Incidents** read synthetic source records; **Google Drive** read-only listing is not issuer-authentication; **Case Management** persists NMC POC decisions/task outcomes (where case DB is available).
- The `Data Sources` list's `Last read` is the API retrieval time, not the actual authority's last sync.
- Legacy published policy migration requires supervisor review when A03 weight was **positive**. No automatic redistribution/retroactive overwrite.
- A live full Angular/Docker production build, remote Airia real calls and Oracle migration were not performed by the assistant; run the commands below and inspect the compiler/Compose logs before merging.

## Operator acceptance test
```powershell
git fetch origin
git switch --track origin/feat/nmc-v360-operational-cleanup-no-a03-20261012
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml build nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml -f compose.incident-google.yaml up -d --build ai-proxy nmc
```
Open `http://localhost:4200/`: should arrive at Command Center; menu closed until ☰. Open `http://localhost:4200/#/moei/nmc/vessel/9328471`: inspect all seven always-on tabs plus **Accidents** when the connected source includes the vessel. Open an incident-free vessel: no **Accidents** tab. Confirm risk configuration shows **five** factors, risk explanation no A03 and no dead Export/verification/priority-inspection buttons. Test a previously positive-weight A03 policy by reviewing and republishing the five-factor weights with a supervisor; do NOT expect silent auto-migration.
