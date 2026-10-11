# NMC Vessel 360 — Five-Factor Risk, Tab Audit, Accidents & Navigation

## User requirements and implementation
1. **Retire Document integrity (A03)** as a vessel-risk factor and retire screens that existed only for that A03 contribution. Keep A01/A02 as the source of the **five** vessel risk factors: `movement`, `inspection`, `certificate`, `dataQuality`, `history`.
2. **Review all Vessel 360 tabs**, with no empty placeholder views or fake "task created" statuses.
3. Add a **conditional Accidents / Incidents** tab based solely on actual incident records retrieved for **this vessel IMO** from the connected POC Google Sheet. Do not invent an empty/demo accident just to show a tab.
4. Show a **closed menu by default**; user explicitly clicks ☰ to open a section, and choosing a navigation route closes the drawer.
5. `/` and unknown routes redirect to `/moei/nmc` (Command Center).
6. Preserve the **source provenance** distinction: simulated fixtures, connected POC adapters, saved risk/case results, and unavailable official integrations are not conflated.

## Vessel 360 audited tabs

| Tab | Actual backing source | User actions / checks | Status |
|---|---|---|---|
| **Overview** | Existing synthetic Vessel 360 master + already saved A01/A02 risk + connected PSC/incident/case source table | Identity/evidence drill-down; saved risk/case links; source reads refreshed via API. Explicit simulated provenance. | Retained |
| **Movement** | Existing **synthetic AIS/LRIT** vessel profile (IMO, position, speed, course, destination, ETA, nav status) | Replaced unrelated three-card placeholder with actual profile field values. Clearly labelled *simulated*. | Replaced placeholder |
| **Compliance** | Existing synthetic registration, certificate and compliance/risk record | Shows existing source facts and review posture; **not** official Flag/RO/MOEI verification. Requires Case Management for actions. | Retained, POC labelled |
| **Inspection** | Existing POC synthetic inspection records, findings and deficiency IDs | Counts computed from existing `inspections` rather than hard-coded `3` / `2`. Buttons that used to set in-memory "inspection created" flags were removed; links lead to real Case Management. | Cleaned |
| **External PSC** | PSC adapter using Google Sheets synthetic dataset or synthetic local snapshot | Existing refresh, linked PSC evidence IDs and counts. Does not imply live Riyadh MoU feeds. | Retained |
| **Certificates** | Existing POC synthetic certificate portfolio | Record selection, detail/provenance. Removed invented MOEI-vs-RO certificate conflict, false timestamps/confidence and fake `VER-2026-00872` task. Actions go to central Case Management. | Cleaned |
| **Accidents / Incidents** | Actual `NmcIncidentsService.list()` Google Sheet response **filtered by exact IMO** | Tab exists **only when at least one report exists**; shows original description, source, source reference, status, location/time, reported severity, NMC rules-based risk only when a fresh saved A01/A02 analysis is present, and linked case ID. No fictitious incident rows or approval actions. | **New conditional tab** |
| **Data Sources** | Connected PSC, Incident Google Sheets, Google Drive read-only metadata, central NMC Cases/referrals + explicitly labelled vessel fixtures | True API read time, source/evidence IDs, unavailable state, refresh. Conflicts only from evidence-backed saved field comparisons. | Retained |
| **A03 Documents** | Previously `NmcVesselDocumentsComponent` AI-specific workflow | Retired from Vessel 360 as an A03-dependent screen. Google Drive **metadata** remains as read-only evidence in Data Sources, without A03 risk scoring or dead deep links. | **Removed** |

## Risk-policy handling: historical audit preserved
- Frontend **Risk Configuration** shows only the five supported factors. Legacy `documentIntegrity` is retained as an optional **JSON compatibility field with zero weight**, not in the editor/score.
- Backend `validateRiskConfig()` and draft validation **reject new A03-positive policy weights** with `A03_RISK_FACTOR_RETIRED`. Historical published policy versions, saved fleet assessments, risk projections and source evidence are **not rewritten or deleted**.
- `fleet-ai` persists only the five A01/A02 factors in **new** fleet assessments. A03 evidence is still treated as optional document/data-quality source context where available, but no sixth `documentIntegrity` risk signal is added or accepted in new scoring.
- Vessel 360 risk display excludes any **historical sixth A03 factor**, while preserving the original saved score for audit. Risk Explainability shows the five supported factors, with no A03-missing blocking screen or A03-dependent recovery flow.
- **Important migration caveat:** If the database's *currently published* risk policy predates this change and sets an **A03 weight >0**, an authorized MOEI administrator must review, redistribute that retired weight among the five factors and **publish a new central policy revision** through existing risk governance. The platform does not silently change the official published policy or rewrite historic assessments. Do not claim this database migration has already occurred.

## No imaginary UI actions
- Removed no-op **Export vessel brief**.
- Removed `startCertificateVerification()` / `createPriorityInspection()` in-memory toggles and all fake "task created/assigned/due in 15 minutes" confirmations.
- Removed false, risk-threshold-based, pretend certificate comparison/confidence values.
- Active factor-evidence buttons now route to the correct populated tab; unknown factors open Data Sources rather than silently doing nothing.
- Task and inspection approval/creation belong to **central NMC Case Management** and remain subject to human authorization.
- All movement, inspection, certificate and compliance fixture tabs carry a visible **Synthetic POC** notice. Where adapters fail, connected data shows unavailable/unknown, not made-up facts.

## Navigation and default
- Routes `path:''` and `**` redirect to `moei/nmc`.
- Unified navigation drawer and its NMC / Smart Inspection / Settings groups default to **closed**. User clicks ☰; selection automatically closes the drawer. No route-triggered auto-open.
- Main content no longer reserves an empty 240-pixel sidebar gutter on desktop.

## Acceptance checklist
1. Open `http://localhost:4200/` — lands on Command Center. Menu remains hidden until ☰ is pressed. Select *Vessel 360* and drawer closes.
2. Open `http://localhost:4200/#/moei/nmc/vessel/9328471`; with Google Incident Sheet accessible, **Accidents / Incidents** appears. Confirm `INC-POC-0001` and `INC-POC-0003` descriptions/source statuses as sent by Google Sheet, no fabricated risks where pending/stale.
3. Open another IMO without any matching reports: **no Accidents / Incidents tab**.
4. In Movement, check actual existing synthetic position/course/speed fields are shown; no generic filler. In Inspection and Certificates, no fake task-creation buttons; only a route to Case Management.
5. Review Risk Management: only **five** factor sliders. Existing centrally published policy must have `documentIntegrity:0` to support a live five-factor projection.
6. Verify Data Sources identifies Google Drive as read-only metadata, and no obsolete A03 Documents tab, A03 risk cards, or A03-missing risk warning remain.
7. Test source failures: accidents tab hidden when Google Sheet unavailable, while Data Sources explicitly reports unavailable.
8. Validate Docker/Angular and backend tests before production/demo. This feature branch is **draft** until runtime tests complete.

## Engineering verification
- Static repo regression `ai-proxy/test/nmc-vessel360-tabs-navigation.test.mjs` covers route, default closed drawer, five-factor current risk, actual tab contents, conditional incidents, and removal of fake task buttons.
- CI workflow `.github/workflows/nmc-compile.yml` includes **Angular 18 production build** and **Node backend tests** for pull requests.
- Angular Docker and live browser were **not executed** in this assistant environment; do not infer runtime success from code review alone.
