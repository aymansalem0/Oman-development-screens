# Smart Inspection C01 — Source-trigger priority only (Business decision, 13 Oct 2026)

## Sole configurable priorities

| Candidate trigger | Published default score (out of 100) | Meaning |
|---|---:|---|
| Human-approved NMC referral | 100 | Protected first tier; NMC approvals are never inferred from AI. |
| Maritime Service Request | 100 | Every eligible pending imported request participates in the plan even when saved NMC risk is low or missing. |
| PSC Port Call | 20 | Lower-ranked source. PSC still requires separate port-call quota/selection before entering the Candidate Pool. |

The three numbers are independent **scores**, not mutually exclusive percentages. They do not sum to 100. No configurable risk threshold, five-factor weights, history/ETA/urgency composition or percentage normalization participates in C01 candidate selection or plan ranking.

## Executable scope

- **Source of truth**: published `SI_TARGETING_RULE_VERSION.CONFIG_JSON.sourceTriggerScores` (or JSON-mode equivalent). Old published legacy `prioritization.sourceTriggerScores` remains readable until an authorized new version is published. No automatic replacement of historical policy rows.
- **C01 input**: candidate source and evidence references, published source priority, and current official risk as *context only*. A missing official NMC risk stays null; it is **not** a rejection of an eligible Service Request.
- **MOCK C01**: purely deterministic demonstration. Approved NMC referrals first, then descending source score, then stable IMO/key. It does not call Airia.
- **Actual plan projection**: required NMC/Service candidates cannot be silently removed by an advisory model result. They are included as a proposal when C01 is run, unless a current-plan human choice or a still-active explicit previous deferral applies. **Supervisor approval** is still required to create an SI case.
- **PSC**: only selected port calls eligible under published PSC quota policy reach C01. A score of 20 is a priority, not a new acceptance threshold.
- **Source of decisions**: officers can explicitly Include, Remove/Not Select or Defer a service candidate with an audited reason. NMC mandatory referral rules still prevent **Not Applicable**. A new plan uses new candidate source keys and preserves permitted carry-forward decisions.
- **Multiple triggers**: the vessel displays once (IMO-level); the strongest source score wins and all underlying reasons/regimes stay linked.
- **Official NMC risk** remains owned by deterministic NMC risk assessment and must not be overwritten.

## Governance and migration

No destructive changes to Oracle, existing approved plans, historical cases or risk assessments. After rollout, an authorized supervisor must **Preview Fleet Impact** and **Publish Priority Version** to replace previously published scores with 100/100/20. Existing versions continue as archived audit history. Explicit C01 rerun on a draft is necessary for new recommendations; approved plans stay frozen.

**SI-P01 remains retired** as specified in PR #102. SI-S01 is the optional adviser for already-feasible inspection slots and is not part of this priority-scoring settings UI.

**Release status**: Draft stacked PR #103 (above PR #102). CI is not proof of live Airia tenant contract compatibility or deployment to the user's local Docker runtime.
