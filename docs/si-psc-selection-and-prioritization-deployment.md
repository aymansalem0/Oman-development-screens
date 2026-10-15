# Smart Inspection POC 2 — Stage 1 PSC Selection vs Stage 2 Execution Prioritization

## What changed (PR #59)

**Business decision:** Importing a Port Call does NOT mean the vessel will be
inspected. The previous design incorrectly put every PSC Excel Port Call into
Candidate Center with PENDING_REVIEW. We now separate **inspection targeting
and selection** from **priority of approved inspections**.

```text
PSC Excel upload --> PSC PORT CALL TARGETING POOL
                      + validated source events / ETA / evidence
                      + national OR port-scoped MONTHLY TARGET %
                      + rule-only ranking and traceable missing data
                      + PUBLISHER selection / not selected (NO AIRIA)
                                |
                         SELECTED PSC EVENT
                                |
                        Candidate Center
                     + NMC approved referrals (direct/live, outside PSC quota)
                     + Maritime Service Requests (outside PSC quota)
                     + PSC selected events (quota-controlled)
                                |
                       Officer/Supervisor APPROVE
                                |
                        SI INSPECTION CASE
                                |
                       SI-P01 (Stage 2)
                  Approved cases ONLY: rule preview
                  then explicit authorized AIRIA ranking
                                |
                          A04 + SCHEDULING
```

### Separate source treatment

- **NMC**: direct human-approved referral; no Excel, no PSC quota.
- **Service Requests**: retain their independent workflow. A service requirement
  is not the same as a PSC port call, and is not counted in PSC selection quota.
- **PSC Excel**: import saves *unverified POC source events* to the targeting pool
  ONLY. A **Publisher** selects individual **port-call EVENTs** before those
  events enter Candidate Center. This never automatically creates an SI Case.
- **SI-P01**: only candidates with a Publisher-created **SI_INSPECTION_CASE**
  and `status=INSPECTION_CREATED` may be sent to the paid execution-priority
  pipeline. Neither unselected Port Calls nor unapproved pending candidates
  are sent to SI-P01.

### New pages in shared MOEI platform UI

| Route | Menu | Purpose |
|---|---|---|
| `/#/moei/smart-inspection/psc-targeting` | Smart Inspection → PSC Targeting & Selection | Inspect source port calls, see quotas, review and **Select / Do Not Select** a specific event |
| `/#/moei/smart-inspection/settings/psc-quotas` | Settings → Inspection Settings → PSC Selection Quotas | Set national / per-port monthly rate, port exceptions, Preview and supervisor Publish |
| `/#/moei/smart-inspection/candidates` | Existing Candidate Center | Unique IMO display; **only selected PSC** alongside NMC and Service workflows; separate officer approval |
| `/#/moei/smart-inspection/settings/targeting` | Existing SI-P01 priority settings | Stage-2 *execution* weights and trigger factors, NOT PSC selection percentage |

All screens reuse NMC/MOEI white header/footer, bilingual Arabic/English toggle,
RTL/LTR direction, existing nav and design spacing.

### Monthly selection policy (POC example only)

Initial `SI_PSC_SELECTION_POLICY` settings:
```json
{
  "period": "MONTHLY",
  "scope": "NATIONAL",
  "ratePercent": 15,
  "portOverrides": [],
  "mandatoryOutsideQuota": true
}
```

**15% is illustrative and NOT an official UAE MOEI or PSC regulatory target.**
Selection rate applies to recorded, *valid-for-POC* PSC port-call EVENTS
(known active-fleet IMO, arrival ETA, port), not unique IMO count.

`targetCount = floor(eligiblePortCallEventsInPeriodAndScope × rate/100)`.

A selected event consumes exactly one quota slot. The same IMO can have multiple
different Port Calls across months/ports. The Candidate Center still displays
one vessel row per IMO with multiple sources/workflows underneath.
The **monthly period uses Asia/Dubai source ETA**, not the imported file's
upload date.

National scope shares one monthly quota across all ports; per-port scope
splits it by exact normalized port name, with configurable percentage
overrides. E.g., 20 events nationwide × 15% = **3 possible selections**.
For a small port with 4 calls × 15%, the conservative floor is **0**:
increase quota only through an explicitly versioned, approved business policy,
not silent auto-rounding.

