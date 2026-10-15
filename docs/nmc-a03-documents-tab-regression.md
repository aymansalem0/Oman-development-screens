# NMC regression: Documents tab and A03 vessel-risk factor reappeared

## Verified cause

The earlier Vessel 360 cleanup is in **draft PR #77**,
`feat/nmc-v360-clean-tabs-accidents-nav-20261012`, based on a different
feature branch. It was never merged into the subsequent A01 source fix PR #80
(`feat/nmc-incident-auto-case-management-20261011` baseline) or incident
filter PR #81. Those newer feature branches therefore retained the legacy
Vessel 360 Documents/A03 tab and six-factor risk admin. This is a stacked
branch integration/acceptance regression, not a request to restore the tab.

## Corrections integrated on top of PR #81

- Remove Vessel 360 Documents/A03 tab, component usage and direct ?tab=documents
  route selection; retain five ordinary Vessel 360 risk factors.
- Retire **Document integrity (A03)** from the editable risk factor list,
  published future central risk policies and new vessel risk calculations.
- Continue to accept legacy *stored* six-signal assessments as historical
  evidence without changing their saved source score, historical policies,
  Oracle records or case audit.
- Restore a separate Accidents / Incidents tab only when matching real
  source-fed records exist for the exact IMO, not invented data or a vessel
  risk calculation. Source failure hides the tab.
- Preserve A01 Historical Assessment Case Retry (#80), Command Center
  incident filtering (#81), Google Sheets incident data and all existing
  persistence schemas. No DDL/DML or paid agent calls.
- A03 independent document-intelligence experimental pipeline and historical
  metadata are not deleted; A03 no longer contributes a **vessel risk factor**
  or appears as the retired Vessel 360 Documents tab.
- Add a source regression test to prevent reintroduction.

## Safety note

If the currently published policy was created historically with
`documentIntegrity>0`, an authorized five-factor (A03 0%) policy must be
published before new fleet scoring using the new backend. Do not rewrite the
old policy or past assessments. In the user's latest confirmed test the
Document Integrity weight was already zero.

## Local verification after network access resumes

Use the new branch as a follow-up to the currently tested A01/incident-filter
branch, compile and test before any redeploy:

```powershell
git fetch origin feature/nmc-regression-retire-v360-docs-a03-20261012
git merge --no-ff --no-edit FETCH_HEAD
node --test scripts/test-nmc-v360-a03-retired-regression.mjs
node --test scripts/test-nmc-command-incident-filters.mjs
npm run build
```

**Do not assume a successful fetch if github.com port 443 is unavailable.**
No automatic Docker rebuild/deployment from GitHub. Keep four Compose files
and the existing Oracle container, and avoid enabling automatic paid AI
schedulers just to verify a UI change.
