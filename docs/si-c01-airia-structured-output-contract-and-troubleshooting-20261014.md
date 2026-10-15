# SI-C01 Airia Selection & Priority — Required Output Contract / Recovery

## Why the previous run returned HTTP 502

Airia HTTP 200 by itself does **not** guarantee that SI-C01 returned a machine-verifiable selection. The adapter accepts a `result` object (or JSON-encoded object) with a `recommendations` array. Each recommendation must use the **exact candidateKey from the input**, and cite only the candidate's `allowedEvidence`. Free-form conversational SI output is NOT equivalent to this contract.

**IMPORTANT partner qualification:** `MOEI_NMC_Partner_Airia_API_Guide(20261013-164834).pdf`, §2.1, documents structured JSON for A01/A02/A04, while distinguishing conversational SI outputs as prose. That PDF does **not** establish that the separately configured `AIRIA_SI_C01_PIPELINE_ID` is a structured-output pipeline. Inspect and configure the actual C01 pipeline in Airia before another billable run. Do not re-point C01 to a conversational SI pipeline.

## Airia Pipeline configuration

The C01 AI step MUST return one JSON object only, without markdown, commentary or extra characters:

```json
{
  "recommendations": [
    {
      "candidateKey": "exact-current-input-candidateKey",
      "recommendation": "SELECT_RECOMMENDED",
      "confidence": 0.84,
      "suggestedRank": 1,
      "reason": "Source-verified referral or service event warrants inspection review.",
      "priorityRationale": "Verified future ETD and reviewed active incident severity drive official ordering; missing evidence explicitly stated.",
      "evidenceRefs": ["exact-ref-from-this-candidate-allowedEvidence"],
      "dataGaps": []
    }
  ]
}
```

Rules for the Airia pipeline:
- Return one recommendation for **each** input candidateKey; no invented IMO/keys, evidence, ETD or incident severity.
- `recommendation` exactly `SELECT_RECOMMENDED`, `DEFER_RECOMMENDED` or `MANUAL_REVIEW`.
- `suggestedRank` integer 1..100 for SELECT_RECOMMENDED, otherwise `null`.
- `confidence` number in [0,1], not string, percentage or prose.
- `evidenceRefs` must be drawn exactly from that candidate's `allowedEvidence`, maximum 20.
- `reason` nonempty at least 10 characters. `priorityRationale` is optional prose; official rank comes from deterministic business rules.
- Only supported C01 criteria: verified **future** ETD ascending, then human-reviewed **active** incident severity descending, and `PENDING_ADDITIONAL_RULES` otherwise. NMC vessel-risk score does not control execution order.
- PSC monthly quota and inclusion eligibility are precomputed in Backend. AI cannot override PSC quota or create an official inspection case, booking or NMC approval.
- Output must be a single JSON object in the documented Airia `result` envelope; **not a conversational answer**.

## Backend behavior after this fix

- Real Airia runs use **25 candidate-workflows per call** to limit response truncation; MOCK remains 100. The Preview exposes the exact number of anticipated calls, and the operator explicitly confirms that number. Never silently retry a paid failure.
- The connector validates each AI suggestion against its own saved evidence. Any invalid or missing item is quarantined as `MANUAL_REVIEW`, with zero AI confidence and **zero claimed AI evidence**, without preventing other verified results from being reviewed.
- If **no** recommendation is verifiable, the run returns an actionable `SI_C01_NO_VERIFIED_RECOMMENDATIONS` or `SI_C01_STRUCTURED_JSON_REQUIRED` error and does not change the plan.
- Human statutory approval remains separate. Mandatory source-eligible NMC and service workflows retain their statutory business eligibility, independent of model suggestions.


## ALL_ITEMS_FAILED_VERIFICATION: exact safe diagnostic added

When Airia returns a parseable `recommendations` list but none passes verification,
the C01 API now sends an **enum-only** `failureCounts` summary, a dominant
`reasonCode`, `expectedCount`, `returnedCount`, and `batchIndex` /
`batchCount`. It logs the same safe aggregate without any IMO,
candidateKey, original evidence IDs, tokens or model prose.