Eligibility in this POC means **valid source + known fleet + valid Port/ETA**.
The full statutory PSC eligibility/exemption and country-specific mandatory
inspection definitions are **NOT yet implemented**. Hard legal exclusions,
repeat-inspection windows, resource limits and cross-port targets require
approved MOEI rules before production use. NMC and Service independent
workflows are *outside* the illustrative PSC quota; this is not a claim that
NMC cases are legally mandatory.

Rule-based preview orders events by **existing saved NMC risk** (if any), then
arrival ETA and stable eventKey. Missing official risk stays **MISSING**, never
0 or fabricated. No Airia calls in Excel import, PSC pool, quota preview,
quota publish or PSC selection. An optional future **SI-T01** selection agent
is NOT claimed as implemented in this PR.

**Publication:** Editor Preview is read-only; Publisher Publish requires a
version check, accountable actor and business justification. Event selection
requires Publisher key, event ID, policy version and human reason (8+ chars).
All decisions append to audit history. Exhausted quota rejects extra
selections `SI_SELECTION_QUOTA_EXHAUSTED`; unselecting an event already tied
to a created PSC inspection case is blocked. If lowering quota creates
over-target historic results, previously approved cases are NOT deleted;
the dashboard displays over-target warning.

### API

- `GET /api/si/v1/psc-selection/pool?period=YYYY-MM&port=...`
  → Editor access, live counted scoped pool + version + audit.
- `GET /api/si/v1/psc-selection/policy` → Editor access.
- `POST /api/si/v1/psc-selection/policy/preview` → Editor, `{config}`;
  no writes/AI.
- `POST /api/si/v1/psc-selection/policy/publish` → Publisher,
  `{config,expectedVersion,publishedBy,reason}`.
- `POST /api/si/v1/psc-selection/decision` → Publisher,
  `{eventKey,action:"SELECT"|"NOT_SELECT",actor,reason,expectedPolicyVersion}`.
- Existing `GET /api/si/v1/candidates/dashboard` now includes PSC only if
  that event is selected. Previously **handled** PSC cases from older POCs
  are preserved; unselected **newer** port calls from those IMOs cannot
  piggyback a legacy case.
- Existing `POST /api/si/v1/prioritization/preview|run` now considers
  **INSPECTION_CREATED cases only**. It never receives raw pool events
  or pending human-review candidates.

### Oracle Migration 012 — ADDITIVE (required)

This branch builds on #58 → #57 → #56 → ...; this is NOT merged or installed.
The previously required migrations **009** (candidate events), **010** (A04)
and **011** (SI-P01 audit) may already be installed; verify individually.

**New migration:** `ai-proxy/migrations/012_si_psc_selection_quota.sql` adds:
- `SI_PSC_SELECTION_POLICY` — immutable versioned monthly quota policies.
- `SI_PSC_SELECTION_DECISION` — append-only SELECT / NOT_SELECT audit.
- Index on event/time; no modifications to NMC risk, historical candidate
  events, cases, AI results or ERA ERP workforce.

**Backup and preflight are mandatory. Oracle DDL auto-commits.**
Use an actual verified restore-capable database backup and DBA approval.

PowerShell:
```powershell
cd C:\Users\Admin\Oman-development-screens
git status --short
# Preserve local uncommitted changes before branch switch.
git fetch origin pull/59/head:pr-59-psc-selection
git switch pr-59-psc-selection
git branch --show-current
docker cp .\ai-proxy\migrations\012_si_psc_selection_quota.sql oracle-free-23:/tmp/si-psc-012.sql
docker exec -it oracle-free-23 bash
```

