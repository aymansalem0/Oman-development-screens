# MOEI NMC POC — local Docker environment

This is a **local-only** Docker baseline for the existing Angular 18 NMC POC. The current 420 synthetic vessels, Risk Engine, six vessel/workflow screens and admin screen remain unchanged. The Airia proxy is present but **no NMC screen calls it yet**. AI wiring is the next step.

## Prerequisites

- Windows Docker Desktop with Linux containers enabled, Docker Compose V2.
- Git.
- Airia MENA key (only needed to exercise live agents; provided separately).

## Start the unchanged POC (PowerShell)

```powershell
git clone https://github.com/aymansalem0/Oman-development-screens.git
cd Oman-development-screens
git fetch origin
git switch feature/nmc-docker-ai-integration
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Open **http://localhost:4200/#/moei/nmc** (Angular uses hash-based routing).

The old GitHub Pages application on `main` is not changed by this feature branch.

## Health check

```powershell
Invoke-RestMethod http://localhost:4200/api/ai/health
```

An empty key produces `aiConfigured: false`; Angular screens still work in their current synthetic mode.

## Run Angular with hot reload

In the same checkout:

```powershell
docker compose --profile dev up -d --build ai-proxy nmc-dev
```

Open **http://localhost:4201/#/moei/nmc**. Changes to `src/` are picked up using polling. The development server routes `/api/ai` to the local proxy with `proxy.conf.json`. The normal production-like container remains available at port 4200 if it was already started.

## Enable live Airia calls for testing

Edit local `.env` and set `AIRIA_MENA_KEY` to the separately supplied **test key**. Never commit this file; `.gitignore` excludes it. Recreate the proxy to apply updated environment variables:

```powershell
docker compose up -d --force-recreate ai-proxy
Invoke-RestMethod http://localhost:4200/api/ai/health
```

Expected: `aiConfigured: true`.

The allowlisted proxy API is `POST /api/ai/execute/a01` (or `a02`, `a03`, `a04`). Send the **v3.1 contract body as JSON**, or wrap it in `{ "payload": { ... } }`. The server serializes it to Airia's `userInput` string and adds `asyncOutput:false`.

A01 smoke test (when test key is available):

```powershell
$payload = @{
  requestMeta = @{ correlationId = 'CORR-LOCAL-001'; language = 'en' }
  subject = @{ type = 'VESSEL'; imo = '9328471' }
  contextMode = 'INLINE'
  requestedSignals = @('movement', 'history')
  inlineContext = @{
    vessel = @{ name = 'MV Gulf Horizon'; flag = 'Liberia' }
    tracking = @{ speed = 3.1; destination = 'Jebel Ali' }
    dataConfidence = 0.76
  }
} | ConvertTo-Json -Depth 12
Invoke-RestMethod -Method Post -Uri 'http://localhost:4200/api/ai/execute/a01' -ContentType 'application/json' -Body $payload
```

The proxy returns an envelope `{agent,result}` containing Airia's raw execution response. Parsing/validating each agent's v3.1 output contract will be implemented in the Angular integration phase.

## Stop containers

```powershell
docker compose --profile dev down
```

## Design boundaries

- **Angular business logic stays unchanged** during Docker baseline setup, including its current deterministic/mock risk factors and browser-persisted state.
- **Only the AI proxy stores the Airia API key**, and it has no published host port. Nginx exposes a same-origin `/api/ai` route only on `127.0.0.1`.
- No credentials are checked in or sent via Angular. Requests are allowed only to configured A01-A04 pipeline IDs.
- A03 document upload, A04 image evidence, Google Drive read-only connector, approvals persistence, and actual AI use in NMC components **are not implemented in this baseline**.
- The existing NMC route is `/#/moei/nmc`, not `/moei/nmc` without the hash.
- This development-oriented local endpoint has no user authentication. Do not publish it on the Internet or use production credentials. Proper identity and authorization are required before multi-user deployment.
