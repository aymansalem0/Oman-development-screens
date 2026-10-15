# MOEI — Central AI Settings & Governance (NMC + Smart Inspection)
**POC update: 14 October 2026** — replaces editing Checklist Airia settings in `.env` for ongoing operations.

## One administrator screen

`http://localhost:4200/#/moei/settings/ai-governance`

The previous `/#/moei/nmc/admin/runtime-settings` remains as a compatibility alias; both use one settings editor, one versioned audit journal and one backend source of effective configuration. Navigation **Settings → NMC Settings → AI Settings & Governance** opens the new route.

| Panel | Editable controls | Behavior |
|---|---|---|
| AI Agents & Orchestration | Enable/disable A01/A02/A03/A04/C01/P01, select Smart Inspection MOCK/AIRIA | Runtime backend update after **Publish**, requires reason, checked version and Admin session |
| Airia Pipeline Registry | A01/A02/A03/A04/C01/P01 UUIDs, A03 document transport | A01–A04 default IDs are from the supplied Airia Partner Guide of **8 Oct 2026**; C01/P01 require independently confirmed IDs |
| Smart Inspection Checklist AI | Enable Airia; Builder & Vision pipeline IDs; `multipart` (recommended) or tested inline image mode; max AI suggestion calls per case | Changes applied to running checklist provider without manual Docker recreation |
| AI Governance Controls | Permanent human approval, deterministic risk/checklist protection, cost confirmation and audit statements | Cannot be switched off by users |
| Connectivity | Allowlisted Airia MENA HTTPS URL; backend timeout | Prevent arbitrary outbound URLs |
| Runtime Scheduler | Existing fleet AI scheduling and retry/batch limits | Keep paid auto modes OFF unless an operator explicitly approves them |
| Airia API Key | Credential status and **write-only** replacement | Encrypted at rest via AES-256-GCM; no API key is returned to the client |
| Publish | Change reason, confirmation, version history | Saves changes to protected `/data/nmc-runtime-settings.json` and applies to backend |

Existing checklist TEMPLATE/GROUP/ITEM AI instructions and mandatory item definitions remain **business-authoring content** inside `Inspection Checklist Library`; provider connections, IDs, global toggles, call limits and model routing are centralized here. The AI model name and actual pipeline prompt are defined inside Airia, so the governance screen does **not** pretend it can change the model of an existing remote pipeline simply by changing a label.

## Existing live catalogue — what can be reused?

The partner PDF confirms:
- A01 Maritime Intelligence `86904bc8-e552-4172-aaa8-1a79cbb9539d`
- A02 Vessel Compliance `73708937-ba16-47e3-b404-55cc0a54b159`
- A03 Document Intelligence `603d32f6-2f5f-42a8-a592-77af571a2480`
- A04 Smart Inspection `bad751da-0e11-48fd-861d-5bde1afbbd8d`
- Conversational SI `e1b776b8-62a4-43e2-abdb-9c114b74d9a1`

**Caution:** The guide says Conversational SI returns **operator prose**, not guaranteed structured checklist JSON. The Checklist Builder output contract `suggestedGroups[] / suggestedItems[]` requires verification or adapter. A04 supports structured dossier/evidence output, but **not automatically** the checklist-specific `recommendations[{itemId,answers,rationale,confidence}]` contract. The Vision pipeline must be tested/adjusted. No arbitrary, made-up IDs are inserted by default; Builder/Vision remain empty and the checklist Airia switch is OFF.

For image evidence, partner documentation supports `POST /v1/PipelineExecution/Multipart/{pipelineId}` with `userInput` and uploaded `file`; the backend uses this route by default when an actual photo is supplied, instead of assuming inline-base64 pictures work. Text-only prompts use ordinary JSON execution. Paid calls remain opt-in and return only draft proposals; field inspectors accept/edit/reject each answer.

## One-time encrypted vault infrastructure (optional if no key rotation)

The existing `AIRIA_MENA_KEY` in the untracked private `.env` remains a bootstrap credential. If you want administrators to **rotate the Airia key in the UI**, the server must have one independent 256-bit master encryption key. Do not store or display the master key in browser/UI/Git or share it with ChatGPT. Provision it in a secret manager for production.

For a local Windows POC in PowerShell (run ONCE inside the project; protect and backup the untracked `.env`):
```powershell
$bytes = New-Object byte[] 32
$gen = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$gen.GetBytes($bytes)
$gen.Dispose()
$master = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
Add-Content -Path .env -Value ("MOEI_AI_VAULT_MASTER_KEY=" + $master)
Remove-Variable bytes, gen, master
```
Do NOT regenerate the master after rotating a key, or the encrypted record cannot be decrypted.

Once that bootstrap is configured, an ADMIN sees credential status and can rotate via password-style write-only field, reason and explicit confirmation. All NMC/SI paths read the effective key at request time; no Docker restart needed after UI rotation. Only the server exposes status (configured/rotatable/source), never plaintext.

## Local run (without touching Oracle)

```powershell
git status --short
git fetch origin
git switch --track origin/feature/moei-ai-settings-governance-centralized-20261014

$dc=@('-f','compose.yaml','-f','compose.google-psc.yaml','-f','compose.oracle.yaml','-f','compose.incident-google.yaml')
$env:NMC_INCIDENT_AUTO_TRIAGE_ENABLED='false'
docker compose @dc config --quiet
docker compose @dc build ai-proxy nmc
docker compose @dc up -d --no-deps --no-build --force-recreate ai-proxy nmc
```

Open `http://localhost:4200/#/moei/settings/ai-governance`. Read the saved A01–A04 IDs, check status, and leave **Checklist Airia** disabled until you verify a JSON Builder and a multimodal Vision contract in Airia. Enter approved real IDs, select multipart for image review, choose max AI calls per case, supply a reason, and publish. Existing Oracle databases, approved SI cases and /data volumes are preserved. Never use `down -v`.

### Verification
```powershell
# Login first in browser, then in its DevTools Console:
fetch('/api/ai/admin/runtime-settings',{credentials:'same-origin'})
  .then(r=>r.json()).then(x=>console.table(
    ['SI_CHECKLIST_AIRIA_ENABLED','AIRIA_SI_CHECKLIST_BUILDER_PIPELINE_ID',
     'AIRIA_SI_CHECKLIST_VISION_PIPELINE_ID','SI_CHECKLIST_VISION_TRANSPORT']
    .map(k=>({setting:k,value:x.values[k],source:x.sources[k]}))))
```
Only public non-secret settings are returned. API key status is in the same admin UI; API key never appears in network responses.

## Boundaries
- Single-process Docker POC uses saved JSON settings / encrypted vault in its protected `/data` volume. For production on UAE-sovereign Azure, migrate governance audit + nonsecret settings to approved Azure SQL and encrypted credentials to Azure Key Vault/Managed Identity; secure multi-replica cache invalidation.
- Backend forbids publishing unsafe URLs, invalid pipeline UUIDs, enabling checklist Airia without both IDs, or activating Smart Inspection live provider without C01/P01 mappings. Enabling new paid AI modes requires confirmation.
- Current C01/P01 event-driven or periodic **smart inspection** triggers remain a separate development task; these controls do not claim that orchestration has been implemented.
- 24/7 logging, data residency, legal review of uploaded evidence and source-grounded checklist obligations need ministry approval before operational use.
