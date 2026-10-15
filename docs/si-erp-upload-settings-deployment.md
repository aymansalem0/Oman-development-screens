# Smart Inspection ERP Import Compatibility & Settings — Windows Deployment
## Problem and resolution
The previous MOEI ERP workbook contains valid SpreadsheetML XML whose elements use
the prefix `x:` (for example `<x:workbook>`, `<x:worksheet>`). ExcelJS 4.x
does not parse this namespace representation reliably; the old backend returned
`ERP_INVALID_XLSX` without reaching the column/reference checks.

This change provides a guarded in-memory Open XML namespace normalization **only
after regular ExcelJS parsing fails or omits the expected sheet**, then
validates all 11 sheets, exact row-4 headers, foreign keys, shifts, leaves,
bookings and workbook size **unchanged**. The uploaded file remains untouched;
the user does **not** need to recreate the previously supplied workbook.

The ERP Excel integration simulator is moved out of Electronic Scheduling and
into **Settings → ERP Integration Simulator** in the existing white MOEI menu.
Scheduling displays only the current saved ERP snapshot, inspectors and ports
and links to Settings; it cannot upload or replace workforce data.

## Git checkout (Windows PowerShell, no gh CLI)
```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# Save/commit/stash any uncommitted local edits before switching branches.
git fetch origin pull/52/head:pr-52-erp-settings
git switch pr-52-erp-settings
git branch --show-current
```
This PR is **stacked on #51** which includes #50 → #49 → #48, so follow the
dependency order when deploying the backend against Oracle.

## Database / migration
**NO DB MIGRATION REQUIRED BY THIS PR.**
Do not rerun migrations 007–010 for an ERP-import issue.
The ERP snapshot persists in the existing dedicated POC JSON volume, not
the official Oracle assessment/risk schema. `PREVIEW` does not replace the
saved snapshot; only explicit `COMMIT` does.

If deploying the entire PR stack to a clean older environment, Oracle
007 → 008 → 009 → 010 must have been installed separately **as needed**
and verified according to the parent PR runbooks, with verified backup.
This UI/import fix alone does not add or alter database objects.

## Docker rebuild: both frontend and ai-proxy
The change affects **both** Angular routing/settings and backend XLSX parsing.
Updating only `nmc` is not enough.

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=100 ai-proxy
```
If your current deployment already includes `compose.google-psc.yaml`, insert
`-f compose.google-psc.yaml` **between** the base and Oracle files consistently.
DO NOT run `docker compose down --volumes`. Do not print private .env keys.

## Functional acceptance
Open and refresh:
- Settings: `http://localhost:4200/#/moei/smart-inspection/settings/erp`
- Scheduling: `http://localhost:4200/#/moei/smart-inspection/scheduling`

In **Settings**:
1. Confirm the white NMC / Smart Inspection / Settings sidebar remains
   visible, with **ERP Integration Simulator** highlighted.
2. Enter Editor key as prompted in the Settings screen (never share credentials).
3. Select the originally supplied `MOEI_Smart_Inspection_ERP_Upload_Ready.xlsx`.
4. Preview should succeed; check 11 sheets including 5 ports and 8 inspectors
   (and the rest of the workbook counts).
5. Review preview before pressing **Commit ERP Snapshot**; it replaces the
   existing **POC ERP workforce snapshot only**, not NMC AI assessments.
6. Reload settings: saved snapshot ID, imported date and inspectors persist.

In **Scheduling**:
1. Excel upload widget is gone. An **Open ERP Integration Settings →**
   link is present instead.
2. `ERP SOURCE = EXCEL IMPORTED`, inspectors = 8; port selection becomes
   available. Scheduling continues to require an NMC-approved referral.
3. API status check:
```powershell
Invoke-RestMethod http://localhost:4200/api/ai/health
Invoke-RestMethod http://localhost:4200/api/si/erp/status
```

**Security regression:** malformed XLSX, illegal formulas, wrong row-4 headers,
unknown inspector/port, invalid dates and >3 MB uploads still fail closed;
unsaved previews never replace the current committed snapshot. No AI calls on
ERP upload.

## CI validation
GitHub Actions Angular build + complete `ai-proxy` regression suite, including
namespace-prefixed workbook tests, and Docker POC smoke must pass before review.
CI does not prove the operator's local Oracle migration or data state.

## Rollback
If necessary, checkout known-good prior UI/proxy code and rebuild `ai-proxy nmc`
while preserving all Docker volumes. No schema rollback is necessary.
A committed workforce snapshot is a separate JSON snapshot; recovering a prior
one requires an existing retained backup, not a `git checkout`.
