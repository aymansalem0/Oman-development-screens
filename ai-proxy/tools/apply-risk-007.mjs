/**
 * EXPLICIT, ONE-TIME migration 007 runner for installations without SQL*Plus.
 * Executes only audited CREATE TABLE / CREATE INDEX DDL from migration 007.
 *
 * docker cp this file to /app/apply-risk-007.mjs in the ai-proxy container,
 * docker cp 007_nmc_risk_policy_versioning.sql to /app/nmc-risk-007.sql,
 * docker exec ... node /app/apply-risk-007.mjs --check
 * docker exec ... node /app/apply-risk-007.mjs --apply --backup-confirmed
 *
 * Never runs on application startup. Never drops/updates existing data.
 * Oracle DDL autocommits and cannot be rolled back: stop on partial objects.
 */
import oracledb from 'oracledb';
import {readFileSync} from 'node:fs';

const sqlPath='/app/nmc-risk-007.sql';
const expectedTables=['NMC_RISK_POLICY_VERSION','NMC_RISK_POLICY_ACTIVE',
  'NMC_RISK_POLICY_PROJECTION'];
const expectedIndex='IDX_NMC_RISK_PROJ_IMO';
const allowed=new Set([...expectedTables,expectedIndex]);
const args=new Set(process.argv.slice(2));
const apply=args.has('--apply');
const check=args.has('--check');
if(check===apply||[...args].some(x=>!['--check','--apply','--backup-confirmed'].includes(x))){
  console.error('USAGE: node /app/apply-risk-007.mjs --check OR --apply --backup-confirmed');
  process.exit(2);
}
if(apply&&!args.has('--backup-confirmed')){
  console.error('STOP: DBA-reviewed backup confirmation required before Oracle DDL.');
  process.exit(2);
}
if((process.env.NMC_DB_MODE||'').toLowerCase()!=='oracle'){
  console.error('STOP: NMC_DB_MODE must be oracle. Never initialize another database.');
  process.exit(2);
}
if(!process.env.NMC_DB_USER||!process.env.NMC_DB_PASSWORD||!process.env.NMC_DB_CONNECT_STRING){
  console.error('STOP: existing NMC DB credentials unavailable in ai-proxy environment.');
  process.exit(2);
}
let statements=[];
try{
  const sql=readFileSync(sqlPath,'utf8');
  statements=[...sql.matchAll(/\b(CREATE (?:TABLE|INDEX) (NMC_RISK_POLICY_[A-Z_]+|IDX_NMC_RISK_PROJ_IMO)\s+[\s\S]*?);/g)]
    .map(match=>({name:match[2],sql:match[1]}));
  if(statements.length!==4||statements.some(x=>!allowed.has(x.name))||
     new Set(statements.map(x=>x.name)).size!==4||
     !expectedTables.every(name=>statements.some(x=>x.name===name))||
     !statements.some(x=>x.name===expectedIndex))
    throw Error('Migration 007 SQL contains unexpected or missing DDL statements.');
}catch(error){
  console.error('STOP: migration file missing or invalid:',error.message);
  process.exit(2);
}
const connection=await oracledb.getConnection({
  user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING
}).catch(()=>{
  console.error('STOP: could not connect to existing Oracle using ai-proxy credentials.');
  process.exit(2);
});
try{
  const env=await connection.execute(
    "SELECT USER AS USERNAME,SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL",
    [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
  const {USERNAME,PDB_NAME}=env.rows[0];
  console.log('Connected Oracle schema:',USERNAME,'PDB:',PDB_NAME);
  if(USERNAME!=='NMC_AI'||PDB_NAME!=='FREEPDB1')
    throw Error('STOP: expected NMC_AI in FREEPDB1; no DDL executed.');
  const baseline=await connection.execute(
    "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('NMC_AI_ASSESSMENT','NMC_VESSEL_CURRENT_STATE')",
    [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
  if(baseline.rows.length!==2)
    throw Error('STOP: base maritime assessment schema is missing or not visible.');
  const objects=await connection.execute(
    "SELECT OBJECT_NAME,OBJECT_TYPE FROM USER_OBJECTS WHERE OBJECT_NAME LIKE 'NMC_RISK_POLICY%' OR OBJECT_NAME='IDX_NMC_RISK_PROJ_IMO' ORDER BY OBJECT_NAME",
    [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
  console.log('Existing risk-policy objects:',objects.rows.length?
    objects.rows.map(o=>o.OBJECT_NAME+' ('+o.OBJECT_TYPE+')').join(', '):'NONE');
  if(objects.rows.length)
    throw Error('STOP: all/partial risk-policy objects exist. Do NOT rerun migration.');
  const count=await connection.execute(
    'SELECT COUNT(*) AS N FROM NMC_AI_ASSESSMENT',[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
  console.log('Existing historical AI assessments (untouched):',count.rows[0].N);
  console.log('Migration DDL (CREATE ONLY):',statements.map(x=>x.name).join(', '));
  if(check){
    console.log('PREFLIGHT PASSED. No statements executed. Confirm verified backup before --apply.');
  }else{
    console.log('APPLYING migration 007 (non-transactional Oracle DDL):');
    for(const {name,sql} of statements){
      await connection.execute(sql);
      console.log('CREATED',name);
    }
    const verify=await connection.execute(
      "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'NMC_RISK_POLICY%' ORDER BY TABLE_NAME",
      [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
    if(verify.rows.length!==3)
      throw Error('STOP: post-migration table count incorrect; investigate before restart.');
    console.log('MIGRATION_007_COMPLETE. No existing assessments, alerts, cases or volumes touched.');
    console.log('Restart ONLY ai-proxy to initialize the central baseline policy.');
  }
}catch(error){
  console.error('MIGRATION_007_STOP:',error.code||error.message);
  process.exitCode=1;
}finally{
  await connection.close();
}
