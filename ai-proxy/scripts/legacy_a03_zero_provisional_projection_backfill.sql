-- UAE MOEI NMC POC: A03 legacy-zero PROVISIONAL policy projection BACKFILL.
-- PURPOSE: derive a six-factor risk projection for saved SYNTHETIC assessments
-- missing A03. A03=0 means NOT ASSESSED, not zero document risk or validity.
-- Historical A01/A02 assessments, their five source factors, saved risk scores,
-- central published policy, and existing projection history are NEVER changed.
-- New results are explicitly PROVISIONAL in FACTOR_SNAPSHOT_JSON.
--
-- PREREQUISITES:
--   1. Oracle FREEPDB1, logged in as NMC_AI, after tested backup.
--   2. Migrations 007, 008, 016 already applied; active risk policy has A03 > 0%.
--   3. POC synthetic data ONLY. Do not execute for real/authoritative vessels.
--   4. Review first in dry-run. To INSERT set DEFINE APPLY=YES below,
--      then review counts, commit, and restore to NO before sharing.
--   5. No Airia calls. NO edits to NMC_AI_ASSESSMENT or NMC_AI_RISK_FACTOR.
--
-- An existing (POLICY_VERSION_NO,ASSESSMENT_ID) projection is NEVER overwritten.
-- Requires a new policy revision if legacy history already has a real projection.
SET SERVEROUTPUT ON SIZE UNLIMITED
SET DEFINE ON
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
DEFINE APPLY=NO
DECLARE
  v_apply             VARCHAR2(3):=UPPER(TRIM('&APPLY'));
  v_revision          NUMBER;
  v_config            CLOB;
  v_version_name      VARCHAR2(100);
  v_mode              VARCHAR2(30);
  v_watch             NUMBER;
  v_high              NUMBER;
  v_critical          NUMBER;
  v_wm                NUMBER;
  v_wi                NUMBER;
  v_wc                NUMBER;
  v_wq                NUMBER;
  v_wh                NUMBER;
  v_wd                NUMBER;
  v_weighted          NUMBER;
  v_maxsignal         NUMBER;
  v_raw               NUMBER;
  v_score             NUMBER;
  v_level             VARCHAR2(12);
  v_snapshot          CLOB;
  v_seen              NUMBER:=0;
  v_inserted          NUMBER:=0;
