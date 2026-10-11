-- NMC incident sources can open Cases independently from alert acknowledgements.
-- Run only against the existing NMC POC Oracle schema, with DBA review.
-- Does not modify or create incidents, legal orders, vessels, or case history.
-- Incident cases insert SOURCE_ALERT_ID=NULL while alert-origin cases retain FK.
DECLARE
  v_nullable USER_TAB_COLUMNS.NULLABLE%TYPE;
BEGIN
  SELECT nullable INTO v_nullable
    FROM USER_TAB_COLUMNS
   WHERE TABLE_NAME='NMC_CASE' AND COLUMN_NAME='SOURCE_ALERT_ID';
  IF v_nullable='N' THEN
    EXECUTE IMMEDIATE 'ALTER TABLE NMC_CASE MODIFY (SOURCE_ALERT_ID NULL)';
  END IF;
END;
/
-- Confirm:
SELECT column_name, nullable
  FROM USER_TAB_COLUMNS
 WHERE table_name='NMC_CASE' AND column_name='SOURCE_ALERT_ID';
