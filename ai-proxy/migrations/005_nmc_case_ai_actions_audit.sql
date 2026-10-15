-- MOEI NMC POC migration 005 — expand central case audit actions for
-- AI action plans, officer decisions and human Smart Inspection scheduling.
-- Apply ONCE as NMC_AI in FREEPDB1 ONLY AFTER migration 004, following backup.
-- Non-destructive: NMC_CASE, NMC_CASE_AUDIT, existing audit rows and all saved
-- assessments remain unchanged. This is an Oracle DDL migration (auto-commit).
--
-- PRE-FLIGHT as NMC_AI:
-- SELECT CONSTRAINT_NAME,STATUS FROM USER_CONSTRAINTS
-- WHERE TABLE_NAME='NMC_CASE_AUDIT'
--   AND CONSTRAINT_NAME IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2');
-- Expect CK_NMC_CASE_AUDIT_ACTION PRESENT, CK_NMC_CASE_AUDIT_ACT_V2 ABSENT.
-- SELECT COUNT(*) FROM NMC_CASE_AUDIT; -- note count for post-flight.
-- If the V2 constraint already exists, DO NOT rerun; involve DBA.
--
-- Add extended constraint BEFORE dropping old one, protecting stored rows.
ALTER TABLE NMC_CASE_AUDIT ADD CONSTRAINT CK_NMC_CASE_AUDIT_ACT_V2
  CHECK (ACTION_NAME IN (
    'CREATED',
    'ALERT_LINKED',
    'TASK_START',
    'TASK_COMPLETE',
    'TASK_ESCALATE',
    'DECISION_RECORDED',
    'INSPECTION_RECORDED',
    'RESOLVED',
    'A01_ACTION_PLAN_RECORDED',
    'A01_ACTION_ACCEPT',
    'A01_ACTION_MODIFY',
    'A01_ACTION_REJECT',
    'INSPECTION_SCHEDULED'
  ));

-- Drop ONLY the legacy restrictive check, after V2 is in place.
ALTER TABLE NMC_CASE_AUDIT DROP CONSTRAINT CK_NMC_CASE_AUDIT_ACTION;

-- Read-only validation: V2 enabled, old absent, audit row count unchanged.
SELECT CONSTRAINT_NAME,STATUS
FROM USER_CONSTRAINTS
WHERE TABLE_NAME='NMC_CASE_AUDIT'
  AND CONSTRAINT_NAME IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2');
SELECT COUNT(*) AS AUDIT_ROWS FROM NMC_CASE_AUDIT;

-- Oracle DDL auto-commits. Do not blindly re-run following partial execution.