BEGIN
  IF v_apply NOT IN ('YES','NO') THEN
    RAISE_APPLICATION_ERROR(-20051,'APPLY must be YES or NO');
  END IF;
  SELECT a.VERSION_NO,v.CONFIG_JSON,v.POLICY_REF INTO
    v_revision,v_config,v_version_name
    FROM NMC_RISK_POLICY_ACTIVE a
    JOIN NMC_RISK_POLICY_VERSION v ON v.VERSION_NO=a.VERSION_NO
   WHERE a.SINGLETON_ID=1;
  SELECT JSON_VALUE(v_config,'$.mode' RETURNING VARCHAR2(30)),
         JSON_VALUE(v_config,'$.thresholds.watch' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.thresholds.high' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.thresholds.critical' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.movement' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.inspection' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.certificate' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.dataQuality' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.history' RETURNING NUMBER),
         JSON_VALUE(v_config,'$.weights.documentIntegrity' RETURNING NUMBER)
    INTO v_mode,v_watch,v_high,v_critical,v_wm,v_wi,v_wc,v_wq,v_wh,v_wd
    FROM DUAL;
  IF v_wd IS NULL OR v_wd <= 0 OR
     v_wm+v_wi+v_wc+v_wq+v_wh+v_wd <> 100 OR
     v_mode NOT IN ('weighted','conservative','max-signal') THEN
    RAISE_APPLICATION_ERROR(-20052,'Active published policy does not support valid six-factor risk');
  END IF;
  DBMS_OUTPUT.PUT_LINE('MODE='||v_apply||' | ACTIVE POLICY='||v_version_name||
                       ' | REV='||v_revision||' | A03 WEIGHT='||v_wd||'%');
  FOR a IN (
    SELECT a.ASSESSMENT_ID,a.IMO,a.CRITICAL_OPEN_FINDING,
      MAX(CASE WHEN f.FACTOR_KEY='movement' THEN f.SEVERITY END) movement,
      MAX(CASE WHEN f.FACTOR_KEY='inspection' THEN f.SEVERITY END) inspection,
      MAX(CASE WHEN f.FACTOR_KEY='certificate' THEN f.SEVERITY END) certificate,
      MAX(CASE WHEN f.FACTOR_KEY='dataQuality' THEN f.SEVERITY END) quality,
      MAX(CASE WHEN f.FACTOR_KEY='history' THEN f.SEVERITY END) history
    FROM NMC_VESSEL_CURRENT_STATE cs
    JOIN NMC_AI_ASSESSMENT a ON a.ASSESSMENT_ID=cs.ASSESSMENT_ID
    JOIN NMC_AI_RISK_FACTOR f ON f.ASSESSMENT_ID=a.ASSESSMENT_ID
    WHERE cs.STATUS='COMPLETED'
      AND a.SOURCE_NATURE='SYNTHETIC_NOT_RIYADH_MOU'
      AND NOT EXISTS (
        SELECT 1 FROM NMC_AI_RISK_FACTOR d
         WHERE d.ASSESSMENT_ID=a.ASSESSMENT_ID AND d.FACTOR_KEY='documentIntegrity'
      )
      AND NOT EXISTS (
        SELECT 1 FROM NMC_RISK_POLICY_PROJECTION pr
         WHERE pr.POLICY_VERSION_NO=v_revision AND pr.ASSESSMENT_ID=a.ASSESSMENT_ID
      )
    GROUP BY a.ASSESSMENT_ID,a.IMO,a.CRITICAL_OPEN_FINDING
    HAVING COUNT(*)=5
       AND COUNT(DISTINCT CASE WHEN f.FACTOR_KEY IN
            ('movement','inspection','certificate','dataQuality','history')
            THEN f.FACTOR_KEY END)=5
       AND MIN(f.SEVERITY)>=0 AND MAX(f.SEVERITY)<=100
  ) LOOP
    v_seen:=v_seen+1;
    v_weighted:=(a.movement*v_wm+a.inspection*v_wi+
                 a.certificate*v_wc+a.quality*v_wq+a.history*v_wh)/100;
    v_maxsignal:=GREATEST(a.movement,a.inspection,a.certificate,a.quality,a.history,0);
    v_raw:=v_weighted;
    IF v_mode='conservative' THEN
      v_raw:=v_raw+GREATEST(0,v_maxsignal-v_raw)*0.28;
    ELSIF v_mode='max-signal' THEN
      v_raw:=v_raw*0.68+v_maxsignal*0.32;
    END IF;
    v_score:=ROUND(LEAST(100,GREATEST(0,v_raw)));
    v_level:=CASE WHEN v_score>=v_critical THEN 'Critical'
                  WHEN v_score>=v_high THEN 'High'
                  WHEN v_score>=v_watch THEN 'Watch' ELSE 'Normal' END;
    -- SQL/JSON: the sixth factor explicitly records absence of actual A03 evidence.
    SELECT JSON_OBJECT(
      'calculationMode' VALUE v_mode,
      'weightedSubtotal' VALUE ROUND(v_weighted,6),
      'modeAdjustment' VALUE ROUND(v_raw-v_weighted,6),
      'clampedAndRoundedScore' VALUE v_score,
      'rulesetVersion' VALUE v_version_name,
      'provisional' VALUE 1,
      'provisionalReason' VALUE 'A03_NOT_ASSESSED_ZERO_PLACEHOLDER',
      'dataCoverage' VALUE '5_OF_6_FACTORS',
      'sourceAssessmentImmutable' VALUE 1,
      'factors' VALUE JSON_ARRAY(
        JSON_OBJECT('key' VALUE 'movement','severity' VALUE a.movement,
          'weight' VALUE v_wm,'weightedContribution' VALUE ROUND(a.movement*v_wm/100,6)),
        JSON_OBJECT('key' VALUE 'inspection','severity' VALUE a.inspection,
          'weight' VALUE v_wi,'weightedContribution' VALUE ROUND(a.inspection*v_wi/100,6)),
        JSON_OBJECT('key' VALUE 'certificate','severity' VALUE a.certificate,
          'weight' VALUE v_wc,'weightedContribution' VALUE ROUND(a.certificate*v_wc/100,6)),
        JSON_OBJECT('key' VALUE 'dataQuality','severity' VALUE a.quality,
          'weight' VALUE v_wq,'weightedContribution' VALUE ROUND(a.quality*v_wq/100,6)),
        JSON_OBJECT('key' VALUE 'history','severity' VALUE a.history,
          'weight' VALUE v_wh,'weightedContribution' VALUE ROUND(a.history*v_wh/100,6)),
        JSON_OBJECT('key' VALUE 'documentIntegrity','severity' VALUE 0,
          'weight' VALUE v_wd,'weightedContribution' VALUE 0,
          'sourceAgent' VALUE 'A03_NOT_ASSESSED_ZERO_PLACEHOLDER',
          'evidenceStatus' VALUE 'NOT_ASSESSED',
          'reason' VALUE 'POC zero is a placeholder, NOT evidence of clean documents')
        RETURNING CLOB) FORMAT JSON
      RETURNING CLOB)
      INTO v_snapshot FROM DUAL;
    DBMS_OUTPUT.PUT_LINE('IMO='||a.IMO||' | Assessment='||a.ASSESSMENT_ID||
      ' | PREVIEW='||v_score||'/100 '||v_level||' | A03=0 NOT_ASSESSED');
    IF v_apply='YES' THEN
      INSERT INTO NMC_RISK_POLICY_PROJECTION(
        POLICY_VERSION_NO,ASSESSMENT_ID,IMO,RISK_SCORE,RISK_LEVEL,
        OPERATIONAL_PRIORITY,CRITICAL_OPEN_FINDING,FACTOR_SNAPSHOT_JSON)
      VALUES(v_revision,a.ASSESSMENT_ID,a.IMO,v_score,v_level,
        'Pending A03 Evidence',a.CRITICAL_OPEN_FINDING,v_snapshot);
      v_inserted:=v_inserted+1;
    END IF;
  END LOOP;
  IF v_apply='YES' THEN
    COMMIT;
  ELSE
    ROLLBACK; -- Explicitly read-only preview.
  END IF;
  DBMS_OUTPUT.PUT_LINE('Eligible='||v_seen||' | Inserted='||v_inserted||
    ' | Original source rows updated=0 | Finished='||v_apply);
END;
/
-- Verify only PROVISIONAL A03=0 projection rows for the active version:
SELECT p.IMO,p.RISK_SCORE,p.RISK_LEVEL,p.OPERATIONAL_PRIORITY,
       JSON_VALUE(p.FACTOR_SNAPSHOT_JSON,'$.provisionalReason') AS A03_PROVENANCE
  FROM NMC_RISK_POLICY_PROJECTION p
  JOIN NMC_RISK_POLICY_ACTIVE a ON a.VERSION_NO=p.POLICY_VERSION_NO
 WHERE a.SINGLETON_ID=1
   AND JSON_VALUE(p.FACTOR_SNAPSHOT_JSON,'$.provisionalReason')=
       'A03_NOT_ASSESSED_ZERO_PLACEHOLDER'
 ORDER BY p.IMO;
