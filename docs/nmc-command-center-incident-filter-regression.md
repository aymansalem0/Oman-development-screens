# NMC Command Center — Maritime Incident Filter Regression Fix

## User-observed behavior (12 October 2026)

The incident feed API reported three active cases across two distinct IMOs:
- 9328471: INC-POC-0001 (RECEIVED), INC-POC-0003 (UNDER_VERIFICATION)
- 9400409: INC-POC-0002 (RECEIVED)

Incidents were confirmed active via read-only GET after restart. Automatic
incident triage was false, which does NOT hide already saved source reports.

The prior Command Center markup had risk, AI assessment, vessel-type and search
controls, but no incident filter. This was already true before the historical
A01 assessment fix; the previous A01 PR did not touch Command Center files.
The attention queue displays only six vessels per page, so incident buttons
can be pushed out of sight behind higher-ranked fleet-risk rows.

## Behavior

One incident filter controls BOTH map marker eligibility and Requires Attention:
- All: existing default
- Active: all source-open, non-resolved incidents by exact IMO, regardless of
  whether Airia automation is enabled or whether a vessel A01/A02 score exists.
- Critical / High: only ACTIVE incident severity, using a **current** incident
  AI assessment when present, otherwise the clearly labeled **reported** severity.
  Does not use the vessel's risk score.
- Pending Human Review: ACTIVE reports with pending NMC case human review or a
  saved incident AI assessment that is not yet human-reviewed.
  Unassessed source reports are NOT invented as saved human-review cases.
- None: vessels with no active incidents.

The prominent Active Incidents button above the Requires Attention queue toggles
the same filter, and incident vessels rank first when the filter is All.
Multiple active incidents for one IMO are counted as ONE vessel, but the row
button shows the full number of reports.

If the source fails, the UI does not claim that zero incidents exist; the filter
shows a source-unavailable warning. No writes or AI requests are performed by
selecting filters.

## Regression test

With Node/npm dependencies installed:

```
node --test scripts/test-nmc-command-incident-filters.mjs
npm run build
```

The regression test checks:
- IMO 9328471 => 2 reports; 9400409 => 1 report; 2 distinct vessels.
- AI-derived vs source-reported incident severity.
- Case-pending and AI officer-review states.
- Closed/resolved source rows are not active.
- Shared filter wiring of map + attention + the active-incident shortcut.

## Deployment

Review this branch/PR and integrate into the local A01 test branch. Build the
Angular image and recreate **only** the NMC frontend if the AI proxy is already
running the desired version. No Oracle migration or Airia API calls are needed
for this frontend regression fix.
