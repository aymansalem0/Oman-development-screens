# Smart Inspection — one white NMC navigation only (UI fix)

**Scope:** UI / Angular only. **No Oracle schema or data migration.**
No SQL, no Airia calls, no NMC risk changes. Designed as a small PR stacked on
Smart Inspection Preparation PR #50, which itself depends on PR #49 and NMC PR #48.

## What changed
- Root `AppComponent` treats **both** `/moei/nmc/*` and
  `/moei/smart-inspection/*` as dedicated maritime areas.
- **Blue legacy Oman demo sidebar and MTCIT top bar are hidden** on these routes.
  Legacy unrelated Oman demo routes intentionally keep their existing shell.
- Only `<app-nmc-navigation>` (white NMC Center / Smart Inspection / Settings menu)
  is shown. It is retained on Candidate Center and A04 Preparation and added
  on **Electronic Scheduling** and the old candidate demo route.
- Responsive layout reserves the sidebar width so content no longer sits
  behind it: 216px desktop, 66px medium screens, overlay toggle on mobile.
  Arabic RTL uses `padding-inline-start` and the existing right-hand navbar.
- In Smart Inspection, the white sidebar begins at **top 0** because the legacy
  Oman top bar is removed. Existing NMC Command Center retains its own MOEI header
  and the white menu's 82px header offset.

## Windows PowerShell (does not require `gh`)
```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# STOP and review if uncommitted changes would be overwritten.
git fetch origin pull/51/head:pr-51-si-white-menu
git switch pr-51-si-white-menu
git branch --show-current
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
```

### No DB migration
**No DB Migration Required** for this PR. Do not rerun 008, 009, 010 or any
other schema/data migration just to apply the menu fix.

### Rebuild **only** Angular/Nginx; preserve ai-proxy/Oracle/volumes
```powershell
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=70 nmc
```
For a deployment that already uses the Google PSC compose override, include
`-f compose.google-psc.yaml` between base and Oracle compose consistently.
Never run `docker compose down --volumes`.

### Visual acceptance (hard refresh Ctrl+Shift+R)
- `http://localhost:4200/#/moei/smart-inspection/candidates`
- `http://localhost:4200/#/moei/smart-inspection/scheduling`
- `http://localhost:4200/#/moei/smart-inspection/candidates/demo`
- `http://localhost:4200/#/moei/nmc`
- From a created SI case: `.../#/moei/smart-inspection/preparation/<CASE_UUID>`

Expected: Smart Inspection pages have exactly **one white sidebar** at the
left (right in Arabic); no blue sidebar or Oman MTCIT header; candidate contents
are not obscured; the NMC command center retains its own MOEI header and white
menu; original unrelated Oman demo screens are unchanged. On narrow screens,
use the navigation toggle; on medium screens icons-only navigation is intentional.

## Rollback
No database rollback needed. Revert to prior known-good UI Git ref and
rebuild **nmc only**. Existing Oracle data and backend containers stay intact.
