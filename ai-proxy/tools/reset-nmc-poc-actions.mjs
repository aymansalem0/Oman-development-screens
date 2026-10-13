/**
 * NMC POC OPERATOR WORKFLOW reset (cases/referrals/decisions/alerts).
 * Separately run SI reset FIRST. Never remove vessel identities, official risk
 * assessments, source events, master data, published policies or checklists.
 * Google Sheets incident review records require a different explicit reset.
 * --plan default. --apply is destructive; external DB recovery MUST be verified.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const TABLES=[
  'NMC_CASE_AUDIT','NMC_CASE','NMC_ALERT_AUDIT','NMC_ALERT'
];
const STORES=[
 ['NMC_CASE_STORE_PATH','nmc-case-workspace.json'],
 ['NMC_ALERT_STORE_PATH','nmc-alert-workspace.json']
];
const hash=s=>createHash('sha256').update(s).digest('hex');
const atomic=(path,body)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.'+randomUUID()+'.reset.tmp';
 writeFileSync(temp,body,{mode:0o600,flag:'wx'});
 renameSync(temp,path);
};
const privateFile=(path,body)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,body,{mode:0o600,flag:'wx'});
};
function flags(argv){
 const opts={mode:process.env.NMC_DB_MODE||'json',apply:false,confirmed:false,
  backupConfirmed:false,maintenance:false,siConfirmed:false,
  root:'/data',backupDir:'/data/nmc-poc-reset-backups'};
 for(const a of argv){
  if(a==='--plan')opts.apply=false;
  else if(a==='--apply')opts.apply=true;
  else if(a==='--mode=oracle'||a==='--mode=json')opts.mode=a.slice(7);
  else if(a==='--ack=RESET_NMC_POC_ACTIONS')opts.confirmed=true;
  else if(a==='--backup-confirmed=VERIFIED')opts.backupConfirmed=true;
  else if(a==='--maintenance-confirmed=STOPPED')opts.maintenance=true;
  else if(a==='--si-reset-confirmed=YES')opts.siConfirmed=true;
  else if(a.startsWith('--root='))opts.root=a.slice(7);
  else if(a.startsWith('--backup-dir='))opts.backupDir=a.slice(13);
  else throw Error('NMC_RESET_UNKNOWN_ARGUMENT');
 }
 if(!['oracle','json'].includes(opts.mode))throw Error('NMC_RESET_MODE_INVALID');
 if(opts.apply&&(!opts.confirmed||!opts.backupConfirmed||
  !opts.maintenance||!opts.siConfirmed))
  throw Error('NMC_RESET_BACKUP_MAINTENANCE_AND_SI_PREREQUISITES_REQUIRED');
 if(opts.apply&&opts.root==='/data'&&process.env.SI_POC_MAINTENANCE_WINDOW!=='true')
  throw Error('NMC_RESET_MAINTENANCE_ENV_REQUIRED');
 if(resolve(opts.backupDir)===resolve(opts.root))
  throw Error('NMC_RESET_BACKUP_DIRECTORY_INVALID');
 return opts;
}
function planJson(opts){
 const rows=[];
 for(const [env,filename]of STORES){
  const path=process.env[env]||join(opts.root,filename);
  if(!existsSync(path)){rows.push({filename,path,status:'ABSENT'});continue;}
  const before=readFileSync(path,'utf8');
  const parsed=JSON.parse(before);
  if(parsed?.schema!==1||!parsed.cases&&!parsed.alerts||
    !parsed.history||typeof parsed.history!=='object'||
    (filename.startsWith('nmc-case')&&(!parsed.cases||typeof parsed.cases!=='object'))||
    (filename.startsWith('nmc-alert')&&(!parsed.alerts||typeof parsed.alerts!=='object')))
   throw Error('NMC_RESET_STORE_SHAPE_INVALID_'+filename);
  const key=filename.startsWith('nmc-case')?'cases':'alerts';
  const next={schema:1,[key]:{},history:{}};
  rows.push({filename,path,status:JSON.stringify(parsed)===JSON.stringify(next)?
   'ALREADY_CLEAN':'RESET',before,after:JSON.stringify(next,null,2),
   recordCount:Object.keys(parsed[key]).length,
   historyCount:Object.values(parsed.history).reduce((n,v)=>n+
    (Array.isArray(v)?v.length:0),0),beforeHash:hash(before)});
 }
 return rows;
}
async function planOracle(){
 const oracledb=(await import('oracledb')).default;
 if(['NMC_DB_USER','NMC_DB_PASSWORD','NMC_DB_CONNECT_STRING'].some(
    v=>!process.env[v]))throw Error('NMC_RESET_ORACLE_CREDENTIALS_MISSING');
 const conn=await oracledb.getConnection({
  user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING
 });
 try{
  const ctx=(await conn.execute(`SELECT
    SYS_CONTEXT('USERENV','CURRENT_SCHEMA') SCHEMA_NAME,
    SYS_CONTEXT('USERENV','CON_NAME') PDB_NAME FROM DUAL`,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
  if(ctx.SCHEMA_NAME!=='NMC_AI'||ctx.PDB_NAME?.toUpperCase()!=='FREEPDB1')
   throw Error('NMC_RESET_UNEXPECTED_ORACLE_OWNER');
  const names=new Set((await conn.execute(
   "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'NMC_%'",[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows.map(x=>x.TABLE_NAME));
  if(TABLES.some(t=>!names.has(t)))throw Error('NMC_RESET_REQUIRED_WORKFLOW_TABLE_MISSING');
  // Unexpected non-workflow dependencies make deletion unsafe.
  const refs=(await conn.execute(`SELECT p.TABLE_NAME PARENT_NAME,c.TABLE_NAME CHILD_NAME
    FROM USER_CONSTRAINTS c JOIN USER_CONSTRAINTS p
      ON c.R_CONSTRAINT_NAME=p.CONSTRAINT_NAME
    WHERE c.CONSTRAINT_TYPE='R'`,[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  const selected=new Set(TABLES);
  const unsafe=refs.filter(x=>selected.has(x.PARENT_NAME)&&!selected.has(x.CHILD_NAME));
  if(unsafe.length)throw Error('NMC_RESET_UNKNOWN_FK_DEPENDENCIES_'+
    unsafe.map(x=>x.CHILD_NAME).join('_'));
  const records=[];
  for(const table of TABLES){
   const n=(await conn.execute('SELECT COUNT(*) N FROM '+table,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N;
   records.push({table,rows:Number(n)});
  }
  return {conn,oracledb,ctx,records};
 }catch(e){await conn.close();throw e;}
}
export async function resetNmcActions(argv=process.argv.slice(2)){
 const opts=flags(argv),json=planJson(opts);
 let db;
 if(opts.mode==='oracle')db=await planOracle();
 const report={schema:'NMC-POC-ACTIONS-RESET-1.0',mode:opts.mode,
  dryRun:!opts.apply,createdAt:new Date().toISOString(),
  scope:'NMC_CASES_REFERRALS_DECISIONS_AND_WORKFLOW_ALERTS_ONLY',
  preserved:[
   'NMC_VESSEL','NMC_VESSEL_CURRENT_STATE','NMC_AI_ASSESSMENT',
   'NMC_AI_RISK_FACTOR','NMC_AI_JOB','NMC_GUIDANCE_POLICY',
   'NMC_RISK_POLICY_VERSION','NMC_DASHBOARD','NMC_VESSEL_DOCUMENT',
   'NMC incident source Incident_Registry and remote AI_Assessments (separate operation)',
   'SI source events and published checklists','Airia 99 identity cohort'
  ],
  json:json.map(({before,after,...row})=>row),
  oracle:db?.records||[]};
 if(!opts.apply){
  if(db)await db.conn.close();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report;
 }
 const output=join(opts.backupDir,new Date().toISOString().replace(/[:.]/g,'-')+
  '-'+randomUUID().slice(0,8));
 try{
  // All original JSON payloads backed up regardless of mode, even if unchanged.
  for(const row of json.filter(x=>x.before!==undefined))
   privateFile(join(output,'json',row.filename),row.before);
  if(db){
   const {conn,oracledb,records}=db;
   try{
    for(const row of records.filter(x=>x.rows>0)){
     if(row.rows>20000)throw Error('NMC_RESET_UNEXPECTED_RECORD_COUNT');
     const cols=(await conn.execute('SELECT COLUMN_NAME,DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME=:t',
       {t:row.table},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
     const fetchInfo=Object.fromEntries(cols.filter(x=>x.DATA_TYPE==='CLOB')
      .map(x=>[x.COLUMN_NAME,{type:oracledb.STRING}]));
     const snap=(await conn.execute('SELECT * FROM '+row.table,[],
      {outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo,maxRows:20001})).rows;
     if(snap.length!==row.rows)throw Error('NMC_RESET_CONCURRENT_CHANGES');
     privateFile(join(output,'oracle',row.table+'.json'),
      JSON.stringify({table:row.table,rowCount:row.rows,rows:snap},null,2));
    }
    for(const row of records){
     const count=(await conn.execute('SELECT COUNT(*) N FROM '+row.table,[],
      {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N;
     if(Number(count)!==row.rows)throw Error('NMC_RESET_CONCURRENT_CHANGES');
    }
    for(const row of records.filter(x=>x.rows>0)){
     const operation=await conn.execute('DELETE FROM '+row.table);
     if(operation.rowsAffected!==row.rows)
      throw Error('NMC_RESET_UNEXPECTED_DELETION_COUNT');
    }
    await conn.commit();
   }catch(e){await conn.rollback();throw e;}
  }
  for(const row of json.filter(x=>x.status==='RESET'))atomic(row.path,row.after);
  report.result='APPLIED';
  report.backupDirectory=output;
  privateFile(join(output,'reset-report.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report;
 }finally{if(db)await db.conn.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 resetNmcActions().catch(e=>{
  console.error('NMC_RESET_FAILED '+String(e.message||'UNKNOWN').replace(/[^A-Z0-9_ -]/gi,''));
  process.exitCode=1;
 });
}
