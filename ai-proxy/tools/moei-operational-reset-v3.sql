-- SAFE BUNDLED RESET SCRIPT: altered from user-supplied V3 to PREVIEW/NO/NOT_CONFIRMED by default.
-- APPLY requires offline verified runner. NEVER execute directly as a web request.
-- ============================================================================
-- MOEI UAE Maritime POC | Oracle 23c Free / FREEPDB1 / NMC_AI
-- OPERATIONAL PROCESS RESET V3 (full SI plan + NMC alerts + safe case-link cleanup)
-- Version: 2026-10-15.3 | TOAD: Execute as Script (F5); enable DBMS Output
-- ============================================================================
-- BUSINESS GOAL
--   Start the OPERATOR PROCESS again from a clean slate while PRESERVING
--   imported / feeding data, saved maritime risk, vessel catalogue, selection
--   policies, master tables, templates, workforce and historical source files.
--
-- RESET SCOPE SWITCHES: default FULL OPERATIONAL RESET, PREVIEW ONLY.
--   SI plans/work orders/actions + ALL NMC alerts including ACKNOWLEDGED.
--   NMC_CASE and its original referrals/audit remain preserved.
--   If APPLY is explicitly enabled, detach the known nullable alert FK
--   and remove *only* the case alertIds array in the two linked case JSON
--   records before deleting the obsolete alerts, all in ONE transaction.
-- WHAT IS RESET (installed tables only):
--   - IF g_reset_si_actions='YES': Smart Inspection approvals and work orders (019),
--     rolling plans, case/execution lifecycle, AI preparation/dossier,
--     per-case checklist answers and reviews, candidate/PSC decisions, AI runs.
--   - IF g_reset_nmc_alerts='YES': ALL NMC alerts including ACKNOWLEDGED /
--     IN_PROGRESS, and their complete audit trail.
--   - NMC cases and their audit are intentionally PRESERVED as potential
--     sources for SI candidate referrals; they are NOT part of this reset.
--
-- NOT RESET:
--   SI_CANDIDATE_EVENT; SI_TARGETING_RULE_VERSION;
--   SI_PSC_SELECTION_POLICY; SI_CHK_TEMPLATE / REVISION / library / master;
--   SI_SCHED_MUTEX lock row; NMC_CASE / NMC_CASE_AUDIT;
--   NMC_VESSEL / DATA_SOURCE / saved risk / A01-A03;
--   Oracle schema/DDL/migrations; Oracle sequences; external feeds;
--   imported PSC / MSW / ERP Excel; all system configuration.
--
-- NO DROP / TRUNCATE / CASCADE / DISABLE CONSTRAINTS / COMMIT PER TABLE.
-- One Oracle transaction for all DELETE operations: ROLLBACK on any error.
-- PREVIEW by default. To execute, FIRST take and verify a RESTORABLE external
-- backup of NMC_AI/FREEPDB1 and STOP ALL application writers. Then explicitly
-- set g_mode='APPLY', g_backup_verified='YES', g_services_stopped='YES',
-- g_alert_scanner_disabled='YES', g_ack='RESET_MOEI_OPERATIONAL_PROCESS'.
-- Disable alert scan in the RUNTIME OVERRIDE (not only .env), and verify
-- this using the platform's runtime settings UI or GET before restart.
-- Scanning saved A01/A02 risk can CREATE NEW OPEN alerts after a reset.
-- Never use on a production system.
--
-- WARNING: Full reset changes these *operational links* within NMC_CASE:
--   SOURCE_ALERT_ID := NULL, DOC_JSON.alertIds := [] on linked rows only.
-- This preserves ALL other case fields, the source-assessment ID, approval
-- requests, original NMC_CASE_AUDIT and originating source data. Historic
-- audit DETAIL_JSON may still mention former alert IDs: the external backup
-- preserves the original NMC_ALERT rows for forensic lookup.
-- The four case records are NOT deleted, and still appear in NMC workspace.
-- For a truly empty NMC case inbox, a separate archival/migration design
-- is required to avoid loss of original SI source referrals.
-- IMPORTANT: SQL ONLY changes Oracle tables. JSON process state in Docker's
-- /data volume is NOT reset here; see companion RUNBOOK for separate step.
-- ============================================================================
SET SERVEROUTPUT ON SIZE UNLIMITED
SET DEFINE OFF

DECLARE
  -- =======================================================
  -- CHANGE THESE SETTINGS ONLY AFTER REVIEWING THE PREVIEW
  -- =======================================================
