# Fix — Publishing an Oracle-backed Smart Inspection DRAFT checklist

**Observed API:** `POST /api/si/v1/checklists/{uuid}/publish` replied 503 `SI_CHECKLIST_BACKEND_UNAVAILABLE`.

**Code-level diagnosis:** The Oracle normalized checklist publish path contained SQL `VALUES(:id,:group,...)`. Oracle reserves `GROUP` and can reject `:group` with `ORA-01745: invalid host/bind variable name`. This route catches unrecognized database errors and returns its generic 503. No evidence has been received yet from the user's actual Oracle error log, so this is the strongest code-supported likely cause, not an independently confirmed live-DB trace.

**Fix:** All bind variables in the five normalized publication INSERT operations are now safely prefixed `:p_...`. Regression mocks emulate Oracle rejecting reserved placeholders, and assert a valid DRAFT -> PUBLISHED transition. The failed publish previously passed through `catch => conn.rollback()`, so the draft should remain editable/retryable without loss.

## PowerShell commands (existing Windows Oracle POC)

Keep the exact Compose overlays you normally use. If `$dc` is not defined in the current PowerShell window:

```powershell
cd C:\Users\Admin\Oman-development-screens
$dc = @("-f","compose.yaml","-f","compose.oracle.yaml","-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
if (git status --porcelain) { throw "Review and save local changes first" }
git fetch origin
$branch = "feature/si-checklist-publish-oracle-bind-fix-20261013"
if (git branch --list $branch) {
    git switch $branch
    git pull --ff-only origin $branch
} else {
    git switch --track "origin/$branch"
}
docker compose @dc config --quiet
docker compose @dc build ai-proxy
docker compose @dc up -d --no-deps ai-proxy
docker compose @dc ps
docker compose @dc logs --tail=60 ai-proxy
```

Once the proxy reports `[si-checklist] STORAGE_ORACLE_READY schema=017`, sign in with Google, open the Smart Inspection checklist editor, select your previously created **DRAFT**, and click **Publish** once. The template should become **PUBLISHED**, with `revision=1` (or the next revision when editing an already published template). No reseeding or case reset is necessary.

If a 503 persists, do NOT re-create/delete your template or rerun any database-reset script. Immediately collect the relevant backend error code:

```powershell
docker compose @dc logs --since=10m ai-proxy |
  Select-String "si-checklist|ORA-|REQUEST_FAILED"
```

Redact any private data from console excerpts before sharing. Expected success: no `[si-checklist] REQUEST_FAILED` after publishing, and GET of the same checklist returns the new immutable published revision. The frontend's 503 alone is not enough to identify any other potential Oracle validation/constraint issue.

**Safety:** No DDL or migrations; no fleet changes; no Airia calls; no Oracle/JSON resets; POC drafts and published revisions preserved. PR is stacked on PR #106. Automated CI cannot guarantee deployed Oracle user privileges or unseen schema drift.
