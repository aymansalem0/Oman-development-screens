# PR #53 — One MOEI Maritime Platform Theme (NMC + Smart Inspection)

## Architecture / business acceptance

Smart Inspection is a **domain within the same MOEI maritime platform**, not a
second portal. Candidate Targeting, ERP Settings, Electronic Scheduling and
Pre-Inspection A04 now use exactly one root-level shared
`app-nmc-platform-header` and `app-nmc-platform-footer`.
The NMC Command Center also uses those **same shared Angular components**.
The white `app-nmc-navigation` remains the sole sidebar for both business
areas; the unrelated legacy blue Oman sidebar is excluded.

Shared header features:
- MOEI brand and National Maritime Center identity (same component/design)
- NMC Officer and alert navigation
- **One single العربية / English toggle** connected to the existing
  `LanguageService`, including persisted language setting
- The root `dir` swaps `rtl ↔ ltr`; sidebar physically moves to
  right in Arabic and left in English; layout offsets use
  `padding-inline-start`, with mobile hamburger support
- NMC retains its simulated AIS/LRIT status and clock; Smart Inspection
  displays a distinct POC identification, without claiming live AIS
- NMC map is redrawn on language change so its labels reflect the new locale

Shared footer features:
- MOEI / NMC maritime platform identity and clear POC / non-official-data caveat
- RTL/LTR placement consistent with the one white menu
- Rendered exactly once for each Smart Inspection route and reused on NMC
  Command Center; previous local per-page Smart Inspection footers removed

Bilingual content includes major headings, explanatory text, forms, queue
filters, inspector fields, scheduling policy settings, risk statuses, A04
preparation, evidence manifest, review, ERP import/preview controls. Backend
codes/IMO and source identifiers remain untranslated by design; these are
technical IDs rather than page labels.

## Windows PowerShell — checkout PR (no GitHub CLI needed)

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# Stop if uncommitted local changes would be overwritten.
git fetch origin pull/53/head:pr-53-si-platform-theme
git switch pr-53-si-platform-theme
git branch --show-current
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
```

### Oracle Database migration
**NO DB MIGRATION REQUIRED** for PR #53 (Angular HTML/TS/CSS only).
Do not run, rerun, or roll back any Oracle migrations to deploy this theme.
The branch is stacked on #52 → #51 → #50 → #49 → #48; on an older
installation, separately validate the relevant prior backend/database
requirements before attempting business workflows.

### Rebuild just Angular / Nginx

If PR #52's latest **ai-proxy** backend is already deployed locally:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=80 nmc
```

If PR #52 backend was *not* deployed and you want to exercise its ERP upload
fix as well, use:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
```

Preserve all volumes; **NEVER** `docker compose down --volumes`.
If your established stack uses `compose.google-psc.yaml`, insert
`-f compose.google-psc.yaml` between the base and Oracle override in ALL
compose commands.

## UI acceptance / bilingual RTL visual checks

Open and hard refresh (`Ctrl + Shift + R`):
- `http://localhost:4200/#/moei/nmc`
- `http://localhost:4200/#/moei/smart-inspection/candidates`
- `http://localhost:4200/#/moei/smart-inspection/scheduling`
- `http://localhost:4200/#/moei/smart-inspection/settings/erp`
- `http://localhost:4200/#/moei/smart-inspection/preparation/<APPROVED_CASE_UUID>`

For each route:
1. At top: identical shared white NMC/MOEI platform header, brand,
   officer, alerts and **one** العربية / English button.
2. Only the white NMC / Smart Inspection / Settings sidebar; no blue Oman
   sidebar or legacy Oman MTCIT header.
3. At bottom: one shared white MOEI/NMC footer; no page-specific duplicate
   footer on Scheduling or ERP Settings.
4. Toggle from English to Arabic: main labels translate, topbar, footer
   and navigation change to Arabic, sidebar moves **to the right**, content
   moves after it. Inputs/tables remain readable; technical IDs intact.
5. Toggle back: English and LTR sidebar **on the left** immediately.
6. Navigate from Candidate Center to Scheduling/ERP Settings and back:
   language/direction persists. Hard-refresh browser: language persists.
7. Check 1440px desktop, medium-width icon menu (961–1220px), <=960px
   mobile white hamburger and narrow <=540px mobile header. Ensure no
   overlapping controls, clipped tables or double scrollbars.
8. On NMC Command Center verify status pill, AIS clock, alerts and map still
   work after changing languages.
9. Save/Approve/Import/PDF/AI user operations remain unchanged; this PR
   modifies only presentation, layout and i18n bindings.

## CI / limits

Angular build, existing backend regression and Docker startup/smoke are
automated by GitHub Actions. They do **not** verify live browser pixel-perfect
RTL screenshots or user's local Oracle state. Do visual acceptance above
before merging or promoting.

## Rollback

Switch to the previous verified Git ref/branch and rebuild `nmc` only.
No SQL migration or data rollback required. Existing ERP workforce snapshots,
NMC assessments/risk and inspection cases remain unchanged.