--  g_mode                 CONSTANT VARCHAR2(10) := 'PREVIEW';  -- PREVIEW or APPLY
--  g_backup_verified      CONSTANT VARCHAR2(3)  := 'NO';       -- YES only when verified
--  g_services_stopped     CONSTANT VARCHAR2(3)  := 'NO';       -- YES only when writers stopped
--  g_ack                  CONSTANT VARCHAR2(45) := 'NOT_CONFIRMED';
--  g_reset_si_actions      CONSTANT VARCHAR2(3)  := 'YES';      -- YES = CLEAR ALL SI PLANS / ACTIONS
--  g_reset_nmc_alerts     CONSTANT VARCHAR2(3)  := 'YES';      -- independent of cases
--  g_alert_scanner_disabled CONSTANT VARCHAR2(3) := 'NO';   -- CHECK runtime override too
--  g_clear_case_alert_links CONSTANT VARCHAR2(3) := 'NO';
  
g_mode                  CONSTANT VARCHAR2(10) := 'PREVIEW';
g_backup_verified       CONSTANT VARCHAR2(3)  := 'NO';
g_services_stopped      CONSTANT VARCHAR2(3)  := 'NO';
g_reset_si_actions      CONSTANT VARCHAR2(3)  := 'YES';
g_reset_nmc_alerts      CONSTANT VARCHAR2(3)  := 'YES';
g_alert_scanner_disabled CONSTANT VARCHAR2(3) := 'NO';
g_clear_case_alert_links CONSTANT VARCHAR2(3) := 'NO';
g_ack CONSTANT VARCHAR2(45) := 'NOT_CONFIRMED';
  -- APPLY needs YES: clear only NMC_CASE.SOURCE_ALERT_ID and DOC_JSON.alertIds
  -- with a verified backup (case source fields, referrals, and audit retained).
  g_max_rows_per_table   CONSTANT NUMBER       := 100000;    -- POC safeguard
  g_required_schema      CONSTANT VARCHAR2(30) := 'NMC_AI';
  g_required_pdb         CONSTANT VARCHAR2(30) := 'FREEPDB1';

  TYPE t_names IS TABLE OF VARCHAR2(128) INDEX BY PLS_INTEGER;
  TYPE t_pos   IS TABLE OF PLS_INTEGER INDEX BY VARCHAR2(128);
  TYPE t_nums  IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
  TYPE t_flags IS TABLE OF PLS_INTEGER INDEX BY PLS_INTEGER;
  v_table                t_names;
  v_where                t_names;
  v_idx                  t_pos;
  v_count                t_nums;
  v_present              t_flags;
  v_done                 t_flags;
  v_order                t_nums;
  v_edge_parent          t_names;
  v_edge_child           t_names;
  v_n                    PLS_INTEGER := 0;
  v_edges                PLS_INTEGER := 0;
  v_ordered              PLS_INTEGER := 0;
  v_existing             PLS_INTEGER := 0;
  v_bad_fk               PLS_INTEGER := 0;
  v_delete_triggers      PLS_INTEGER := 0;
  v_case_update_triggers PLS_INTEGER := 0;
  v_nmc_source_events    NUMBER := 0;
  v_case_alert_refs      NUMBER := 0;
  v_case_fk_refs         NUMBER := 0;
  v_case_link_rows       NUMBER := 0;
  v_detachable_fk        NUMBER := 0;
  v_case_json_count      NUMBER := 0;
  v_case_processed       NUMBER := 0;
  v_preserved_cases      NUMBER := 0;
  v_preserved_case_audit NUMBER := 0;
  v_preserved_sources    NUMBER := 0;
  v_preserved_risk       NUMBER := 0;
  v_case_obj             JSON_OBJECT_T;
  v_case_new_clob        CLOB;
  v_count_sources        NUMBER := 0;
  v_unknown_actions      PLS_INTEGER := 0;
  v_here                 PLS_INTEGER;
  v_can_go               BOOLEAN;
  v_choice               PLS_INTEGER;
  v_table_name           VARCHAR2(128);
  v_deleted              NUMBER;
  v_total                NUMBER := 0;
  v_owner                VARCHAR2(128) := SYS_CONTEXT('USERENV','CURRENT_SCHEMA');
  v_pdb                  VARCHAR2(128) := SYS_CONTEXT('USERENV','CON_NAME');
  v_session_user         VARCHAR2(128) := SYS_CONTEXT('USERENV','SESSION_USER');

  PROCEDURE add_target(p_table VARCHAR2, p_condition VARCHAR2 DEFAULT NULL) IS
  BEGIN
    IF v_idx.EXISTS(p_table) THEN
      RAISE_APPLICATION_ERROR(-20700,'Duplicate target: '||p_table);
    END IF;
    v_n := v_n + 1;
    v_table(v_n) := p_table;
    v_where(v_n) := p_condition;
    v_idx(p_table) := v_n;
  END;

  FUNCTION predicate_for(p_index PLS_INTEGER) RETURN VARCHAR2 IS
  BEGIN
    IF v_where(p_index) IS NOT NULL THEN
      RETURN ' WHERE '||v_where(p_index);
    END IF;
    RETURN '';
  END;

  FUNCTION rows_for(p_index PLS_INTEGER) RETURN NUMBER IS
    l_result NUMBER;
  BEGIN
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM '||v_table(p_index)||
      predicate_for(p_index) INTO l_result;
    RETURN l_result;
  END;

