# MOEI Seafarer Management / SDB POC — Foundation

## Running the Angular demonstration

From the existing Angular 18 repository:

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:4200/moei/seafarers` (or the GitHub Pages site under `/moei/seafarers`).

This draft is **POC Slice 1**, not a production maritime registry and not the full SDB implementation.

## Implemented in Slice 1

- A distinct MOEI Seafarer Management view, separate from the legacy Oman layout.
- Synthetic seafarer master records, list, filtering and a Seafarer 360 profile.
- UAE self-service vs foreign-company applicant pathway.
- Mandatory valid endorsement for foreign seafarers, with company association precondition.
- Deterministic readiness checks for identity, medical, CoP, CoC where required, endorsement, clearance and source availability.
- Source-owned HOLD reason and **simulation** of a source-originated clearance update.
- Mock advisory AI explanation (plain fixture text; it is **not** a live Airia model call).
- Ready-to-apply invitation **simulation** (no email delivered).
- Persona-dependent applicant submission, fake payment and deterministic, no-officer **simulated issuance**.
- An in-memory audit event list and demo reset.

## Demonstration steps

1. Use MOEI Operations persona. Open **Seafarer Registry** → `SF-002`: training shortfall and academy HOLD. Read the AI fixture narrative. Click **Mock Academy CoP update**, then **Mock source lifts HOLD**. The profile becomes ready.
2. On `SF-002`, click **Queue Invite (Mock)**. Switch to **UAE Seafarer** persona and click **Submit as Applicant (Mock)**. Switch to **MOEI Operations** to simulate payment and rule-engine issuance. No officer approval is modelled.
3. Select `SF-004` (foreign, company route). See expired/missing endorsement block. Use operations to simulate an **Endorsement update**, queue invite, then switch to **Company Representative** persona to submit.
4. Select `SF-005` and observe the company-owned HOLD until a mock source update.
5. Select `SF-007` and observe fail-closed source unavailability. No automatic No Objection from silence.
6. Open **Audit & Evidence** for traceable simulation events.

## Scope and safeguards

- **Synthetic data only.** No real seafarer identity, passport, certificates or personal data.
- **Mock source update buttons are simulator controls only.** An actual company or academy must own its source decision and HOLD release.
- **Mock AI** is clearly labelled. No live LLM is invoked and an AI cannot change legal eligibility.
- **No production endpoints**, payment gateway, official SID/SDB, email sending, Keycloak RBAC or Oracle/Azure SQL mutations.
- Data is in memory and resets on refresh; local mock personas are not authentication.
- No routine human approval in the normal POC path **is a proposed policy**, pending formal MOEI authorization of automated issuance.

## Next integration slices

**Slice 2 — Spring Boot adapter + persistence:** canonical Seafarer, Qualification, Endorsement, Clearance, ReadinessEvaluation, SDBApplication, AuditEvent; OpenAPI endpoint contracts and mock academy/company/MARASI/ICP/registry adapters. On synthetic DB only.

**Slice 3 — real role & source governance:** Keycloak / UAE PASS, signed source events, idempotency, expiry, replay/out-of-order defense, per-company authorisation and audit.

**Slice 4 — Airia AI:** add a separately governed analysis endpoint to the actual SDB Journey/conversational pipeline where supported; validate an explicit structured agent contract before enabling AI explanations. Explanations must cite source references and never compute legal eligibility.

**Slice 5 — fulfilment & UAT:** payment gateway sandbox, printing status, lifecycle reports, notifications sandbox, bilingual UX, regression and exception scenarios.

## Primary business references

- `Seaman's Discharge Book (SDB) Operations.pdf` — 11-page As-Is overview provided by the business team.
- `MOEI_SDB_01_ToBe_Business_Process_EN.docx`
- `MOEI_SDB_02_Functional_Technical_Design_EN.docx`
- `MOEI_SDB_03_UI_UX_Design_EN.docx`

POC rule constants and source names are illustrative until MOEI confirms legal scope, categories, integrations and delegation of automated issuance.


## Integrated NMC baseline

This revised implementation is based on `fix/si-airia-contracts-v2-plan-approval-20261014` (baseline `ffa12e3`), not the old `main`-based SDB branch. It uses the existing MOEI Google SSO route guard, shared maritime header and navigation. Production RBAC and company-level authorisation are NOT implemented by the in-memory demo personas.

Run with the FOUR existing compose overlays; re-build **only** the frontend service once local changes and source state are reconciled. Never reset Docker volumes or change Oracle databases for this UI-only POC.