| Returned reason code | What to correct inside the actual C01 Airia step |
|---|---|
| `CANDIDATE_KEY_NOT_IN_REQUEST` or `CANDIDATE_KEY_MISSING` | Echo the exact `candidateKey` for each current supplied workflow; IMO alone is not enough when one ship has multiple regimes |
| `EVIDENCE_REF_NOT_IN_SOURCE` | Emit only exact IDs from *that candidate's* `allowedEvidence`; never fabricate citations or cite another candidate |
| `EVIDENCE_REFS_MISSING_OR_TOO_MANY` | Emit an array of 0–20 evidence IDs, with actual source references for selection |
| `UNSUPPORTED_SELECTION_EVIDENCE` | Do not recommend selection if no verified evidence; choose `MANUAL_REVIEW` |
| `RECOMMENDATION_ENUM_INVALID` | Use only the three documented enum strings |
| `CONFIDENCE_INVALID_NUMBER_OR_RANGE_0_TO_1` | Emit numeric confidence 0..1, not arbitrary text |
| `SELECTED_SUGGESTED_RANK_INVALID` | For selection return integer 1..100, otherwise `null` |
| `REASON_MISSING_OR_INVALID_LENGTH` | Provide source-grounded explanation of at least ten characters |
| `CANDIDATES_WITHOUT_OUTPUT` | Return an entry for every supplied candidate; it does not mean those missing candidates have been AI-recommended |
| `PROVIDER_ITEM_VERIFICATION_FAILED` | Inspect the item-level strict validator and provider contract for the recorded batch |

Simple unambiguous transport differences are normalized *only after exact source
identity is established*: decimal numeric string for confidence, integer-string
rank, spaces surrounding **exact known** IDs, and omitted optional `dataGaps`.
The final strict validator still rejects unsupported vessel identities, nonexistent
citations and invalid statutory recommendations. Repaired fields are labelled
`outputNormalizedFields` for inspection.

**Important:** If the partner's C01 pipeline is conversational/prose instead
of structured output, this change cannot convert it into a verified JSON agent.
Configure structured JSON on the actual C01 pipeline first. Do not test by
sending repeated paid calls with unchanged pipeline configuration.

## Safe local checks / no secrets

```powershell
cd C:\Users\Admin\Oman-development-screens
$dc = @("-f","compose.yaml","-f","compose.oracle.yaml",
        "-f","compose.google-psc.yaml","-f","compose.incident-google.yaml")
docker compose @dc ps
docker compose @dc exec ai-proxy printenv SI_AI_PROVIDER
docker compose @dc exec ai-proxy printenv SI_C01_ENABLED
docker compose @dc logs --tail=300 --no-color ai-proxy |
  Select-String -Pattern 'SI_C01_|\[si-c01\]' -Context 1,1
```

Do **not** print `AIRIA_API_KEY`, OAuth tokens, Airia raw responses, or personal uploaded source documents in diagnostic logs. Confirm `AIRIA_SI_C01_PIPELINE_ID` privately in the runtime AI Settings screen; do not share the key value itself.

## Acceptance checks

1. Import saved Excel PSC event(s), apply published quota in Candidate Center; NMC and Service Requests remain separately eligible.
2. Preview C01: verify total candidates and number of **potentially billable** Airia calls.
3. Execute with deliberate confirmation. Result shows counts of verified AI recommendations and unverified manual-review items; no fabricated evidence.
4. Verify official plan priority is ETD/incident rules, not model risk scores, and supervisor approval is still required.
5. Negative test: free-form SI agent response -> exact structured-output error; forged evidence -> quarantine; full non-verification -> plan unchanged.
6. Inspect GitHub CI; execute one controlled real C01 Airia run **only after** validating the actual Airia pipeline response schema with the partner.

**Migration:** none. No existing Oracle table, rule, approval, dossier or event is modified by this fix. Existing DB migrations required by the broader Smart Inspection application remain unchanged.
