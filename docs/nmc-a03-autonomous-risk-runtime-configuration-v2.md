# MOEI NMC — A03 risk orchestration, data quality & runtime settings V2

## Business flow

```text
Scheduled fleet assessment, enabled explicitly by Publisher
      │
      ├─ Structured vessel evidence & synthetic PSC Sheets
      └─ Scoped Google Drive vessel folder metadata (IMO)
                │
                ├─ Unchanged document -> reuse validated A03 result
                └─ New/modified document -> A03 extraction of ONE PDF pack per vessel per tick
                               │
                    Citation-grounded A03 response
                         (DRAFT_REVIEW / PROVISIONAL)
                               │
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                 ▼
         A01 context       A02 context     Deterministic data checks
        (situational)      (compliance)       cross-source comparison
             │                 │                 │
             └─────────────────┴─────────────────┘
                               ▼
                  NMC rules & six-factor option
                    (publisher risk-policy vN)
                               │
                  Saved score and structural quality
                               │
                     NMC alerts reconciliation
                               │
                   Human review/case/inspection
```

A03 **never** sets the final maritime risk score. A01/A02 return their five validated signals; a deterministic document-consistency evaluator emits the optional sixth `documentIntegrity` signal. The published risk rules assign its weight. When that weight is positive and A03 evidence is unavailable, the score is **unavailable**—it is never silently assumed to be a 0-risk document.

**No double count:** expiry and statutory certificate status belong to A02's `certificate` compliance risk. A03 `documentIntegrity` measures grounded cross-source document inconsistencies. A02's `dataQuality` risk factor cannot simultaneously cite the same A03 document evidence IDs. Saved **Structural Data Quality** (a separate metric from the risk score) includes grounded A03 comparisons, not certificate issuer authentication.

## Document-quality algorithm

- No usable A03 comparison → retain baseline four structural metrics: 35% completeness, 30% identity-source consistency, 20% evidence linkage, 15% source metadata. An absent PDF is **unknown**, not automatically consistent.
- Available A03 comparison → reserve 15% of the structural quality model for document-vs-Vessel 360 field agreement (document numbers/expiry where both sources present). Scale the baseline four metrics to 85%: **29.75 / 25.5 / 17 / 12.75**.
- Preserve uncertainty cap `MIN(75, ROUND(weightedScore × 0.75))` for synthetic POC sources; this score is NOT confidence that an official certificate is authentic.
- Persist `documentComparisons`, mismatches and `GDOC-...` evidence IDs in the saved Oracle assessment's quality breakdown (migration 016 adds the sixth risk-factor CHECK and A03 evidence source).
- Vessel 360 displays **A03 document consistency** and field-level cross-source mismatch rows.

## Risk Configuration — optional factor

In `/moei/nmc/admin/risk-configuration`, add sixth factor **Document integrity (A03)**. It starts with weight **0** to preserve previous approvals and saved five-factor models. The Publisher may explicitly publish a new **100% total** model after validating A03 outputs, e.g. a pilot:

| Risk factor | Example weight |
|---|---:|
| movement | 23% |
| inspection | 25% |
| certificate | 18% |
| dataQuality | 13% |
| history | 11% |
| documentIntegrity | 10% |

This example is a proposed **POC policy**, not calibrated maritime regulation. Historic assessments remain unchanged. Saved assessments without A03 cannot be retrospectively projected under a published rule that REQUIRES A03. Reassess those vessels after document extraction; do not manufacture missing severities.

## Runtime Configuration UI

**Navigation:** Settings → NMC Settings → Runtime Configuration & AI Agents

**Route:** `/moei/nmc/admin/runtime-settings`

**Server API:** `GET /api/ai/admin/runtime-settings`; `PUT /api/ai/admin/runtime-settings`.

Only these non-secret effective settings are editable: `NMC_A01_ENABLED`, `NMC_A02_ENABLED`, `NMC_A03_ENABLED`, `NMC_A03_AUTO_ENABLED`, `SI_A04_ENABLED`, `SI_P01_ENABLED`, `NMC_ALERT_SCAN_ENABLED`, `NMC_ALERT_SCAN_SECONDS`, `NMC_ALERT_ESCALATE_MINUTES`, `NMC_FLEET_AUTO_ENABLED`, `NMC_FLEET_AUTO_MAX_VESSELS`, `NMC_FLEET_AUTO_RETRY_FAILED`, `NMC_FLEET_REFRESH_SECONDS`, and `AIRIA_BASE_URL`.

The API **does not change `process.env` or write Docker's `.env`**. It reads validated `.env` defaults on startup, overlays a versioned file in the persisted `/data` volume, and applies effective values live to the scheduler, alert timer/escalation window, agent gates and Airia endpoint. A Publisher key is required for PUT. Values, change reason, publisher and version persist (optimistic concurrency); all secret keys/passwords and arbitrary configuration names are excluded.

