# NMC POC — Correlated Data Sources & Incident/Accident Risk Filter

## Business objective
This change improves NMC-01 operational awareness, NMC-02 cross-source correlation and NMC-06 evidence/provenance traceability while **preserving the existing A01/A02 Airia inputs/outputs**. No AI call, background score rewrite or MOEI production integration is introduced by opening the source table.

## Command Center filtering
Risk-status dropdown now contains:
`All | Critical | High | Incident / Accident | Watch | Normal | Pending AI`.

**Incident / Accident** is a *source-event filter*, NOT a new official fleet risk band. It selects vessels with at least one currently active, valid (7-digit IMO) incident report from the connected synthetic Google Sheet; it works even when saved vessel-risk AI status is still `Pending`. The map and the right-side **Requires Attention Now** list both focus those vessels. Closed/resolved reports do not trigger the active filter. Search, vessel type and assessment filters remain combinable; for example explicitly selecting *AI Assessed Only* will hide incident vessels still pending AI. If the Google Sheet feed fails, no phantom incident vessels appear.

Incident severity displayed on vessel symbols and outer rings remains separate from inner A01/A02 vessel risk.

## Vessel 360: Correlated Data Sources
The old static 8-row `buildSources()` hardcoded fake clock times (22:42 etc), and inferred two certificate/classification conflicts from vessel-risk threshold. This change replaces that construction with a **correlated live POC response view**, while making it explicit which underlying records are only synthetic fixtures.

**Existing synthetic POC fixtures (not independently fetched official feeds):**
- Vessel master, flag registration, movement, inspections/findings, certificates, classification, owner/operator.
- All are explicitly marked `SYNTHETIC_FIXTURE`; their update times and independent source-confidence are displayed as **—**, not made-up values.
- UAE restrictions are `Unavailable` and `Unknown`, NOT 'No active restriction recorded' unless a connected restrictions source is later added.

**Read-only POC API sources (actual runtime reads):**
- `NmcExternalPscService.getVessel(imo)`: Google Sheet synthetic PSC or local synthetic snapshot; displays mode, inspection/open finding/detention counts, actual HTTP response retrieval time, and an evidence link to the PSC tab. It never claims official Riyadh MoU data.
- `NmcIncidentsService.list()`: connected synthetic incident Google Sheet, filtered to exact vessel IMO; displays source report IDs, active count and local successful API read timestamp, with a link to Incident Intelligence.
- `NmcDocumentsService.list(imo)`: Google Drive file metadata and saved A03 human-review statuses. Read-only, no A03 AI call and no document-authenticity claim. Shows `Unavailable` when not configured/fetch fails.
- `NmcCasesService.list()`: real NMC Case store records for vessel, including case status, read timestamp and Case Management link.
- Case Store `inspectionRequests`: human-approved Smart Inspection **referrals only** (pending scheduling/status). These are not a completed Smart Inspection lifecycle nor independently verified inspection findings. The actual SI ledger is protected by Editor authorization, so the source table does not bypass it.
- Saved A01/A02 data-quality comparison: shows an actual `MISMATCH` only when *both* internal/external values were present in the stored evidence comparison. Missing values are not conflicts. The earlier fake “2 conflicts” caused by a risk threshold is removed.

**Source semantics:**
`Last read` is the time the backend/API response was read, **not** the source authority's real `Last Sync`. `Confidence = —` when the source service does not supply a defensible per-source confidence metric. Source type and record/evidence ID remain visible. An unavailable adapter is shown `Unavailable` without substituting synthetic success.

A **Refresh sources** button reloads the read-only sources. Existing detailed Vessel 360 field modals now mark synthetic fixtures, and their previously hardcoded update times are replaced by '—'.

## POC verification
1. Start the branch and existing Docker overlays, navigate to `http://localhost:4200/#/moei/nmc`.
2. Set risk filter to **Incident / Accident**. Both the map and Requires Attention Now must show vessels with open incident reports, even when their fleet assessment is pending. On the supplied fixture, `MV Gulf Horizon` has two reports and should be visible while active. Restore `All` to show all vessels.
3. Open `http://localhost:4200/#/moei/nmc/vessel/9328471` and find **Correlated Data Sources**. Synthetic fixture entries have no invented sync time/percentage. Incident reports show real source IDs from the Google Sheet, PSC mode is explicit, Case Management reflects actual case records, and Drive shows connected documents or unavailable status.
4. Change/close an incident report in Google Sheet, use **Refresh sources**, and check the sources update; the Command Center polls sources every 30 seconds.
5. Confirm no fabricated certificate conflict merely because vessel risk is high; source comparison conflicts must come from saved mismatch evidence. Disconnect a source deliberately to confirm visible `Unavailable` status.

## Safety & limitations
The connected Google sources contain synthetic maritime records. No direct integration with actual MOEI vessel/flag/RO authority registries, AIS/LRIT national tracking, Riyadh MoU, verified port incident reports or official restriction databases is claimed. Existing service account and API permissions remain in force. The UI does not automatically execute an inspection, close a case, detain a vessel or send a paid AI request.

Current verification: V8 in-memory UI-business-logic smoke tested the source assembly (14 rows with available connectors; 13 with no comparison), one real-evidence mismatch only, fail-closed disconnected sources, and Incident/Accident filter selecting only a vessel with an active incident even when its fleet risk was Pending. **Angular/Docker integration build and real browser verification remain pending.**
