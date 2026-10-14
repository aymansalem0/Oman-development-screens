# MOEI Seafarer Management & SDB — Detailed Angular POC Screens

**Integration:** `feature/moei-seafarers-sdb-integrated-nmc-20261014`, based on NMC/Smart Inspection baseline `ffa12e3`. This is NOT an amendment to the retired Oman-only shell.

## Navigation and technical scope

- Existing MOEI sidebar: **Seafarer Management & SDB** (alongside NMC and Smart Inspection).
- Module landing: `/moei/seafarers`.
- Seafarer case and 11-screen workspace: `/moei/seafarers/sdb/SF-002` (replace fixture ID with SF-001 to SF-008).
- Same `app-nmc-platform-header`, `app-nmc-navigation`, unified white/teal design, responsive sidebar and `moeiAdminGuard` as existing NMC and SI.
- Only the **nmc frontend** needs rebuilding for this slice. No Oracle migrations, AI Proxy changes or secret configuration changes.

## Eleven detailed screens

| # | Screen | Core scenario |
|---|---|---|
| 01 | Journey Overview | Milestone control center, readiness KPIs, owner/next-action |
| 02 | Seafarer 360 | Unified SID, identity, employer/academy, rank, CoP/CoC/endorsement, SDB versions |
| 03 | Source Verification | Eight evidence gates, source, rule code, PASS/FAIL/PENDING/N/A, fixture AI narrative |
| 04 | HOLD & Exceptions | Exceptions and isolated **mock inbound** Academy / MARASI / Company / Endorsement events |
| 05 | Ready-to-Apply | Actor-correct invitation, no submission implied, mock email only |
| 06 | SDB Application | UAE self-service / foreign company persona, review & declaration, choice of collection/courier |
| 07 | Rule Authorization | Fresh verified source checks, fail-closed, versioned rule evidence snapshot, no officer sign-off |
| 08 | Payment | Mock gateway callback **only after authorization**, no actual fee or funds |
| 09 | SDB Issuance | Mock first issue generates synthetic SID; renewal retains existing SID |
| 10 | Print & Delivery | Controlled print queue, print confirmation, courier dispatch or collection, handover |
| 11 | Audit & Monitoring | Per-case source/event history, decision provenance, readiness for future renewal monitoring |

Each screen renders on the same route via an internal workflow stepper; navigation **does not bypass business guards**. Actions are independently enabled only when deterministic rules allow them. A separate synthetic persona selector demonstrates channel-specific submission.

## Demo walkthroughs and controls

1. **SF-002 UAE cadet with Academy HOLD:** OPERATIONS -> 04 receive CoP (Academy), receive HOLD release -> 03 check all gates -> 05 invite -> switch SELF -> 06 enter mock contact email and accept all declarations -> submit -> switch OPERATIONS -> 07 authorise -> 08 mock callback -> 09 mock issue -> 10 mock print and collect -> 11 audit.
2. **SF-003 foreign Master, renewal:** OPERATIONS -> 05 invite -> COMPANY -> 06 submit -> OPERATIONS -> 07, 08, 09, 10. Verify unchanged `SID-DEMO-2003`.
3. **SF-004 expired foreign endorsement:** 05 invitation disabled; 04 receive endorsement from simulated source, then continue; submit only as COMPANY.
4. **SF-005 company-owned HOLD:** company clear event must arrive at simulated source, not by an MOEI override; Company submits when all gates pass.
5. **SF-007 unavailable source:** 05 invitation disabled; 04 restore mock connector; only then invitation allowed.
6. **SF-006 expired medical:** receive MARASI mock medical update before invitation.
7. **SF-001 first issuance:** first issued SID is a `SID-DEMO-` fixture only, never a real SID.

## Cross-state invariants

- Readiness, application and print/delivery are **separate state dimensions**. No invitation without `READY_TO_APPLY`.
- `PENDING` source is not an automatic `NO_OBJECTION`.
- Only the source is authoritative for HOLD; UI mock button represents incoming source data and is NOT a ministry override.
- Foreign seafarer requires valid Endorsement AND associated company-representative route.
- UAE seafarer applies through self-service.
- Applicant must review source evidence and sign mock declarations, with a contact email; courier requires an address.
- Final rule authorisation re-evaluates source evidence; policy version captured `POC-SDB-RULESET-v1.0`.
- Payment cannot proceed without both submission and rule authorisation.
- Issue requires mock payment and rechecked readiness; renewal preserves existing SID.
- Print and physical handover cannot be marked complete before issuance.
- All events record timestamp, actor, and stage in **ephemeral local memory**; resetting the demo intentionally clears that state.

## Out of scope / future delivery

**All fixtures are synthetic.** No live ICP, MARASI, academy, company, official endorsement, Airia, UAE PASS identity assurance for applicant personas, physical booklet, email, payment, courier, government SID, official SDB or regulatory decision. The existing login guard protects the POC application, not company-specific production RBAC.

For production, implement Spring Boot persistence and source-owned signed event contracts, transactional issuance, company/academy role authorization, official rule approval and version control, idempotent payment/printing orchestration, protected audit retention, SLA reporting, and Airia advisory agent calls with cited source truth. Formal MOEI regulatory authority must approve any zero-touch issuance.

## Running without impacting Oracle / AI Proxy

When using a separate source Worktree, `.env` must be read from the original Windows repository location with `--env-file`. Local Google service account mount paths and bind mounts are **relative to Compose project directory**, not the env-file directory; confirm that each required secret path exists in the worktree before starting the multi-overlay Compose stack. Do not force-reset or clean the user's original working directory. For an existing stack, rebuilding `nmc` may interrupt web access briefly, but it must never drop volumes or recreate Oracle.
