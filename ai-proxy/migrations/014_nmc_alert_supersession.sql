-- MOEI NMC Alerts: published-risk reclassification & inbox dismissal (Migration 014).
-- Additive semantic extension only: no saved alerts, assessments or cases are deleted.
-- Apply ONCE after verified restorable backup and migration 003; Oracle DDL auto-commits.
-- Preflight: existing CK_NMC_ALERT_STATUS and CK_NMC_ALERT_AUDIT_ACTION
-- must match the original 003 definitions. If altered/absent, STOP for DBA review.
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER TABLE NMC_ALERT DROP CONSTRAINT CK_NMC_ALERT_STATUS;
ALTER TABLE NMC_ALERT ADD CONSTRAINT CK_NMC_ALERT_STATUS CHECK (
  STATUS IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','ESCALATED','RESOLVED','SUPERSEDED')
);
ALTER TABLE NMC_ALERT_AUDIT DROP CONSTRAINT CK_NMC_ALERT_AUDIT_ACTION;
ALTER TABLE NMC_ALERT_AUDIT ADD CONSTRAINT CK_NMC_ALERT_AUDIT_ACTION CHECK (
  ACTION_NAME IN ('DETECTED','ACKNOWLEDGE','START_FOLLOW_UP',
                  'ESCALATE','RESOLVE','SUPERSEDE','DISMISS')
);
-- Existing columns STATUS VARCHAR2(20), ACTION_NAME VARCHAR2(24) already fit.
-- supersededAt, supersededByRiskLevel and dismissedAt live in existing DOC_JSON,
-- preserving immutable audit rows, historic case links and past risk values.
SELECT CONSTRAINT_NAME,STATUS,SEARCH_CONDITION_VC FROM USER_CONSTRAINTS
 WHERE CONSTRAINT_NAME IN ('CK_NMC_ALERT_STATUS','CK_NMC_ALERT_AUDIT_ACTION')
 ORDER BY CONSTRAINT_NAME;
