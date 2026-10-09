-- EXECUTE as SYSDBA inside the existing Oracle Free container (one time).
-- This script CREATES a NEW NMC_AI user in FREEPDB1 only; does not modify
-- existing Oracle schemas, grants or application tables.
WHENEVER SQLERROR EXIT SQL.SQLCODE
SET VERIFY OFF
ALTER SESSION SET CONTAINER=FREEPDB1;
PROMPT Verify that the current container is FREEPDB1:
SHOW CON_NAME
ACCEPT nmc_password CHAR PROMPT 'Choose a NEW strong NMC_AI database password: ' HIDE
CREATE USER NMC_AI IDENTIFIED BY "&nmc_password"
  DEFAULT TABLESPACE USERS QUOTA 512M ON USERS;
GRANT CREATE SESSION, CREATE TABLE TO NMC_AI;
UNDEFINE nmc_password
PROMPT NMC_AI created; log in as NMC_AI to run migration 01.
