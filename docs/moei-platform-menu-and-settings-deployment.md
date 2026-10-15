# MOEI Maritime Unified Platform — Menu, Settings & Navigation (PR #54)

This change is a **platform UI/navigation refactor only**. All screens still
use the white NMC/Smart Inspection sidebar and the same saved Arabic/English
language setting and RTL/LTR direction. It is stacked on PR #53, which
contains the prior MOEI shared header/footer work.

## Requirements delivered

1. The main platform title in the shared header displays exactly:
   **MOEI Maritime Unified Platform** (Arabic:
   **المنصة البحرية الموحدة لوزارة الطاقة والبنية التحتية**).
   Brand references on existing NMC headers and the shared footer are aligned,
   while each NMC feature retains its own specific screen heading.
2. **Smart Inspection** now exposes the implemented screens in the sidebar:
   - Candidate & Targeting Center
   - Inspection Preparation & A04 (new selectable list of **approved cases**,
     because the existing detail screen requires a case UUID)
   - Electronic Scheduling
   - Vessel Inspection Workbench (POC, bound to selected vessel IMO from NMC)
   - Published Smart Inspection dashboards still appear dynamically.
3. **Settings** is divided into two expandable groups:
   - **NMC Settings:** Risk Management, Data Quality Management,
     Operational Guidance Rules, Dashboard Manager and published Settings dashboards.
   - **Inspection Settings:** Targeting & Priority Rules and ERP Integration Simulator.
4. Targeting priority threshold, impact preview and controlled publication have
   moved from Candidate Center into a real dedicated screen
   `/moei/smart-inspection/settings/targeting`; the existing APIs and central
   policy revision/version checks are reused. No business rules change.
5. Inspection Preparation gets an accessible menu landing route
   `/moei/smart-inspection/preparation`, listing only centrally **approved**
   SI inspection cases and linking to the established A04 case detail screen
   `/moei/smart-inspection/preparation/:caseId`. No fake cases created.
6. White sidebar increases slightly from **216px → 240px** (+24px).
   Matched desktop NMC and SI offsets, footer, ERP Settings, and RTL placement.
   Tablet **66px** icon rail and mobile off-canvas navigation stay unchanged.
7. Unrelated legacy Oman screens, Oracle assessments, Airia requests, ERP
   snapshots, case approvals and inspection scheduling are untouched.

## Windows PowerShell commands — no GitHub CLI required

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# Stop and save/stash any uncommitted changes first.
git fetch origin pull/54/head:pr-54-moei-menu
git switch pr-54-moei-menu
git branch --show-current
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
```

### Database migrations: NONE
**NO DATABASE MIGRATION REQUIRED.** This PR modifies Angular routes,
components, templates, styles, docs and UI tests only.
**Do not reapply Oracle migrations 008, 009 or 010** to install navigation.
The parent PR chain (#53 → #52 → #51 → #50 → #49 → #48) has its
*own separate* backend/Oracle prerequisites. Validate those separately if
the underlying business API features have not been deployed yet.

### Docker deployment: only frontend

If the backend from PR #52 (and required dependencies) is already running:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=70 nmc
```

If an older proxy is installed and you also need the stacked Excel backend
fix, rebuild `ai-proxy nmc` after validating its Oracle migration
dependencies. Do **not** run `docker compose down --volumes`.

If your existing environment uses the Google PSC compose override, insert
`-f compose.google-psc.yaml` **between** the base and Oracle overrides
in each command.

## UI/Business acceptance

Hard refresh `Ctrl+Shift+R` and check:
- `http://localhost:4200/#/moei/nmc` → title shows
  **MOEI Maritime Unified Platform** and normal NMC command center.
- `http://localhost:4200/#/moei/smart-inspection/candidates` → navigation
  now highlights only Candidate & Targeting; target priority editing is
  linked to its own Inspection Settings page.
- `http://localhost:4200/#/moei/smart-inspection/preparation` →
  approved case queue; if there are no approved SI cases, a useful empty
  state with a Candidate Center link is shown (not a broken URL).
- `http://localhost:4200/#/moei/smart-inspection/scheduling` →
  Electronic Scheduling; existing ERP workforce snapshot intact.
- `http://localhost:4200/#/moei/smart-inspection/settings/targeting` →
  test impact preview with Editor key and *do not publish* in the UI test
  unless authorized; central priority rules remain versioned.
- `http://localhost:4200/#/moei/smart-inspection/settings/erp` →
  existing ERP upload simulator page, unchanged business behavior.
- NMC Settings → risk, data quality, guidance and Dashboard Manager; each
  link opens real pages and highlights its own active item.

Repeat in Arabic:
- White menu physically moves to the **right**, nested Settings preserve
  NMC vs Inspection groups and their Arabic labels.
- Content and platform title follow the same persisted Arabic/English
  toggle and RTL/LTR mode. Header/footer and page body never overlap.
- At widths >1220px the sidebar is 240px; 961–1220px keeps the compact
  icon rail at 66px; <=960px retains the slide-out hamburger sidebar.
- Confirm published dashboard groupings are not lost.

## Rollback
No SQL/data rollback. Switch to previous verified Git ref and rebuild **nmc**
only, preserving all volumes, ERP snapshots, NMC/Inspection Oracle data.
This PR does not merge/ship automatically. CI/build success is not
equivalent to a live browser visual QA pass.
