/**
 * Read-only readiness check for SI-S02 Oracle Migration 019.
 * No DDL, DML, AI call, credential disclosure or data migration.
 */
import oracledb from 'oracledb';
const names=['SI_SCHED_MUTEX','SI_SCHED_APPROVAL',
 'SI_SCHED_WORK_ORDER','SI_SCHED_ORDER_AUDIT'];
const indexes=['IDX_SI_SCHED_WORK_INSPECTOR','IDX_SI_SCHED_WORK_STATUS'];
const prerequisites=['SI_PLAN_ROLLING','SI_INSPECTION_CASE',
 'SI_PREPARATION_DOSSIER','SI_INSPECTION_LIFECYCLE','SI_CHK_CASE_RUN'];
let con=null;
try{
 for(const name of ['NMC_DB_CONNECT_STRING','NMC_DB_USER','NMC_DB_PASSWORD'])
  if(!process.env[name])throw Error('SI_SCHED_DB_ENV_MISSING');
 con=await oracledb.getConnection({
  user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING});
 const identity=(await con.execute(
  "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') OWNER,"+
  "SYS_CONTEXT('USERENV','CON_NAME') PDB_NAME FROM DUAL",[],{
   outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
 const all=[...names,...prerequisites],params=Object.fromEntries(
  all.map((name,i)=>['t'+i,name]));
 const rows=await con.execute('SELECT TABLE_NAME FROM USER_TABLES WHERE '+
  'TABLE_NAME IN ('+all.map((_,i)=>':t'+i).join(',')+')',params,{
   outFormat:oracledb.OUT_FORMAT_OBJECT});
 const found=new Set(rows.rows.map(r=>r.TABLE_NAME));
 const indexRows=await con.execute('SELECT INDEX_NAME FROM USER_INDEXES WHERE '+
   'INDEX_NAME IN ('+indexes.map((_,i)=>':i'+i).join(',')+')',
  Object.fromEntries(indexes.map((n,i)=>['i'+i,n])),{
  outFormat:oracledb.OUT_FORMAT_OBJECT});
 const ix=new Set(indexRows.rows.map(r=>r.INDEX_NAME));
 const missingTables=all.filter(n=>!found.has(n));
 const missingIndexes=indexes.filter(n=>!ix.has(n));
 const lock=found.has('SI_SCHED_MUTEX')?
  await con.execute('SELECT COUNT(*) N FROM SI_SCHED_MUTEX WHERE LOCK_ID=1',[],{
   outFormat:oracledb.OUT_FORMAT_OBJECT}):null;
 const missingMutex=!lock||Number(lock.rows[0].N)!==1;
 const ready=!missingTables.length&&!missingIndexes.length&&!missingMutex;
 process.stdout.write(JSON.stringify({
  status:ready?'READY':'MIGRATION_019_REQUIRED',
  owner:identity.OWNER,pdb:identity.PDB_NAME,
  missingTables,missingIndexes,missingMutex,readOnly:true},null,2)+'\n');
 if(!ready)process.exitCode=2;
}catch(e){
 const code=String(e?.message||'');
 process.stderr.write((/^SI_SCHED_[A-Z0-9_]+$/.test(code)?code:
  'SI_SCHED_ORACLE_PREFLIGHT_FAILED')+'\n');
 process.exitCode=1;
}finally{if(con)await con.close();}
