# Seafarer pre-application readiness and unified SDB journey

This branch adds an isolated, runnable **contract sandbox**, based on Smart Inspection PR #134 (`119b7dd3d3e27abf0e8d54f8268f6dcc01d2b190`). It does not merge or update any other branch. All SDB writes use one separate JSON store. No NMC/SI case, inspection plan, workforce, fleet assessment, Oracle schema or existing volume is reset.

## Screens

| Screen | URL after the existing host / `/#` | Purpose |
| --- | --- | --- |
| Pre Application Readiness | `/moei/seafarers/readiness` | Candidate KPIs, search, source status, seafarer profile, individual CoP/medical/passport dates, photograph reference, clearances, blockers, source simulation and audit |
| Seafarer Services | `/moei/seafarers/services` | SSO-bound customer dashboard and one Issue / Renew SDB service |
| Company No Objection | `/moei/seafarers/company` | Company-scoped renewal portfolio, objection reason and reference, explicit no objection / company HOLD release |
| Notifications | `/moei/seafarers/notifications` | Welcome, evidence changes, readiness, HOLD/release, expiry, invoice/payment outcome, issuance and fulfilment |
| Printing & Delivery | `/moei/seafarers/fulfilment` | Print queue, print confirmation, postal carrier/tracking, collection appointment and handover |

English/Arabic and RTL use the existing platform language service and maritime shell. The module is available from the main **Seafarer Management** navigation section.

## Business flow

1. A qualifying, currently valid academy CoP event creates a **Potential Seafarer** profile, linked by the authoritative national identity. A welcome notification congratulates the candidate and lists the remaining SDB requirements. A later certificate adds to the same profile.
2. Readiness independently evaluates the four sample CoP categories, their status and dates; MARASI medical fitness, applicable service and validity; passport number, issue/expiry dates and status; source photograph reference; and the relevant explicit academy/company clearance. Existing applicable CoC and endorsement gates are retained in the model.
3. A missing response, pending clearance, unavailable source or stale verification is **pending verification**. Silence never creates a no objection. A source-owned HOLD remains blocked until its owner supplies the relevant clearance.
4. Every accepted source event produces an in-app notification, recalculates readiness and records source/event evidence. Replayed identical events do not duplicate records or notifications. An event ID reused with different content, old sequence, source mismatch or academy mismatch is rejected.
5. Authenticated customers see their own record. The single SDB service chooses **first issuance** or **renewal** from the existing SDB record. A readiness failure displays the remaining requirements and prevents submission.
6. Ready applicants choose **electronic only** or **electronic + printed booklet**. Physical delivery is offered only for the printed option: post or collection at the MOEI service centre.
7. Contact/recipient details prefill from the profile and remain editable. Source-owned passport, qualifications and fitness are not editable in this form. The customer confirms a declaration.
8. The server creates and freezes an itemised illustrative invoice: service fee + optional print fee + optional postal fee. Browser-submitted totals are ignored. Fees are not charged for unselected options.
9. Payment and issuance re-evaluate current evidence. Failed or cancelled sandbox payment retains the invoice for retry. A repeat payment request never creates a second issuance. A HOLD arriving after invoicing blocks payment before any simulated charge.
10. Successful **sandbox** payment creates a specimen electronic SDB. First issuance links a new sandbox SID to the profile; renewal retains the existing SID and previous booklet reference. The customer sees dates, payment reference and fulfilment status, and can download the sandbox record as JSON.
11. Printed options create a separate print job. Postal dispatch requires carrier and tracking reference. Collection requires a future appointment. Each transition creates an in-app notification containing the tracking or appointment details. The electronic record remains available while printing progresses.

## Runtime / branch isolation

Use a separate worktree so local uncommitted NMC/SI edits stay in their existing working directory:

```powershell
git fetch origin
git worktree add ..\MOEI-Seafarers-SDB origin/feature/moei-seafarers-pre-application-readiness-20261015
cd ..\MOEI-Seafarers-SDB
```

The command above creates a detached, runnable checkout of this branch. To edit it independently, create a local branch with `git switch -c local/seafarers-sdb` inside the new worktree. Do not move or discard changes in the other worktree.