In container: `sqlplus -L /nolog`, then in SQL*Plus:
```sql
CONNECT NMC_AI@"localhost:1521/freepdb1"
SELECT USER, SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL;
-- Expected: NMC_AI / FREEPDB1
SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
  ('SI_CANDIDATE_EVENT','SI_CANDIDATE_DECISION','SI_INSPECTION_CASE',
   'SI_AI_PRIORITY_RUN','SI_PSC_SELECTION_POLICY','SI_PSC_SELECTION_DECISION')
 ORDER BY TABLE_NAME;
-- Confirm 009/011 objects exist; 012 tables MUST NOT EXIST.
SELECT COUNT(*) AS SOURCE_EVENTS_BEFORE FROM SI_CANDIDATE_EVENT;
SELECT COUNT(*) AS CASES_BEFORE FROM SI_INSPECTION_CASE;
SELECT COUNT(*) AS NMC_ASSESSMENTS_BEFORE FROM NMC_AI_ASSESSMENT;
-- Only after verified restore-capable backup + prerequisites:
@/tmp/si-psc-012.sql
SELECT COUNT(*) AS SELECTION_DECISIONS_AFTER FROM SI_PSC_SELECTION_DECISION;
SELECT COUNT(*) AS SOURCE_EVENTS_AFTER FROM SI_CANDIDATE_EVENT;
SELECT COUNT(*) AS CASES_AFTER FROM SI_INSPECTION_CASE;
SELECT COUNT(*) AS NMC_ASSESSMENTS_AFTER FROM NMC_AI_ASSESSMENT;
EXIT
```

**No backfill:** existing imported PSC port calls enter the targeting pool;
the *unapproved* ones no longer appear in Candidate Center until human
selection. Already handled historic PSC inspection workflows remain
readable. **Do not re-upload or delete Excel data.**

### Docker: rebuild API + Angular, preserve volumes

```powershell
docker compose -f compose.yaml -f compose.oracle.yaml config --quiet
docker compose -f compose.yaml -f compose.oracle.yaml up -d --build --no-deps ai-proxy nmc
docker compose -f compose.yaml -f compose.oracle.yaml ps
docker compose -f compose.yaml -f compose.oracle.yaml logs --tail=90 ai-proxy
Invoke-RestMethod http://localhost:4200/api/ai/health
```

If the existing POC uses Google PSC Compose override, insert
`-f compose.google-psc.yaml` **between** base and Oracle files consistently.
Never `docker compose down --volumes`. Keep P01 Airia disabled until an
actual verified pipeline is configured and explicitly approved.

### Acceptance sequence on existing PSC Excel imports

1. Before migration/deployment, record baseline NMC risk, SI cases and
   source-event counts. Do not erase existing imports.
2. Open **PSC Selection Quotas**; Editor key, load policy. Example 15%
   national; Preview displays monthly eligible/target/selected. If testing
   Publish, use an authorized Supervisor and reason.
3. Open **PSC Targeting & Selection**; Editor key, Load Port Calls. All valid
   imported PSC events appear in the **targeting pool**, not Candidate Center.
4. With 24 PSC events in the SAME month, national 15% results in
   `floor(24×0.15)=3` available selections. Officer reviews events and
   Publisher explicitly selects up to three. Fourth fails with quota error.
5. Candidate Center: **only those three selected PSC source events**
   become reviewable PSC workflows. NMC approved referrals and Service
   Requests remain independently visible. Same IMO → one vessel row with
   distinct selected sources.
6. One event NOT_SELECT stays visible in pool history but does not create
   candidate or SI case. Changing a quota version never creates cases.
7. In Candidate Center, Publisher Approve → **SI_INSPECTION_CASE created**.
   SI-P01 rule preview/ranking sees that **approved case only**, NOT other
   pending Service/PSC or unselected Port Calls.
8. Read missing risk as MISSING (never 0). No automatic Airia calls on
   loading, editing, importing or selection. Test English/Arabic RTL.
9. Restart proxy: quotas, import provenance and audited decisions survive
   on the Oracle tables.
10. Confirm the existing NMC 10 saved assessments (or your *actual*
    baseline number) remain unchanged.

### Rollback

Code can be reverted to a previously verified Git ref and `ai-proxy nmc`
rebuilt. **Do NOT DROP** the new tables or delete source events. A controlled
data recovery/restore plan requires separate DBA approval; even after a code
rollback, source events and decision audit remain. CI cannot prove your local
Oracle migration, live browser QA or legal PSC compliance.

### Planned subsequent work (not in this PR)

**SI-T01 AI Selection Agent** with Ministry-approved PSC mandatory conditions,
inspector capacity, repeated inspections and legal eligibility, plus
full audit/override logic. This PR implements deterministic quota-based
selection, the necessary human controls, and correct scope for SI-P01.
