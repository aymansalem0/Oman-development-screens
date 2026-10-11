-- Migration 017 (manual): expand NMC Case audit actions used by incident
-- intake and later human-approved case workflows.
-- Apply to the existing NMC_AI Oracle POC schema ONLY after DBA review,
-- verified backup, and read-only checks below. NEVER re-run blindly.
-- This migration never deletes or updates an existing case/audit record.
--
-- Relevant backend:
--   ai-proxy/case-workspace.mjs
--   fromIncident() writes INCIDENT_CASE_CREATED or INCIDENT_LINKED.
-- Migration 005 allows neither; it also omits later decision/restriction
-- actions. POC restriction action labels exceed VARCHAR2(32 CHAR).
--
-- PRE-FLIGHT (run separately, read only):
-- SELECT column_name,nullable,data_length,char_length FROM user_tab_columns
-- WHERE table_name IN ('NMC_CASE','NMC_CASE_AUDIT')
-- AND column_name IN ('SOURCE_ALERT_ID','ACTION_NAME');
-- SELECT constraint_name,status,search_condition_vc FROM user_constraints
-- WHERE table_name='NMC_CASE_AUDIT' AND constraint_type='C'
-- AND constraint_name IN ('CK_NMC_CASE_AUDIT_ACTION',
--   'CK_NMC_CASE_AUDIT_ACT_V2','CK_NMC_CASE_AUDIT_ACT_V3');
-- SELECT COUNT(*) FROM NMC_CASE_AUDIT;
--
-- Required separate source-alert patch (already in the repo):
-- tools/oracle/nmc-incident-case-source.sql
-- That patch allows incident-only cases (SOURCE_ALERT_ID=NULL).
--
WHENEVER SQLERROR EXIT SQL.SQLCODE
SET SERVEROUTPUT ON

DECLARE
  v_table_count INTEGER;
  v_old_count INTEGER;
  v_new_count INTEGER;
  v_action_len INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_table_count FROM user_tables
   WHERE table_name IN ('NMC_CASE','NMC_CASE_AUDIT');
  IF v_table_count<>2 THEN
    RAISE_APPLICATION_ERROR(-20017,'NMC_CASE / NMC_CASE_AUDIT tables required');
  END IF;
  SELECT COUNT(*) INTO v_old_count FROM user_constraints
   WHERE table_name='NMC_CASE_AUDIT'
     AND constraint_name IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2')
     AND constraint_type='C';
  IF v_old_count<>1 THEN
    RAISE_APPLICATION_ERROR(-20018,'Expected exactly one known legacy audit-action CHECK; inspect schema manually');
  END IF;
  SELECT COUNT(*) INTO v_new_count FROM user_constraints
   WHERE table_name='NMC_CASE_AUDIT' AND constraint_name='CK_NMC_CASE_AUDIT_ACT_V3';
  IF v_new_count<>0 THEN
    RAISE_APPLICATION_ERROR(-20019,'Audit v3 constraint already exists. Do not re-run migration');
  END IF;
  SELECT char_length INTO v_action_len FROM user_tab_columns
   WHERE table_name='NMC_CASE_AUDIT' AND column_name='ACTION_NAME';
  IF v_action_len<32 THEN
    RAISE_APPLICATION_ERROR(-20020,'Unexpected ACTION_NAME column size');
  END IF;
  DBMS_OUTPUT.PUT_LINE('Preflight accepted. Review backup status before proceeding.');
END;
/

-- Enlarges ACTION_NAME to support the new *audit label* values, preserving
-- all old rows. No existing records are changed.
ALTER TABLE NMC_CASE_AUDIT MODIFY (ACTION_NAME VARCHAR2(64 CHAR));

-- Add new, explicit allowlist BEFORE dropping the prior constraint.
ALTER TABLE NMC_CASE_AUDIT ADD CONSTRAINT CK_NMC_CASE_AUDIT_ACT_V3 CHECK
 (ACTION_NAME IN (
  'CREATED',
  'ALERT_LINKED',
  'INCIDENT_CASE_CREATED',
  'INCIDENT_LINKED',
  'INCIDENT_DECISION_ACCEPT',
  'INCIDENT_DECISION_MODIFY',
  'INCIDENT_DECISION_REJECT',
  'TASK_START',
  'TASK_COMPLETE',
  'TASK_ESCALATE',
  'DECISION_RECORDED',
  'INSPECTION_RECORDED',
  'A01_ACTION_PLAN_RECORDED',
  'A01_ACTION_ACCEPT',
  'A01_ACTION_MODIFY',
  'A01_ACTION_REJECT',
  'SINGLE_DECISION_FROM_SAVED_A01',
  'OPERATIONAL_DECISION_ACCEPT',
  'OPERATIONAL_DECISION_MODIFY',
  'OPERATIONAL_DECISION_REJECT',
  'POC_RESTRICTION_SIMULATED_AUTHORIZED',
  'POC_RESTRICTION_SIMULATED_RELEASED',
  'INSPECTION_SCHEDULED',
  'RESOLVED'
 ));

-- The V3 check protects pre-existing records and new actions. Drop ONLY
-- the known old restrictive check. If the script stops, request DBA review;
-- Oracle DDL auto-commits and this migration is NOT automatically reversible.
DECLARE
  v_name VARCHAR2(128);
BEGIN
  SELECT constraint_name INTO v_name FROM user_constraints
   WHERE table_name='NMC_CASE_AUDIT'
     AND constraint_name IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2')
     AND constraint_type='C';
  EXECUTE IMMEDIATE 'ALTER TABLE NMC_CASE_AUDIT DROP CONSTRAINT ' || v_name;
END;
/

-- Read-only post-flight verification: v3 ENABLED, v1/v2 absent, counts
-- unchanged from preflight, ACTION_NAME permits at least 64 characters.
SELECT column_name,char_length FROM user_tab_columns
 WHERE table_name='NMC_CASE_AUDIT' AND column_name='ACTION_NAME';
SELECT constraint_name,status FROM user_constraints
 WHERE table_name='NMC_CASE_AUDIT'
   AND constraint_name IN ('CK_NMC_CASE_AUDIT_ACTION','CK_NMC_CASE_AUDIT_ACT_V2','CK_NMC_CASE_AUDIT_ACT_V3');
SELECT COUNT(*) AS CASES FROM NMC_CASE;
SELECT COUNT(*) AS AUDIT_ROWS FROM NMC_CASE_AUDIT;
