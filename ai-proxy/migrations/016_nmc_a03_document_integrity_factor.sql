-- Additive MOEI NMC POC migration 016: A03 documentIntegrity as sixth AI risk factor.
-- Run ONCE after 015, with a verified restorable NMC_AI backup.
-- Existing A01/A02 assessments, risk versions, cases, alerts and quality are unchanged.
-- Oracle DDL auto commits; on partial failure stop, inspect constraints and DBA repair.
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER TABLE NMC_AI_RISK_FACTOR DROP CONSTRAINT CK_NMC_FACTOR_KEY;
ALTER TABLE NMC_AI_RISK_FACTOR ADD CONSTRAINT CK_NMC_FACTOR_KEY
  CHECK (FACTOR_KEY IN
    ('movement','inspection','certificate','dataQuality','history','documentIntegrity'));
-- A03 documents remain unverified mock evidence until independent issuer verification.
MERGE INTO NMC_DATA_SOURCE d
USING (SELECT 'A03_GOOGLE_DRIVE_SIM' SOURCE_ID,
  'Google Drive A03 synthetic maritime evidence packs' SOURCE_NAME,
  'EXTERNAL_SIMULATION' SOURCE_CLASS FROM DUAL) s
ON (d.SOURCE_ID=s.SOURCE_ID)
WHEN NOT MATCHED THEN INSERT
  (SOURCE_ID,SOURCE_NAME,SOURCE_CLASS,AUTHORITY_VERIFIED,SOURCE_NATURE)
VALUES (s.SOURCE_ID,s.SOURCE_NAME,s.SOURCE_CLASS,'N','SYNTHETIC_POC');
COMMIT;
SELECT CONSTRAINT_NAME,STATUS,SEARCH_CONDITION_VC
 FROM USER_CONSTRAINTS
 WHERE TABLE_NAME='NMC_AI_RISK_FACTOR' AND CONSTRAINT_NAME='CK_NMC_FACTOR_KEY';