**Airia allowlist:** only exact HTTPS origins `https://api.mena.airia.ai` and `https://mena.api.airia.ai`; no HTTP, local IPs, arbitrary hosts, URL credentials, paths or query strings (SSRF protection). The existing `AIRIA_MENA_KEY` stays only in protected server ENV.

**Safety gates:** enabling any previously disabled paid agent, enabling fleet auto/retry, enabling automatic A03 or changing Airia endpoint requires explicit Publisher confirmation. The UI prompts for a publisher key without saving it in localStorage. Fleet auto requires A01+A02 enabled; A03-auto requires A03 enabled. `NMC_FLEET_AUTO_MAX_VESSELS` is 1–420; scan is 15–3600 seconds; refresh 60–604800 seconds; escalation 1–1440 minutes. No automatic agent calls occur on GET/page load. One instance only: production HA requires centralized transaction-backed runtime config, Keycloak roles and audit service.

### Example POC settings (explicitly publish after consent)

```env
NMC_A01_ENABLED=true
NMC_A02_ENABLED=true
NMC_A03_ENABLED=true
NMC_A03_AUTO_ENABLED=true
NMC_ALERT_SCAN_ENABLED=true
NMC_ALERT_SCAN_SECONDS=30
NMC_ALERT_ESCALATE_MINUTES=15
SI_A04_ENABLED=false
SI_P01_ENABLED=false
NMC_FLEET_AUTO_ENABLED=true
NMC_FLEET_AUTO_MAX_VESSELS=3
NMC_FLEET_AUTO_RETRY_FAILED=false
NMC_FLEET_REFRESH_SECONDS=3600
AIRIA_BASE_URL=https://mena.api.airia.ai
```

The example is **NOT enabled automatically by this branch**. A03 still requires an accessible Google Drive service account/folder and a real Airia A03 pipeline returning the validated document contract. Confirm remote endpoint/credentials/AI costs before publishing. With three vessels, the scheduler can call A01+A02 for each and A03 for an unseen/changed pack: initial potentially **up to 9 paid calls**, excluding retries; validate with one vessel first.

## Deployment / DB / CI

1. **No automatic deploy in this PR.** Work remains stacked on PR #64, #62 and #61.
2. Back up existing Oracle `NMC_AI` in `FREEPDB1`, verify recoverability. After schema migration 014/015 if not applied, manually apply **`ai-proxy/migrations/016_nmc_a03_document_integrity_factor.sql` once**. Oracle DDL auto-commits; inspect constraints and never rerun blindly. This changes only the risk-factor CHECK and synthetic A03 source record. Preserve Docker volumes.
3. Ensure `secrets/nmc-drive-google.json` is available to `compose.google-drive.yaml` with a read-only account shared on the synthetic `vessels` folder, and that `NMC_DRIVE_ROOT_FOLDER_ID` is configured; this is separate from ChatGPT's Drive connector.
4. Update deployment to branch `feature/nmc-a03-risk-runtime-settings-v2`, preserve existing Compose overrides (Oracle/PSC/Drive). Rebuild the `nmc` and `ai-proxy` services **without** `down --volumes`. Read log errors and `/api/ai/health`.
5. Access the Runtime Configuration route, verify current ENV defaults, publish a cautious A03-enabled one-vessel pilot under publisher key. Verify the browser GET produces **zero Airia calls**.
6. Run one synthetic PDF pack A03, compare extracted sections and evidence snippets. Audit DRAFT/APPROVE operations and verify the A01/A02 inputs include A03 evidence (no double counting).
7. On a new assessment, inspect Oracle risk-factor row `documentIntegrity` and saved quality `documentConsistency`/persisted disagreements. Publish a 10% A03 risk weight **only after** the A03 response contract is verified. Inspect old row unchanged and no fabricated projections.
8. Modify a Drive file and confirm its `fileId:modifiedTime` fingerprint causes a **new** scheduled assessment when due (default 3600 s); unchanged file does not trigger extra A03 charges. Check old/new alerts and case audit.
9. Check runtime settings version conflicts, publisher permission, URL allowlist, restart persistence and disabling/reenabling scheduler and alert timers.

## Remaining limitations

- Scanned PDF OCR, issuer verification, regulation-grade scoring and multi-instance configuration distribution are not included.
- Synthetic maritime pack is NOT a statutory authority source. A03 confidence is NOT certificate authenticity confidence.
- Source monitoring is **scheduled** (next due poll), not a Drive webhook with instantaneous triggers.
- Actual Airia A03 pipeline schema and production AI billing have **not** been proven live or invoked from GitHub CI.
