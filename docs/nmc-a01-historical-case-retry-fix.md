# Historical Case A01 Retry — POC remediation

Read-only Oracle query confirmed that vessel 9702281 has two preserved assessments: the case's original assessment 834f549a-7c49-4840-b322-639b44e505ba with score 48 and five factors, and a newer assessment 5508048e-1b76-46c7-b8b2-219d2cb0ce0f with score 50 and five factors. Both are High. The old retry only reads the newest assessment, making the existing case fail its exact-source check.

This proposed patch retrieves the original assessment by exact ID, verifies the case IMO, score, risk level and factors, and shows a read-only case/current comparison before requesting A01. When the original is no longer the newest source, an operator must explicitly acknowledge the discrepancy and confirm one A01 request. The backend checks the acknowledgment against the current latest ID and rejects mismatches before invoking AI. A new saved plan marks its evidence as historical; it never changes the original case score or creates tasks without human approval.

After deploying the reviewed changes, check:

```powershell
$c = (Invoke-RestMethod 'http://localhost:4200/api/ai/cases/by-imo/9702281').case
Invoke-RestMethod "http://localhost:4200/api/ai/cases/$($c.id)/action-plan-source" |
  Select-Object ready,isHistorical,caseScore,latestScore,requiresHistoricalAcknowledgement
```

Expected for this case before any A01 retry: ready=true, isHistorical=true, caseScore=48, latestScore=50, requiresHistoricalAcknowledgement=true.

Run unit tests: `node --test ai-proxy/test/case-source-provenance.test.mjs`. The GET check is free, while an explicitly confirmed A01 retry may incur usage costs.

This draft does not alter Oracle schema, regenerate risk or enforce maritime actions. Future work should separately review business rules governing opening a case from an older alert.
