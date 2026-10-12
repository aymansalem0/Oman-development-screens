# MOEI Google SSO — Approved accounts only

**Implementation branch:** `feature/moei-google-sso-allowlist-20261013` (based on PR #88 single-login branch; not merged or locally deployed by ChatGPT).

## Business behavior

- Initially **only** `aymansalem0@gmail.com` is authorized; role **ADMIN**.
- No other Gmail / Google Workspace account can sign in until the ADMIN approves it in **Manage Google Users**.
- The administrator can add accounts with **VIEWER** (read only) or **ADMIN** (full POC actions), disable / re-enable accounts, or change roles. Changes persist in the existing Docker `nmc-fleet-results` volume at `/data/moei-google-users.json`.
- A Google account is linked on first sign-in to its immutable Google `sub` identifier. A later conflicting `sub` cannot impersonate the same email. Contact an admin if account recovery/replacement requires re-provisioning.
- Disabling an account or changing its role makes previously issued sessions invalid on the next backend request. Last active ADMIN cannot be disabled/demoted.
- In Google mode **local username/password login is disabled**. Only use `MOEI_AUTH_MODE=local` intentionally for a controlled standalone development fallback; it is not enabled by default.
- This POC uses a local persistent user allowlist and an in-memory session store (sessions reset when ai-proxy restarts), not the production Keycloak/UAE PASS user directory.

## One-time Google Cloud Console setup (required)

ChatGPT cannot create OAuth credentials in your Google Cloud project without access to that project.
1. In Google Cloud Console, select or create your own project.
2. Configure **Google Auth Platform / OAuth consent screen**. If the OAuth app is in Testing mode, add `aymansalem0@gmail.com` as a Google test user as well; that Google testing list is *separate* from this application's allowlist.
3. Create **OAuth 2.0 Client ID**, type **Web application**.
4. Add Authorized JavaScript origin: `http://localhost:4200`.
5. Add Authorized redirect URI **exactly**: `http://localhost:4200/api/moei/auth/google/callback`.
6. Copy the generated Client ID / Client Secret **into your local untracked .env**, never into GitHub or a chat.

Example entries (replace only the values):
```dotenv
MOEI_AUTH_MODE=google
MOEI_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
MOEI_GOOGLE_CLIENT_SECRET=YOUR_PRIVATE_CLIENT_SECRET
MOEI_GOOGLE_REDIRECT_URI=http://localhost:4200/api/moei/auth/google/callback
```

Preserve your existing Oracle, Airia, Google Sheet and other .env settings. If using a non-default host/port, update **both** the OAuth Console Authorized redirect URI and `MOEI_GOOGLE_REDIRECT_URI` to match exactly. Use HTTPS for any non-local deployment.

## Run (PowerShell in the repository)

```powershell
git fetch origin
git switch --track origin/feature/moei-google-sso-allowlist-20261013
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'  # optional: avoid paid automatic Airia incident calls during auth verification
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
docker compose @dc ps
```

If the branch already exists locally, replace the `git switch --track` command with `git switch feature/moei-google-sso-allowlist-20261013`.

Open `http://localhost:4200/#/moei/login`, then **Continue with Google** and sign in with the approved account. User Management is linked in the sidebar and available at:

`http://localhost:4200/#/moei/nmc/admin/users`

## Verification matrix

1. New Incognito window and direct deep-link to `/#/moei/nmc/vessel/9328471/case` → redirected to Login.
2. Non-approved Google account → 'not authorized' message. No session and all business API requests return 401.
3. Approved Google account → signed session; NMC and Smart Inspection are accessible.
4. Add another address as VIEWER in the Admin User Management screen; its own verified Google login works but all mutation APIs return 403.
5. Disable that account → its next request returns 401 and Angular sends it to login.
6. Attempt to disable the last ADMIN → rejected (409).
7. Log out → future session request returns 401.
8. Node tests: `node --test ai-proxy/test/moei-poc-auth.test.mjs ai-proxy/test/moei-google-sso.test.mjs`

This POC is not a substitute for production Keycloak/UAE PASS IAM, TLS, enterprise role hierarchy, user lifecycle governance or external security assessment.