BEGIN
  DBMS_OUTPUT.PUT_LINE('======================================================');
  DBMS_OUTPUT.PUT_LINE('MOEI OPERATIONAL RESET | mode='||g_mode||
    ' | SI actions='||g_reset_si_actions||
    ' | NMC alerts='||g_reset_nmc_alerts||' | NMC cases=PRESERVED');
  DBMS_OUTPUT.PUT_LINE('Connected schema='||v_owner||' | PDB='||v_pdb||
    ' | user='||v_session_user);
  DBMS_OUTPUT.PUT_LINE('======================================================');

  -- Strict identity checks BEFORE even counting or mutating rows.
  IF v_owner <> g_required_schema OR UPPER(v_pdb) <> g_required_pdb OR
     UPPER(v_session_user) <> g_required_schema THEN
    RAISE_APPLICATION_ERROR(-20701,
      'WRONG USER/SCHEMA/PDB. Expected NMC_AI on FREEPDB1. NOTHING DELETED.');
  END IF;
  IF g_mode NOT IN ('PREVIEW','APPLY') OR
     g_reset_si_actions NOT IN ('YES','NO') OR
     g_reset_nmc_alerts NOT IN ('YES','NO') OR
     (g_reset_si_actions='NO' AND g_reset_nmc_alerts='NO') OR
     g_alert_scanner_disabled NOT IN ('YES','NO') OR
     g_clear_case_alert_links NOT IN ('YES','NO') THEN
    RAISE_APPLICATION_ERROR(-20702,'INVALID MODE OR NMC FLAG. NOTHING DELETED.');
  END IF;
  IF g_mode='APPLY' AND NOT (
       g_backup_verified='YES' AND g_services_stopped='YES' AND
       g_ack='RESET_MOEI_OPERATIONAL_PROCESS' AND
       (g_reset_nmc_alerts='NO' OR g_alert_scanner_disabled='YES')) THEN
    RAISE_APPLICATION_ERROR(-20703,
      'APPLY BLOCKED: RESTORABLE backup, stopped writers, scanner OFF and explicit ACK required.');
  END IF;

  -- Exact approved ACTION table catalogue from repository reset scripts,
  -- plus the missing migration 019 schedule/work-order tables. NO WILDCARDS.
  -- Ordering is computed from the LIVE Oracle FK constraints, not this list.
  IF g_reset_si_actions = 'YES' THEN
  add_target('SI_SCHED_ORDER_AUDIT');
  add_target('SI_SCHED_WORK_ORDER');
  add_target('SI_SCHED_APPROVAL');
  add_target('SI_CHK_AI_REVIEW');
  add_target('SI_CHK_AI_PROPOSAL');
  add_target('SI_CHK_EVIDENCE');
  add_target('SI_CHK_CASE_ITEM');
  add_target('SI_CHK_AUDIT','RUN_ID IS NOT NULL'); -- keep template/library audit
  add_target('SI_CHK_CASE_RUN');
  add_target('SI_INSPECTION_LIFECYCLE_AUDIT');
  add_target('SI_INSPECTION_LIFECYCLE');
  add_target('SI_PREPARATION_AUDIT');
  add_target('SI_PREPARATION_DOSSIER');
  add_target('SI_PLAN_ROLLING_REASON');
  add_target('SI_PLAN_ROLLING_VESSEL');
  add_target('SI_PLAN_ROLLING_AUDIT');
  add_target('SI_PLAN_ROLLING_VERSION');
  add_target('SI_PLAN_ROLLING');
  add_target('SI_INSPECTION_CASE');
  add_target('SI_CANDIDATE_DECISION');
  add_target('SI_PSC_SELECTION_DECISION');
  add_target('SI_AI_PRIORITY_RUN');
  END IF;
  IF g_reset_nmc_alerts = 'YES' THEN
    add_target('NMC_ALERT_AUDIT');
    add_target('NMC_ALERT');
  END IF;

  IF g_reset_si_actions='YES' THEN
    SELECT COUNT(*) INTO v_here FROM USER_TABLES
      WHERE TABLE_NAME='SI_INSPECTION_CASE';
  IF v_here <> 1 THEN
    RAISE_APPLICATION_ERROR(-20704,
      'Missing SI_INSPECTION_CASE / migration 009. NOT THE EXPECTED SCHEMA.');
  END IF;
  END IF;

  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 1) ACTION TABLES | BEFORE ===');
  FOR i IN 1..v_n LOOP
    SELECT COUNT(*) INTO v_here FROM USER_TABLES
      WHERE TABLE_NAME = v_table(i);
    v_present(i) := CASE WHEN v_here=1 THEN 1 ELSE 0 END;
    v_done(i) := 0;
    IF v_here=1 THEN
      v_existing := v_existing+1;
      v_count(i) := rows_for(i);
      v_total := v_total+v_count(i);
      DBMS_OUTPUT.PUT_LINE(RPAD(v_table(i),36)||
        '  rows='||TO_CHAR(v_count(i))||
        CASE WHEN v_where(i) IS NOT NULL THEN ' [FILTER: '||v_where(i)||']' ELSE '' END);
      IF v_count(i)>g_max_rows_per_table THEN
        RAISE_APPLICATION_ERROR(-20705,
          'POC max row safety limit exceeded in '||v_table(i));
      END IF;
    ELSE
      v_count(i):=0;
      DBMS_OUTPUT.PUT_LINE(RPAD(v_table(i),36)||'  NOT INSTALLED (skip)');
    END IF;
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('Total action records targeted='||v_total);

  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 2) SOURCE / CONFIG TABLES PRESERVED ===');
  FOR r IN (
    SELECT table_name FROM USER_TABLES
    WHERE table_name IN (
      'SI_CANDIDATE_EVENT','SI_TARGETING_RULE_VERSION',
      'SI_PSC_SELECTION_POLICY','SI_CHK_TEMPLATE','SI_CHK_REVISION',
      'SI_CHK_MD_GROUP','SI_CHK_MD_VALUE','SI_SCHED_MUTEX',
      'NMC_CASE','NMC_CASE_AUDIT',
      'NMC_VESSEL','NMC_VESSEL_CURRENT_STATE','NMC_AI_ASSESSMENT',
      'NMC_AI_RISK_FACTOR','NMC_AI_JOB','NMC_DATA_SOURCE',
      'NMC_RISK_POLICY_VERSION','NMC_GUIDANCE_POLICY')
    ORDER BY table_name
  ) LOOP
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM '||r.table_name
      INTO v_count_sources;
    DBMS_OUTPUT.PUT_LINE('KEEP '||RPAD(r.table_name,38)||
      ' rows='||TO_CHAR(v_count_sources));
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('KEEP every non-target table, Oracle schema and /data source file.');

  -- Unchanged-count invariants for the four key preserved data classes.
  SELECT COUNT(*) INTO v_preserved_cases FROM NMC_CASE;
  SELECT COUNT(*) INTO v_preserved_case_audit FROM NMC_CASE_AUDIT;
  SELECT COUNT(*) INTO v_preserved_sources FROM SI_CANDIDATE_EVENT;
  SELECT COUNT(*) INTO v_preserved_risk FROM NMC_AI_ASSESSMENT;
  DBMS_OUTPUT.PUT_LINE('PROTECTED COUNTS SNAPSHOT: cases='||v_preserved_cases||
    ', case audit='||v_preserved_case_audit||
    ', SI source events='||v_preserved_sources||
    ', saved risk assessments='||v_preserved_risk);

  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 2B) OTHER SI TABLES RETAINED ===');
  -- Log additions introduced by future schema versions instead of deleting
  -- unknown tables under a wildcard. New action tables block APPLY until
  -- their FK/data semantics are reviewed and the catalogue is updated.
  IF g_reset_si_actions='YES' THEN
  FOR r IN (SELECT table_name FROM USER_TABLES
            WHERE table_name LIKE 'SI_%' ORDER BY table_name) LOOP
    IF NOT v_idx.EXISTS(r.table_name) THEN
      DBMS_OUTPUT.PUT_LINE('KEEP (not targeted) '||r.table_name);
      IF (r.table_name LIKE 'SI_SCHED_%' AND
            r.table_name <> 'SI_SCHED_MUTEX') OR
         r.table_name LIKE 'SI_PLAN_ROLLING_%' OR
         r.table_name LIKE 'SI_PREPARATION_%' OR
         r.table_name LIKE 'SI_INSPECTION_LIFECYCLE_%' OR
         r.table_name LIKE 'SI_CHK_CASE_%' OR
         r.table_name LIKE 'SI_CHK_AI_%' OR
         r.table_name LIKE 'SI_CHK_EVIDENCE_%' OR
         r.table_name LIKE 'SI_AI_PRIORITY_%' THEN
        v_unknown_actions:=v_unknown_actions+1;
        DBMS_OUTPUT.PUT_LINE('   REVIEW: unfamiliar process table!');
      END IF;
    END IF;
  END LOOP;

  END IF;

  -- The old script bundled NMC_CASE and NMC_ALERT under one switch.
  -- Because SI source referrals can depend on NMC_CASE, APPLY was blocked
  -- and ACKNOWLEDGED alert rows were never deleted. Cases are NOT targets.
  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 2C) NMC CASE SOURCE PRESERVATION ===');
  SELECT COUNT(*) INTO v_here FROM USER_TABLES
    WHERE TABLE_NAME='SI_CANDIDATE_EVENT';
  IF v_here=1 THEN
    SELECT COUNT(*) INTO v_here FROM USER_TAB_COLUMNS
      WHERE TABLE_NAME='SI_CANDIDATE_EVENT' AND COLUMN_NAME='SOURCE_TYPE';
    IF v_here=1 THEN
      EXECUTE IMMEDIATE
        'SELECT COUNT(*) FROM SI_CANDIDATE_EVENT WHERE SOURCE_TYPE=''NMC_CASE'''
        INTO v_nmc_source_events;
      DBMS_OUTPUT.PUT_LINE('PRESERVE SI source NMC_CASE events='||v_nmc_source_events);
    END IF;
  END IF;
  SELECT COUNT(*) INTO v_here FROM USER_TABLES WHERE TABLE_NAME='NMC_CASE';
  IF v_here=1 THEN
    -- DOC_JSON is the authoritative case document in this POC schema.
    SELECT COUNT(*) INTO v_here FROM USER_TAB_COLUMNS
       WHERE TABLE_NAME='NMC_CASE' AND COLUMN_NAME='DOC_JSON';
    IF v_here=1 THEN
      EXECUTE IMMEDIATE
        'SELECT COUNT(*) FROM NMC_CASE WHERE JSON_EXISTS(DOC_JSON, ''$.alertIds[0]'')'
         INTO v_case_alert_refs;
      DBMS_OUTPUT.PUT_LINE('NMC_CASE rows whose alertIds will be cleared in APPLY='||
        v_case_alert_refs);
      IF v_case_alert_refs>0 THEN
        DBMS_OUTPUT.PUT_LINE('NOTICE: only alertIds will be reset; remaining case JSON');
        DBMS_OUTPUT.PUT_LINE('fields, original referrals and case audit are PRESERVED.');
      END IF;
    END IF;
  END IF;
  IF g_reset_nmc_alerts='YES' THEN
    SELECT COUNT(*) INTO v_case_fk_refs
      FROM NMC_CASE WHERE SOURCE_ALERT_ID IS NOT NULL;
    DBMS_OUTPUT.PUT_LINE('NMC_CASE nullable SOURCE_ALERT_ID rows='||v_case_fk_refs);
    SELECT COUNT(*) INTO v_case_link_rows FROM NMC_CASE
      WHERE SOURCE_ALERT_ID IS NOT NULL OR JSON_EXISTS(DOC_JSON, '$.alertIds[0]');
    DBMS_OUTPUT.PUT_LINE('NMC_CASE rows requiring operational alert link cleanup='||v_case_link_rows);
  END IF;
  IF g_reset_nmc_alerts='YES' THEN
    SELECT COUNT(*) INTO v_here FROM USER_TABLES WHERE TABLE_NAME='NMC_ALERT';
    IF v_here=0 THEN
      RAISE_APPLICATION_ERROR(-20713,
        'NMC_ALERT table missing: alert reset selected but cannot verify.');
    END IF;
    SELECT COUNT(*) INTO v_here FROM USER_TABLES WHERE TABLE_NAME='NMC_ALERT_AUDIT';
    IF v_here=0 THEN
      RAISE_APPLICATION_ERROR(-20714,
        'NMC_ALERT_AUDIT missing: cannot safely purge alert history.');
    END IF;
    DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 2D) ALL NMC ALERT STATES TO RESET ===');
    FOR r IN (SELECT STATUS,COUNT(*) n FROM NMC_ALERT
              GROUP BY STATUS ORDER BY STATUS) LOOP
      DBMS_OUTPUT.PUT_LINE(RPAD(r.status,21)||' rows='||r.n);
    END LOOP;
    DBMS_OUTPUT.PUT_LINE('ACKNOWLEDGED included (not excluded from DELETE).');
  END IF;

  IF g_mode='APPLY' AND g_reset_nmc_alerts='YES' AND
     g_clear_case_alert_links<>'YES' THEN
    RAISE_APPLICATION_ERROR(-20716,
      'APPLY BLOCKED: Set g_clear_case_alert_links=YES after verifying backup and case source evidence.');
  END IF;

  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 3) FOREIGN KEY SAFETY CHECK ===');
  FOR r IN (
    SELECT p.table_name parent_table,c.table_name child_table,
           c.constraint_name fk_name
    FROM USER_CONSTRAINTS c
    JOIN USER_CONSTRAINTS p ON
      p.constraint_name=c.r_constraint_name AND c.r_owner=USER
    WHERE c.constraint_type='R'
  ) LOOP
    IF v_idx.EXISTS(r.parent_table) AND
       v_present(v_idx(r.parent_table))=1 THEN
      IF NOT v_idx.EXISTS(r.child_table) THEN
        IF g_reset_nmc_alerts='YES' AND
           r.parent_table='NMC_ALERT' AND r.child_table='NMC_CASE' AND
           r.fk_name='FK_NMC_CASE_ALERT' THEN
          -- Accept ONLY verified single-column nullable FK
          -- NMC_CASE.SOURCE_ALERT_ID -> NMC_ALERT.ALERT_ID.
          SELECT COUNT(*) INTO v_detachable_fk
            FROM USER_CONS_COLUMNS cc JOIN USER_TAB_COLUMNS col
              ON col.TABLE_NAME=cc.TABLE_NAME AND
                 col.COLUMN_NAME=cc.COLUMN_NAME
            JOIN USER_CONSTRAINTS constraint_info
              ON constraint_info.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
            WHERE cc.CONSTRAINT_NAME=r.fk_name AND
              cc.TABLE_NAME='NMC_CASE' AND cc.COLUMN_NAME='SOURCE_ALERT_ID'
              AND col.NULLABLE='Y' AND cc.POSITION=1
              AND constraint_info.STATUS='ENABLED';
          SELECT COUNT(*) INTO v_here FROM USER_CONS_COLUMNS
            WHERE CONSTRAINT_NAME=r.fk_name;
          IF v_detachable_fk<>1 OR v_here<>1 THEN
            v_bad_fk:=v_bad_fk+1;
            DBMS_OUTPUT.PUT_LINE('BLOCKING: case alert FK no longer known nullable one-column shape.');
          ELSE
            DBMS_OUTPUT.PUT_LINE('SAFE DETACH: '||r.fk_name||
              ' via SOURCE_ALERT_ID=NULL + DOC_JSON.alertIds=[];');
          END IF;
        ELSE
          v_bad_fk:=v_bad_fk+1;
          DBMS_OUTPUT.PUT_LINE('BLOCKING FK '||r.fk_name||' : '||
            r.child_table||' -> '||r.parent_table||' (child PRESERVED)');
        END IF;
      ELSIF v_present(v_idx(r.child_table))=0 THEN
        v_bad_fk:=v_bad_fk+1;
        DBMS_OUTPUT.PUT_LINE('BLOCKING FK child not installed: '||r.fk_name);
      ELSE
        v_edges:=v_edges+1;
        v_edge_child(v_edges):=r.child_table;
        v_edge_parent(v_edges):=r.parent_table;
      END IF;
    END IF;
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('Unknown foreign-key dependents='||v_bad_fk);

  -- A DELETE trigger can write to protected history/config outside this
  -- explicit list. Never trigger it silently during a reset.
  FOR r IN (
    SELECT trigger_name,table_name FROM USER_TRIGGERS
    WHERE status='ENABLED' AND triggering_event LIKE '%DELETE%'
  ) LOOP
    IF v_idx.EXISTS(r.table_name) THEN
      v_delete_triggers:=v_delete_triggers+1;
      DBMS_OUTPUT.PUT_LINE('REVIEW ENABLED DELETE TRIGGER '||r.trigger_name||
        ' ON '||r.table_name);
    END IF;
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('Enabled DELETE triggers on targets='||v_delete_triggers);
  -- The revised reset updates NMC_CASE.SOURCE_ALERT_ID and DOC_JSON.
  -- Review any UPDATE trigger there so source data is never altered silently.
  IF g_reset_nmc_alerts='YES' THEN
    FOR r IN (SELECT TRIGGER_NAME FROM USER_TRIGGERS
              WHERE TABLE_NAME='NMC_CASE' AND STATUS='ENABLED'
                AND TRIGGERING_EVENT LIKE '%UPDATE%') LOOP
      v_case_update_triggers:=v_case_update_triggers+1;
      DBMS_OUTPUT.PUT_LINE('BLOCKING CASE UPDATE TRIGGER '||r.TRIGGER_NAME);
    END LOOP;
  END IF;
  DBMS_OUTPUT.PUT_LINE('Enabled UPDATE triggers on protected NMC_CASE='||
    v_case_update_triggers);

  DBMS_OUTPUT.PUT_LINE(CHR(10)||'=== 4) FK-SAFE DELETION ORDER ===');
  -- Sort child BEFORE parent for the current installed schema. Detect cycles.
  WHILE v_ordered < v_existing LOOP
    v_choice:=0;
    FOR i IN 1..v_n LOOP
      IF v_present(i)=1 AND v_done(i)=0 THEN
        v_can_go:=TRUE;
        FOR j IN 1..v_edges LOOP
          IF v_edge_parent(j)=v_table(i) THEN
            v_here:=v_idx(v_edge_child(j));
            IF v_here=i OR v_done(v_here)=0 THEN
              v_can_go:=FALSE;
            END IF;
          END IF;
        END LOOP;
        IF v_can_go THEN
          v_choice:=i;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    IF v_choice=0 THEN
      RAISE_APPLICATION_ERROR(-20707,
        'FK dependency cycle/self-reference. NEED DBA REVIEW. No rows deleted.');
    END IF;
    v_ordered:=v_ordered+1;
    v_order(v_ordered):=v_choice;
    v_done(v_choice):=1;
    DBMS_OUTPUT.PUT_LINE(LPAD(v_ordered,2,'0')||'  '||
      v_table(v_choice)||'  ['||v_count(v_choice)||' rows]');
  END LOOP;

  IF g_mode='PREVIEW' THEN
    DBMS_OUTPUT.PUT_LINE(CHR(10)||'*** PREVIEW ONLY: NO DELETE EXECUTED ***');
    IF g_reset_nmc_alerts='YES' THEN
      DBMS_OUTPUT.PUT_LINE('PLANNED BEFORE ALERT DELETE: detach '||v_case_fk_refs||
        ' case FK(s), clear only alertIds in '||v_case_link_rows||' protected case(s).');
      DBMS_OUTPUT.PUT_LINE('Original NMC_CASE and NMC_CASE_AUDIT records retained.');
    END IF;
    IF v_bad_fk>0 OR v_delete_triggers>0 OR v_case_update_triggers>0 THEN
      DBMS_OUTPUT.PUT_LINE('Review safety warnings ABOVE before attempting APPLY.');
    END IF;
    DBMS_OUTPUT.PUT_LINE('Preserved: vessel/master/PSC/ERP/source/risk/template/policy.');
    DBMS_OUTPUT.PUT_LINE('Preserved: NMC_CASE / NMC_CASE_AUDIT and historic case-linked referrals.');
    DBMS_OUTPUT.PUT_LINE('SQL does not clear process JSON files from Docker /data.');
  ELSE
    IF v_unknown_actions<>0 THEN
      RAISE_APPLICATION_ERROR(-20712,
        'APPLY BLOCKED: unclassified new operational tables exist.');
    END IF;
    IF v_bad_fk<>0 THEN
      RAISE_APPLICATION_ERROR(-20708,
        'APPLY BLOCKED: external FK dependents could be damaged.');
    END IF;
    IF v_delete_triggers<>0 THEN
      RAISE_APPLICATION_ERROR(-20709,
        'APPLY BLOCKED: enabled DELETE triggers require manual review.');
    END IF;
    IF v_case_update_triggers<>0 THEN
      RAISE_APPLICATION_ERROR(-20721,
        'APPLY BLOCKED: enabled NMC_CASE UPDATE triggers require review.');
    END IF;
    -- Enforce stopped services with an explicit operator assertion above.
    -- Lock protected NMC_CASE as well as all action tables to prevent new
    -- backlinks while the obsolete alert documents are being removed.
    IF g_reset_nmc_alerts='YES' THEN
      LOCK TABLE NMC_CASE IN EXCLUSIVE MODE NOWAIT;
      IF g_clear_case_alert_links<>'YES' THEN
        RAISE_APPLICATION_ERROR(-20716,'Missing case alert detach confirmation.');
      END IF;
    END IF;
    -- Acquire action table locks; no schema DDL or autonomous transactions.
    FOR i IN 1..v_ordered LOOP
      v_here:=v_order(i);
      EXECUTE IMMEDIATE 'LOCK TABLE '||v_table(v_here)||
        ' IN EXCLUSIVE MODE NOWAIT';
    END LOOP;
    -- Counts MUST NOT change between preflight and the transaction.
    FOR i IN 1..v_ordered LOOP
      v_here:=v_order(i);
      IF rows_for(v_here)<>v_count(v_here) THEN
        RAISE_APPLICATION_ERROR(-20710,
          'Source/action data changed during reset: '||v_table(v_here));
      END IF;
    END LOOP;
    -- Detach exactly those operational case links whose alert history is
    -- being reset. Case source-risk context/referrals and case audit survive.
    IF g_reset_nmc_alerts='YES' THEN
      SELECT COUNT(*) INTO v_case_json_count FROM NMC_CASE
        WHERE SOURCE_ALERT_ID IS NOT NULL OR JSON_EXISTS(DOC_JSON, '$.alertIds[0]');
      IF v_case_json_count<>v_case_link_rows THEN
        RAISE_APPLICATION_ERROR(-20717,'NMC_CASE alert link count changed.');
      END IF;
      FOR r IN (SELECT CASE_ID,DOC_JSON FROM NMC_CASE
          WHERE SOURCE_ALERT_ID IS NOT NULL OR
                JSON_EXISTS(DOC_JSON,'$.alertIds[0]')
          FOR UPDATE) LOOP
        -- Safe targeted JSON mutation: all other case fields are preserved.
        v_case_obj:=JSON_OBJECT_T.parse(r.DOC_JSON);
        v_case_obj.put('alertIds',JSON_ARRAY_T());
        v_case_new_clob:=v_case_obj.to_clob();
        UPDATE NMC_CASE SET SOURCE_ALERT_ID=NULL,
               DOC_JSON=v_case_new_clob
          WHERE CASE_ID=r.CASE_ID;
        IF SQL%ROWCOUNT<>1 THEN
          RAISE_APPLICATION_ERROR(-20718,'NMC_CASE alert link change mismatch.');
        END IF;
        v_case_processed:=v_case_processed+1;
      END LOOP;
      IF v_case_processed<>v_case_link_rows THEN
        RAISE_APPLICATION_ERROR(-20719,'Case detach count mismatch.');
      END IF;
      SELECT COUNT(*) INTO v_here FROM NMC_CASE
        WHERE SOURCE_ALERT_ID IS NOT NULL OR JSON_EXISTS(DOC_JSON,'$.alertIds[0]');
      IF v_here<>0 THEN
        RAISE_APPLICATION_ERROR(-20720,'NMC_CASE still references alerts.');
      END IF;
      DBMS_OUTPUT.PUT_LINE('DETACHED obsolete alert refs from '||
        v_case_processed||' case records; NO cases or referrals deleted.');
    END IF;
    FOR i IN 1..v_ordered LOOP
      v_here:=v_order(i);
      IF v_count(v_here)>0 THEN
        EXECUTE IMMEDIATE 'DELETE FROM '||v_table(v_here)||
          predicate_for(v_here);
        v_deleted:=SQL%ROWCOUNT;
        IF v_deleted<>v_count(v_here) THEN
          RAISE_APPLICATION_ERROR(-20711,
            'Unexpected deletion count in '||v_table(v_here));
        END IF;
        DBMS_OUTPUT.PUT_LINE('DELETED '||RPAD(v_table(v_here),38)||
          TO_CHAR(v_deleted));
      END IF;
    END LOOP;
    -- Integrity check BEFORE COMMIT (same transaction) -- no silent partial
    -- reset. Case rows and feeding data were never DELETE targets.
    FOR i IN 1..v_ordered LOOP
      v_here:=v_order(i);
      IF rows_for(v_here)<>0 THEN
        RAISE_APPLICATION_ERROR(-20715,
          'POST-DELETE CHECK FAILED in '||v_table(v_here));
      END IF;
    END LOOP;
    SELECT COUNT(*) INTO v_here FROM NMC_CASE;
    IF v_here<>v_preserved_cases THEN
      RAISE_APPLICATION_ERROR(-20722,'PROTECTED NMC_CASE count changed');
    END IF;
    SELECT COUNT(*) INTO v_here FROM NMC_CASE_AUDIT;
    IF v_here<>v_preserved_case_audit THEN
      RAISE_APPLICATION_ERROR(-20723,'PROTECTED NMC_CASE_AUDIT count changed');
    END IF;
    SELECT COUNT(*) INTO v_here FROM SI_CANDIDATE_EVENT;
    IF v_here<>v_preserved_sources THEN
      RAISE_APPLICATION_ERROR(-20724,'PROTECTED SI_CANDIDATE_EVENT count changed');
    END IF;
    SELECT COUNT(*) INTO v_here FROM NMC_AI_ASSESSMENT;
    IF v_here<>v_preserved_risk THEN
      RAISE_APPLICATION_ERROR(-20725,'PROTECTED RISK ASSESSMENT count changed');
    END IF;
    -- Avoid resetting identity/sequence values or deleting SI_SCHED_MUTEX.
    COMMIT;
    DBMS_OUTPUT.PUT_LINE(CHR(10)||
      '*** ORACLE RESET COMMITTED: '||v_total||' action rows deleted ***');
    DBMS_OUTPUT.PUT_LINE('NMC_CASE / NMC_CASE_AUDIT PRESERVED; operational case alert links detached.');
    DBMS_OUTPUT.PUT_LINE('Keep NMC_ALERT_SCAN_ENABLED false in runtime overrides,');
    DBMS_OUTPUT.PUT_LINE('or alert events from preserved saved risk will reappear.');
    DBMS_OUTPUT.PUT_LINE('NEXT: verify SI plans, alerts and JSON stores; existing NMC cases remain visible.');
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Read-only PREVIEW must NOT roll back the operator's unrelated TOAD work.
    IF g_mode='APPLY' THEN ROLLBACK; END IF;
    DBMS_OUTPUT.PUT_LINE('*** ABORTED: '||SQLERRM||' ***');
    RAISE;
END;
/