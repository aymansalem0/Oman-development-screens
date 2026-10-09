# NMC published Dashboards — dynamic navigation

## Business flow

1. Open **Dashboard Manager** from the main menu. The manager remains a
   permanent top-level entry; dashboard configuration is not mixed with
   published business dashboards.
2. Create a dashboard or open a central **DRAFT** with **Edit Shared Draft**.
3. Inside Dashboard Details choose **Show Published Dashboard Under**:
   - NMC Center
   - Smart Inspection
   - Settings
4. Save Changes → Save to Workspace → return to Dashboard Manager →
   Publish (requires publisher access).
5. The published dashboard automatically appears by **name** inside the
   **Dashboards** subfolder of the chosen section in the shared main menu.
   The name links to the **read-only published viewer**, not the designer.
6. To move an **already published** dashboard, in Dashboard Manager →
   Shared Dashboards choose a new location with **Show in menu** →
   **Update Menu**. This action requires publisher permission and records
   a versioned UPDATED revision; the published content remains unchanged.

## How the sidebar stays synchronized

- `GET /api/ai/dashboards/published` returns only published dashboard
  IDs, titles and menu placements; draft dashboards are never listed.
- Navigation reloads this registry when a page is opened, on navigation,
  periodically every 30 seconds and immediately after successful publication
  or menu relocation in the same session.
- When the published registry is unavailable, no substitute links are
  fabricated; the rest of NMC navigation remains usable.
- Existing dashboards without a `menuPlacement` property default to
  **NMC Center**. Central storage remains Oracle and its existing JSON
  document; **no new migration is required**.
- Previously published dashboards stay published and can be relocated in
  place; no republish, unpublish or new dashboard ID is required.

## Local branch and safe rebuild

```powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-dynamic-dashboard-menu-v4
# If already on this branch: git pull --ff-only origin feature/nmc-dynamic-dashboard-menu-v4

# Set this in your existing .env as well to ensure no automatic Airia calls:
# NMC_FLEET_AUTO_ENABLED=false

docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --no-deps --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml ps
```

Never use `docker compose down -v`. Do not recreate or reseed Oracle. The
existing central-dashboard schema migration 002 must already have been run.

## Acceptance tests

- Publish dashboards to each of the three menu areas; check each appears only
  under its assigned section and **Dashboards** folder.
- Drafts never appear in the main business navigation.
- A published dashboard opens its read-only viewer, without editing controls.
- Test renaming before publication, and moving an already published dashboard
  to another section; verify it disappears from the original location without
  being duplicated.
- Test refresh/new browser, unchanged historical risk assessments, and that
  nothing triggers Airia.
- `GET http://localhost:4200/api/ai/dashboards/published` returns just
  a published navigation list.
- `npm --prefix ai-proxy test`, `npm --prefix ai-proxy run check` and
  `npm run build` should pass before merging.

## Security boundary

The current dashboard publisher shared secret is a staging mechanism, not
per-user authorization or production-ready RBAC. The existing NMC POC does not
yet implement Keycloak / UAE PASS user identity for this flow. Published
dashboard navigation names are public to app users under the current access
model. Do not include confidential content until authenticated viewer access
and role-based navigation are implemented.
