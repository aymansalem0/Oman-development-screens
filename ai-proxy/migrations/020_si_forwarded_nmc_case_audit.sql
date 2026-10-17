-- MOEI NMC POC migration 020 - Supervisor-approved SI -> NMC cases.
-- DBA-MANUAL; additive/non-destructive on existing Oracle schema.
-- Apply as NMC_AI in FREEPDB1 AFTER database backup, only once and only
-- when preflight checks below match. Do not put this in Docker startup.
--
-- WHY: Existing NMC_CASE.SOURCE_ALERT_ID is NOT NULL, but an approved
-- Smart Inspection report must open an NMC Case without fabricating an Alert.
-- New audit actions were also absent from the original 004/005 allowlist
-- and the risk action is longer than the original 32 CHAR column.
--
-- PRE-FLIGHT (send results to DBA):
-- SELECT COLUMN_NAME,NULLABLE,DATA_LENGTH,CHAR_LENGTH FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME='NMC_CASE' AND COLUMN_NAME='SOURCE_ALERT_ID';
-- SELECT COLUMN_NAME,CHAR_LENGTH FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME='NMC_CASE_AUDIT' AND COLUMN_NAME='ACTION_NAME';
-- SELECT CONSTRAINT_NAME,SEARCH_CONDITION_VC,STATUS
--  FROM USER_CONSTRAINTS WHERE TABLE_NAME='NMC_CASE_AUDIT'
--  AND CONSTRAINT_TYPE='C';
-- SELECT COUNT(*) FROM NMC_CASE;
-- SELECT COUNT(*) FROM NMC_CASE_AUDIT;
-- Assert the original source alert FK and unique ACTIVE_IMO are preserved.
-- Check that the old case-audit action check is V2 or original V1 and that
-- every already saved action name appears in the V3 list below:
-- SELECT DISTINCT ACTION_NAME FROM NMC_CASE_AUDIT ORDER BY ACTION_NAME;
--
-- Step 1: NULL means an SI-source case, never a fabricated NMC_ALERT.
ALTER TABLE NMC_CASE MODIFY (SOURCE_ALERT_ID NULL);
-- Step 2: Longer provenance types are required by post-inspection risk.
ALTER TABLE NMC_CASE_AUDIT MODIFY (ACTION_NAME VARCHAR2(64 CHAR));
-- Step 3: Install new restrictive V3 allowlist before dropping old checks.
ALTER TABLE NMC_CASE_AUDIT ADD CONSTRAINT CK_NMC_CASE_AUDIT_ACT_V3
 CHECK (ACTION_NAME IN (
  'CREATED','ALERT_LINKED','TASK_START','TASK_COMPLETE','TASK_ESCALATE',
  'DECISION_RECORDED','INSPECTION_RECORDED','RESOLVED',
  'A01_ACTION_PLAN_RECORDED','A01_ACTION_ACCEPT','A01_ACTION_MODIFY',
  'A01_ACTION_REJECT','INSPECTION_SCHEDULED',
  'INCIDENT_LINKED','INCIDENT_CASE_CREATED',
  'INCIDENT_DECISION_ACCEPT','INCIDENT_DECISION_MODIFY',
  'INCIDENT_DECISION_REJECT','SI_APPROVED_REPORT_FORWARDED',
  'SI_POST_INSPECTION_AI_RISK_REASSESSED','INSPECTION_SUPERVISOR_REVIEW',
  'SINGLE_DECISION_FROM_SAVED_A01',
  'OPERATIONAL_DECISION_ACCEPT','OPERATIONAL_DECISION_MODIFY',
  'OPERATIONAL_DECISION_REJECT',
  'POC_RESTRICTION_SIMULATED_AUTHORIZED',
  'POC_RESTRICTION_SIMULATED_RELEASED'
 ));
-- Step 4: DBA must identify the *existing* restrictive check precisely.
-- On migration 005 it is normally CK_NMC_CASE_AUDIT_ACT_V2. If the name is
-- different, STOP and reconcile; do not run a blind replacement.
ALTER TABLE NMC_CASE_AUDIT DROP CONSTRAINT CK_NMC_CASE_AUDIT_ACT_V2;
--
-- POST-FLIGHT: Confirm stored rows unchanged, V3 ENABLED and V2 absent.
-- SELECT COLUMN_NAME,NULLABLE FROM USER_TAB_COLUMNS
--  WHERE TABLE_NAME='NMC_CASE' AND COLUMN_NAME='SOURCE_ALERT_ID';
-- SELECT CONSTRAINT_NAME,STATUS FROM USER_CONSTRAINTS
--  WHERE TABLE_NAME='NMC_CASE_AUDIT' AND CONSTRAINT_NAME LIKE
--   'CK_NMC_CASE_AUDIT_ACT%';
-- SELECT COUNT(*) FROM NMC_CASE;
-- SELECT COUNT(*) FROM NMC_CASE_AUDIT;
-- Oracle DDL commits immediately. NEVER rerun after a partially completed
-- migration without inspecting the current schema state first.
