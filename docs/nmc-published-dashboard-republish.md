# Editing and republishing an existing NMC dashboard

## Business workflow

1. Open **Dashboard Manager** → **Shared Dashboards**.
2. For a **Published** dashboard select **Edit Published**. The platform opens
   the linked editable revision, not a disconnected "Use as Template" copy.
   Repeated clicks on **Edit Published** resume the same revision rather than
   creating another one.
3. The currently published version continues to be visible under its existing
   menu item and read-only URL while you edit Widgets, charts, names, placement,
   and filters in the Designer.
4. Choose **Republish** in the Designer to automatically commit the CURRENT
   editor configuration centrally and publish the exact saved revision.
   Alternatively, choose **Save to Workspace**, go to **Dashboard Manager**
   and click **Republish Changes** on the original published dashboard card.
5. The existing published dashboard row is updated **atomically**; its same
   ID, menu link, and shareable URL continue to identify it. Only the newly
   approved revision becomes visible.
6. The existing publication history gains a new **PUBLISHED** revision, and the
   working draft is archived to avoid stale side-by-side duplicates.

## Behavior, data safety and concurrency

- The revision is internally stored as a DRAFT until re-published, but it is
  displayed inside the original published dashboard's management card as
  **Unpublished changes in progress**, not as an unrelated dashboard.
  Other viewers do not see unapproved edits.
- Editing without Republish does not alter any published dashboard.
- The server rejects republishing an **unsaved** (v1) or **unchanged** revision
  with an explicit error; version increments cannot masquerade as edits.
- Republishing from the Designer first writes the current editor state to the
  central draft and only then publishes the **server-returned** exact version.
  It does not rely on browser-local saved versions.
- Concurrent editing is rejected at republish if the original published
  version changed after the draft was opened (HTTP 409).
- The Oracle transaction updates the published record, writes immutable
  revision history, and archives the working draft as one transaction.
- The staging publisher key still controls approval; the editor key controls
  starting/saving drafts. This is **not** identity-based authorization;
  Keycloak integration remains future work.
- Published title/placement changes are reflected in dynamic NMC navigation.
- No migration is required. Existing Oracle NMC_DASHBOARD and
  NMC_DASHBOARD_REVISION tables are reused.
- No changes to AI scores, risk rules, case data or Airia agents.

## Safe local rollout

From PowerShell within the Git working tree:

```powershell
git status --short
git fetch origin
git switch --track origin/feature/nmc-republish-workflow-fix-v7
# If already local:
# git switch feature/nmc-republish-dashboard-v6
# git pull --ff-only origin feature/nmc-republish-dashboard-v6
```

Check your *existing* local `.env` for `NMC_FLEET_AUTO_ENABLED=false`
and the previously configured editor/publisher keys. Do not share keys in chat.

```powershell
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml up -d --no-deps --force-recreate ai-proxy nmc
docker compose -f compose.yaml -f compose.google-psc.yaml -f compose.oracle.yaml ps
```

Never run `docker compose down -v` or recreate Oracle volumes.

## Business test

- Publish a dashboard and note its original published link/ID.
- Edit Published; change chart style and/or dashboard title; save centrally.
- Open the old URL in another browser: the old version must remain visible.
- Confirm only the original published card appears in Dashboard Manager, with
  a **Continue Editing** action and a **Republish Changes** action once the
  revision is centrally saved.
- Republish from either the Designer or Manager; open the same original URL
  again: it must show the new content (not merely an incremented version).
  The sidebar should update the title if changed, without a duplicate card.
- Test clicking Edit Published twice before republishing: it resumes the same
  draft. Attempt republishing an unchanged draft: the server must reject it.
- Check Version History for a new PUBLISHED entry and absence of the archived
  working revision from Shared Dashboards.
- Two edits based on the same published version: republish A succeeds;
  republish B fails with a clear version-conflict message.
