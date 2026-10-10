# Smart Inspection Settings — Risk-Style Slider Editor (PR #58)

## Visual change requested

The **first screenshot** of `Settings → Inspection Settings → Targeting & Priority Rules`
showed five very large number-only text boxes. The business user asked for the
**same form as the NMC Risk Configuration weight sliders** ("Risk scroll").

The updated Inspection Settings panel follows the NMC Risk editor:

- A **horizontal teal slider** for each of five SI-P01 percentage weights,
  with a **small synchronized numeric input** beside it.
- Live **TOTAL WEIGHT** badge with normal/invalid states.
- **Normalize to 100%** action, distributing integer percentages by largest
  remainder (stable order) without changing the intended relative balance.
- Published source reason scores NMC / Service Request / PSC also use the same
  slider + compact number pattern; they are **0–100 ratings**, not percentage
  weights, and **do not** need to total 100.
- The basic inspection priority threshold is also now a range + compact
  number control, matching the Risk administration pattern.
- Same MOEI teal/white theme, responsive mobile layout, bilingual Arabic/English
  and RTL/LTR; accessible slider labels; helper text for each criterion.
- Editing any slider or its numeric input **invalidates the previous impact
  preview**. Publisher cannot publish stale settings without reviewing a fresh
  preview. Preview/publish server-side checks and permissions are unchanged.
- Normalization changes ONLY the browser's unsaved draft. It does NOT publish,
  make an AI call, change official NMC Risk or alter a vessel or inspection case.

## User acceptance

Open `http://localhost:4200/#/moei/smart-inspection/settings/targeting`.

1. Five weight rows resemble the NMC Risk **range + numeric field** layout.
2. Drag Saved Vessel Risk from 30 to 35. Numeric value becomes 35 and
   total becomes **105% / invalid**; the prior impact preview disappears.
3. Click **Normalize to 100%**. Five integer values are updated, and
   total becomes **100% / valid**. The other weights retain approximate proportions.
4. Change Service/PSC source priority on the lower section; its numeric
   value follows the range; **total stays unchanged**.
5. Test numeric editing, 0/100 endpoints, keyboard arrows and small-screen
   width; verify both Arabic/RTL and English/LTR.
6. Enter Editor key and **Preview Fleet Impact**; no Airia call occurs.
   Publish requires Supervisor/Publisher key, reviewer, justification and
   explicit confirmation; **do not publish** for visual testing.

## DB / API impact

**NO DATABASE MIGRATION REQUIRED IN THIS PR.**
This PR modifies **only the Angular Inspection Settings UI**, a source-level
UI contract regression test and documentation. The existing SI-P01 targeting
policy schema, actual published versions, NMC assessments, Oracle event
tables and Airia integration remain unchanged.

Stack dependency: parent PR **#57** (including #56 SI-P01 and earlier feature
PRs). Parent #56 has a separate **migration 011** requirement in Oracle mode.
If the parent code isn't yet deployed, verify any missing prerequisite migration
against its own runbook. **Never reapply an already executed migration.**

## Windows PowerShell checkout (no gh CLI)

```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# If any local edits exist, preserve them before switching branches.
git fetch origin pull/58/head:pr-58-si-risk-sliders
git switch pr-58-si-risk-sliders
git branch --show-current
```

## Docker

Only the Angular `nmc` service needs rebuilding for this UI-only PR, provided
the backend from earlier PRs is already deployed:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=60 nmc
```

If the running proxy is from a **pre-#56** release, deploy/prerequisite-check
the parent backend separately before attempting to edit SI-P01 policies.
If you use `compose.google-psc.yaml`, include that between base and
Oracle files in **every** Docker Compose command.

Do **not** run `docker compose down --volumes`.

### Rollback

Checkout a previously verified branch and rebuild `nmc` only. The UI-only
change does not migrate data or change already-published risk weights; any
business-initiated Publish action remains a separate auditable operation.
CI Angular build and static contract checks do not replace browser visual QA.
