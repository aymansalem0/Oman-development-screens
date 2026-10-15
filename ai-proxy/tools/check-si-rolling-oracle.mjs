/**
 * Read-only Oracle 018 readiness gate for MOEI SI Rolling Planning.
 * No DDL, no DML, no AI calls, no credentials echoed to logs.
 * It complements (does not replace) full reconciliation --plan and DBA review.
 */
import oracledb from 'oracledb';
const tables=[
 'SI_INSPECTION_CASE',
 'SI_PLAN_ROLLING','SI_PLAN_ROLLING_VERSION','SI_PLAN_ROLLING_AUDIT',
 'SI_PLAN_ROLLING_VESSEL','SI_PLAN_ROLLING_REASON'
];
const indexes=[
 'IDX_SI_PLAN_ROLLING_STATUS','IDX_SI_PLAN_ROLLING_CASE',
 'IDX_SI_PLAN_ROLLING_AUDIT'
];
let conn;
try{
 if(!process.env.NMC_DB_CONNECT_STRING||!process.env.NMC_DB_USER||
   !process.env.NMC_DB_PASSWORD)
  throw Error('SI_ROLLING_DB_ENV_MISSING');
 conn=await oracledb.getConnection({
  user:process.env.NMC_DB_USER,
  password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING});
 const identity=(await conn.execute(`SELECT
   SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS OWNER,
   SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL`,
  [],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
 const observed=await conn.execute(`SELECT TABLE_NAME FROM USER_TABLES
   WHERE TABLE_NAME IN (${tables.map((_,i)=>':t'+i).join(',')})`,
  Object.fromEntries(tables.map((s,i)=>['t'+i,s])),
  {outFormat:oracledb.OUT_FORMAT_OBJECT});
 const got=new Set(observed.rows.map(x=>x.TABLE_NAME));
 const existingIndexes=await conn.execute(`SELECT INDEX_NAME FROM USER_INDEXES
   WHERE INDEX_NAME IN (${indexes.map((_,i)=>':i'+i).join(',')})`,
  Object.fromEntries(indexes.map((s,i)=>['i'+i,s])),
  {outFormat:oracledb.OUT_FORMAT_OBJECT});
 const ix=new Set(existingIndexes.rows.map(x=>x.INDEX_NAME));
 const missingTables=tables.filter(x=>!got.has(x));
 const missingIndexes=indexes.filter(x=>!ix.has(x));
 const status=missingTables.length||missingIndexes.length?'MIGRATION_018_REQUIRED':'READY';
 process.stdout.write(JSON.stringify({status,owner:identity.OWNER,
  pdb:identity.PDB_NAME,missingTables,missingIndexes,readOnly:true},null,2)+'\n');
 if(status!=='READY')process.exitCode=2;
}catch(e){
 const safe=String(e?.code||e?.message||'').match(/^SI_ROLLING_[A-Z0-9_]+$/)?.[0]||
  'SI_ROLLING_DB_READINESS_FAILED';
 process.stderr.write(safe+'\n');
 process.exitCode=1;
}finally{if(conn)await conn.close();}
