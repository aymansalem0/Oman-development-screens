# MOEI NMC + Smart Inspection — Single Admin Login (POC)

**Scope:** one Admin user, one login page and one same-origin server session for
all NMC and Smart Inspection screens. Role catalog, individual officer accounts,
UAE PASS/Keycloak production IAM and multi-user RBAC remain **future scope**.

## Identity

- Login route: `http://localhost:4200/#/moei/login`
- Username: environment variable `MOEI_ADMIN_USERNAME` (default `admin`).
- Password: **MUST be supplied** via local `.env` or secure process environment
  using `MOEI_ADMIN_PASSWORD` (minimum **12** characters; no default password).
- Role: `ADMIN`; backend accepts this role for current POC Editor & Publisher
  operations. Business approvals, supervisor confirmation dialogs, plan audit
  reasons, candidate source policies and potentially paid AI explicit consent
  still apply.
- Password is never stored in frontend source, sent to localStorage, shown in
  backend responses or committed to GitHub.
- Sessions: random opaque HttpOnly, SameSite=Strict cookie; 8h expiry,
  server-side revocation on Logout, no JS-visible credential.
- Every change request also requires `X-MOEI-CSRF: 1`, injected automatically
  by the Angular HTTP interceptor; cookies alone cannot trigger state changes.
- A full browser restart may keep the cookie until expiry; the Angular guard
  checks backend login state on route entry.
- Old `X-NMC-DASHBOARD-KEY` screens use an **internal non-secret sentinel**
  solely for backwards compatibility; interceptor removes this header before
  network transmission. Server authenticates the HttpOnly session and assigns
  ADMIN on each request.
- Only `GET /api/ai/health`, `/api/ai/psc/health` and
  `/api/ai/nmc/incidents/health` remain anonymous for operational probes.
  All other NMC and SI API requests require login.

## Local configuration (PowerShell)

Inside the repository folder, edit existing **untracked** `.env` (this
repository's `.gitignore` already excludes it) and add:

```dotenv
MOEI_ADMIN_USERNAME=admin
MOEI_ADMIN_PASSWORD=<a-unique-private-password-of-at-least-12-characters>
```

Keep the original Oracle, service-account, Airia and other variables in
`.env`; do not overwrite or print them. **Never share the password in chat.**

If a `.env` file cannot be edited, set the two variables in the shell session
before Compose instead. Avoid putting a plaintext password on a command line,
inside Git, or in a PowerShell transcript.

After checking the effective Compose configuration:

```powershell
$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml',
      '-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```

**Do not recreate Oracle.** This change requires both Angular `nmc` and
Node `ai-proxy` to be rebuilt/recreated, but no Oracle migration.

Open `http://localhost:4200/#/moei/login`, sign in as `admin`
with the locally configured password, then choose NMC or Smart Inspection
from the shared sidebar. The sidebar displays `admin · ADMIN` and
`Sign out`.

## Backend endpoints

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/moei/auth/login` | Check username/password; issue opaque cookie. |
| GET | `/api/moei/auth/session` | Verify current user, role and expiry; never return password. |
| POST | `/api/moei/auth/logout` | Revoke active cookie/session. |
| Other `/api/ai/*` and `/api/si/*` | Existing business APIs, now protected by the shared session. |

### Example login body
```json
{"username":"admin","password":"<secret-from-local-env>"}
```

### Example session response
```json
{"status":"ok","user":{"username":"admin","role":"ADMIN"},
 "expiresAt":"<server-issued-time>"}
```

## Automated tests

```powershell
node --test ai-proxy/test/moei-poc-auth.test.mjs
node --test scripts/test-si-c01-visible-access.mjs
node --test scripts/test-si-unified-candidate-grid.mjs
```

The Docker CI smoke workflow uses a randomly generated **CI-only** password,
logs in via the reverse proxy, verifies NMC and SI API access, CSRF rejection
and Logout revocation. It does not use any real ministry or Airia account.

## POC security / production gap

This one-Admin authentication is deliberately a **local POC** replacement for
typing Editor/Publisher keys on every screen. In production, use Keycloak/UAE
PASS integration with server-issued short-lived tokens, central user directory,
role-aware authorisation, persistent audit identity, HTTPS and managed secrets.
A single user is not suitable for separation-of-duties in regulated decisions.
Business supervisory approvals are still a separate explicit step in the POC;
do not represent its one-user role as ministry-grade delegated authority.