For the existing local POC stack, rebuild only the two changed services with the same overlays and environment already used for that stack:

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml -f compose.google-psc.yaml -f compose.incident-google.yaml build ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml -f compose.google-psc.yaml -f compose.incident-google.yaml up -d --no-deps ai-proxy nmc
```

Do not delete volumes or run SQL resets. There are **no SDB Oracle migrations**. Switching the running stack to this image is a local deployment action; creating/pushing this Git branch does not do that automatically. A new worktree needs the appropriate local `.env` and any existing secret-file mounts; these are never included in Git.

To run a parallel JSON-only sandbox without touching the running project's containers or named volume, use a **different compose project and port** (Google redirect URI must match that port and be registered with the identity provider):

```powershell
$env:NMC_HOST_PORT='4300'
$env:MOEI_GOOGLE_REDIRECT_URI='http://localhost:4300/api/moei/auth/google/callback'
$env:NMC_DB_MODE='json'
docker compose -p moei-seafarers-sdb -f compose.yaml up -d --build ai-proxy nmc
```

This creates its own compose-prefixed data volume. Use the already approved Google account; the same Google SSO implementation is retained. Do not enable fleet automation or live AI agents for this sandbox. If the existing `.env` enables those, explicitly set `NMC_FLEET_AUTO_ENABLED=false`, `NMC_A03_AUTO_ENABLED=false`, `NMC_INCIDENT_AUTO_TRIAGE_ENABLED=false` before launching this separate stack. Production UAE PASS / MOI federation is not provided by the current Google-based POC.

Set `SDB_ENABLED=false` to disable the new API without changing existing NMC/SI routes. Storage defaults to `/data/sdb-readiness-sandbox.json`; corrupted or incompatible SDB storage fails closed for SDB requests without preventing NMC from starting. The SDB monitor runs every minute after first use; source events also update readiness immediately. The browser refreshes its view every 30 seconds and offers manual refresh.

## Identity and company authorisation

The existing HttpOnly SSO session is required. A server-owned mapping binds a verified OIDC subject (preferred) or approved email to a seafarer or company. For example, in the private local environment:

```dotenv
SDB_SSO_BINDINGS_JSON='{"verified-oidc-sub-for-customer":{"seafarerId":"SF-002"},"verified-oidc-sub-for-employer":{"companyId":"COMPANY-NATIONAL"}}'
```

Users must also be approved in the existing Google user allowlist. Normal customer/company users can remain `VIEWER` in the original NMC account system: SDB validates their domain association before each action; it does not grant NMC/SI write privileges. ADMIN or an explicit operations binding may read the operational dashboard. An unbound customer sees no personal records.

For an ADMIN demonstration account only, customer/company screens show a clearly marked **sandbox preview** selector. The server rechecks the caller's operations privilege and scopes the preview. Ordinary users cannot choose arbitrary profile/company IDs. Operations cannot directly release a company objection; the simulator must use the company-scoped preview. A company's decision never clears an academy HOLD.

The SDB login guard preserves a fixed, allowlisted return route through server-owned OAuth state. Existing NMC/SI login destinations remain the default. External or arbitrary return URLs are ignored.

## Source event contract

There is no outbound call to a real academy, MARASI, MOI/ICP, postal provider, payment service or SMS/email gateway. The three inbound adapters and controlled UI simulators operate on the sandbox data only. Confirm the actual identity/passport authority (MOI/ICP), government interface and payload mapping with MOEI before connecting an external system.

`POST /api/seafarers/v1/integrations/{ACADEMY|MARASI|MOI_ICP}/events`

Each source has a separate deployment secret, at least 32 characters:

- `SDB_ACADEMY_WEBHOOK_SECRET`
- `SDB_MARASI_WEBHOOK_SECRET`
- `SDB_MOI_ICP_WEBHOOK_SECRET`

The sender includes `X-SDB-Timestamp` (10-digit Unix seconds) and `X-SDB-Signature` (`sha256=` + hex HMAC-SHA256 of `timestamp + '.' + exact raw UTF-8 JSON body`). Requests beyond a five-minute signature window or without the configured secret are rejected. Use HTTPS outside a local test environment. Payload maximum: 64 KiB. Accepted event identities and per-record source sequence are persisted.

Envelope:

```json
{
  "schemaVersion": 1,
  "eventId": "ACADEMY-UNIQUE-EVENT-0001",
  "sequence": 1,
  "occurredAt": "2026-10-15T10:00:00Z",
  "nationalId": "DEMO-NATIONAL-NEW-001",
  "academyId": "ACADEMY-GULF",
  "type": "COP_UPDATED",
  "data": {
    "name": "Demo Candidate",
    "id": "ACADEMY-CERT-0001",
    "type": "PST",
    "status": "VALID",
    "issueDate": "2026-10-15",
    "expiryDate": "2027-10-15",
    "reference": "ACADEMY-EVIDENCE-0001"
  }
}
```

`occurredAt` controls evidence freshness; receipt time cannot turn old evidence into fresh evidence. Replace example timestamps and event IDs for each new event. A first-certificate event must be valid and within its actual validity dates.

| Source | Event | Required data |
| --- | --- | --- |
| ACADEMY | `COP_UPDATED` | `id`, `type` (PST/FPFF/EFA/PSSR), `status` (VALID/REVOKED/SUSPENDED), `issueDate`, `expiryDate`, `reference`; `name` for first candidate |
| ACADEMY | `ACADEMY_CLEARANCE` | `status` (HOLD/NO_OBJECTION), `reference`, `reason` for HOLD; matching `academyId` |
| MARASI | `MEDICAL_UPDATED` | `reference`, `status` (FIT/UNFIT/PENDING/REVOKED), `issuedAt`, `expiryDate`, `validFor` (FIRST_ISSUE/RENEWAL) |
| MOI_ICP | `IDENTITY_UPDATED` | `name`, `nationality`, `number`, `issueDate`, `expiryDate`, `status` (VALID/REVOKED/PENDING), `photoReference`, `reference` |

The `photoReference` demonstrates source association; the current sandbox shows an initials placeholder. It does not download or expose a real passport photograph. A protected media endpoint and the source's image format/access contract are required for actual portrait retrieval.

## Customer and operations APIs

All below require an authenticated session. POST additionally requires `X-MOEI-CSRF: 1`.

- `GET /api/seafarers/v1/dashboard` — scoped profiles, prerequisites, notifications, audit and fixture connector status.
- `GET /api/seafarers/v1/profiles/{id}` — own/associated profile, or operations access.
- `POST /api/seafarers/v1/profiles/{id}/applications` — ready, bound applicant starts/reuses an active request.
- `POST /api/seafarers/v1/profiles/{id}/company-decision` — associated company records HOLD/release with reason/reference.
- `POST /api/seafarers/v1/applications/{id}/options` — version, format, delivery, recipient, declaration; locks once invoiced.
- `POST /api/seafarers/v1/applications/{id}/invoice` — server-priced, idempotent invoice.
- `POST /api/seafarers/v1/applications/{id}/pay` — **sandbox only** result and idempotency key; no actual money is collected.
- `POST /api/seafarers/v1/applications/{id}/fulfil` — operations advances printing, dispatch or collection.
- `POST /api/seafarers/v1/notifications/{id}/read` — scoped notification acknowledgement.
- `POST /api/seafarers/v1/profiles/{id}/simulate` — operations-only fixture events, separately labelled in the UI.

## Demonstration scenarios

1. `SF-001` has one CoP. Apply **complete 4 CoPs** in integration sandbox: individual requirements and readiness update. Apply academy HOLD, then source no objection; inspect the seafarer's notifications.
2. **First qualifying CoP → new candidate** demonstrates new profile creation, national-ID association, congratulations and remaining requirements.
3. Open customer services using `SF-002` preview. Select electronic only, confirm prefilled contacts, generate invoice and simulate successful payment. There is no print/postage fee or physical job. A new SID is linked to the profile.
4. Use `SF-003` for renewal with electronic + print + post. SID remains unchanged. In Printing & Delivery: confirm printed, enter carrier/tracking, dispatch and confirm delivered. Inspect the tracking notification.
5. Use collection instead of post in a fresh sandbox record; a future pickup appointment is mandatory before marking ready for collection.
6. `SF-004` has a company HOLD. In the corresponding company preview, enter a new case reference and no objection. Confirm the company cannot access a different company's seafarer or clear an academy HOLD.
7. Create an invoice, then place a company/academy HOLD in another screen; payment stays blocked. Source release allows the same invoice to continue.
8. `SF-005` has expired medical, `SF-006` has expired passport, `SF-007` has unavailable MARASI. Each is blocked for its actual reason. Source simulators restore the corresponding evidence.
9. Test payment FAILED/CANCELLED before SUCCESS. There is one invoice and at most one issuance.
10. Refresh/restart the API after using the actual volume: application, notifications and audit remain saved.

Each fixture supports one completed sandbox issuance cycle; a completed application reopens its issued record. A new production renewal cycle, official suspension/revocation and refunds require the confirmed registry/payment policy.

## Explicit sandbox assumptions and remaining external work

- Four CoP labels follow the supplied operating document's four-CoP requirement, using sample code mappings; actual source codes and category rules need confirmation.
- Source freshness 72 hours, reminders 30 days before expiry and specimen booklet duration five years are **demonstration policy constants**, not statements of UAE law.
- Illustrative fees are AED 100 first issue, AED 80 renewal, AED 50 print and AED 25 post. No tax/exemption/official fee schedule is claimed. The server freezes its fee version on the invoice.
- No automated legal entitlement or official SDB is generated. A production approval/authorisation gate, signing, official registry/SID allocation and authorised issuance policy must replace the sandbox issue adapter.
- Notifications are delivered **in-app**. SMS/email and webhook receipt delivery channels are not connected or claimed as sent.
- Live academy/MARASI/MOI passport/photo data, protected photograph retrieval, provider authentication, payment callbacks/reconciliation/refunds and printing/carrier integrations require their approved contracts and credentials.
- JSON storage is intended for a single-process POC. Production identity assurance, durable queue/outbox, database transactions and deployment scaling belong to the real integration implementation.

## Validation

```bash
npm install
npm run build
npm install --prefix ai-proxy
node --test ai-proxy/test/seafarer-workspace.test.mjs ai-proxy/test/seafarer-http.test.mjs
node --test scripts/test-moei-navigation.mjs scripts/test-moei-admin-login-ui.mjs ai-proxy/test/moei-google-sso.test.mjs ai-proxy/test/si-inspector-guided-work-orders.test.mjs
```

The new checks cover eligibility/expiry, source ordering, duplicate/conflicting events, signed ingress, national-ID candidate creation, welcome/change/HOLD notifications, company isolation, SSO account scoping, invoice pricing, failed payment, changed prerequisites, issuance idempotency, SID continuity, postal tracking, collection appointments, persisted state and rollback on write failure. CI also tests the same source files inside the AI proxy Docker image and checks the Nginx route through the composed stack.

## Current local validation status

- Angular production build: passed, including the final formatted implementation.
- Focused readiness/HTTP/SSO/navigation/inspector regressions: 45 passed.
- Existing backend suite: 206 passed, one pre-existing optional test skipped, zero failures.
- Browser QA and Docker execution: pending. The local runtime disallows Chromium Unix sockets; the separate cloud browser cannot reach the local preview. A browser CI workflow and reproducible script are included for execution after publication approval.

## Draft review and integration

The implementation is kept on `feature/moei-seafarers-pre-application-readiness-20261015` for draft review against `main`. Its parent is the existing PR #134 head, so a comparison with `main` also includes the preceding NMC/Smart Inspection branch history until those changes are integrated. The seafarer-specific diff starts at `119b7dd3d3e27abf0e8d54f8268f6dcc01d2b190` and removes no files.

Pushing this feature branch runs build, Docker and browser checks. GitHub Pages deploys only from `main` or an explicit workflow dispatch. A draft PR does not merge changes or update a running local Docker stack. Use ordinary reviewed merges for subsequent PRs and resolve shared navigation, route, SSO and server changes together so each module stays available.
