/**
 * SMART INSPECTION POC — PLANS-ONLY RESET.
 *
 * Deliberately does NOT touch SI_CANDIDATE_EVENT, SI_INSPECTION_CASE,
 * source import data, NMC_CASE, A01/A02 risk, PSC quota/selection,
 * mandatory checklist templates, field inspections, or MSW files.
 * Run only on synthetic isolated POC with a verified restorable backup.
 *
 * --plan: read only. --apply: explicit backup + maintenance + confirmation.
 * Approved plans require an extra --include-approved=YES.
 */
import oracledb from 'oracledb';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROLLING_TABLES=[
 'SI_PLAN_ROLLING_REASON','SI_PLAN_ROLLING_VESSEL',
 'SI_PLAN_ROLLING_AUDIT','SI_PLAN_ROLLING_VERSION','SI_PLAN_ROLLING'
];
const FILES=[
 {env:'SI_ROLLING_PLAN_PATH',name:'si-rolling-plans.json',
  clean:{version:1,plans:[]},
  parse:obj=>obj?.version===1&&Array.isArray(obj?.plans),
  approved:obj=>obj.plans.filter(p=>['APPROVED','IN_EXECUTION','COMPLETED'].includes(p.status)).length},
 {env:'SI_INSPECTION_PLAN_PATH',name:'si-inspection-plan.json',
  clean:{revision:0,overrides:{},latest:null,audit:[]},
  parse:obj=>Number.isInteger(obj?.revision)&&obj?.overrides&&
   typeof obj.overrides==='object'&&Array.isArray(obj?.audit),
  approved:()=>0},
 {env:'SI_BATCH_PLAN_PATH',name:'si-approved-batch-plans.json',
  clean:{version:1,jobs:[]},
  parse:obj=>obj?.version===1&&Array.isArray(obj?.jobs),
  approved:obj=>obj.jobs.length}
];
const sha=s=>createHash('sha256').update(s).digest('hex');
function options(argv){
 const o={mode:process.env.NMC_DB_MODE||'json',apply:false,ack:false,
  backup:false,maintenance:false,includeApproved:false,
  root:'/data',backupDir:'/data/si-plans-reset-backups'};
 for(const arg of argv){
  if(arg==='--plan')o.apply=false;
  else if(arg==='--apply')o.apply=true;
  else if(arg==='--mode=oracle'||arg==='--mode=json')o.mode=arg.slice(7);
  else if(arg==='--ack=RESET_INSPECTION_PLANS_ONLY')o.ack=true;
  else if(arg==='--backup-confirmed=VERIFIED')o.backup=true;
  else if(arg==='--maintenance-confirmed=STOPPED')o.maintenance=true;
  else if(arg==='--include-approved=YES')o.includeApproved=true;
  else if(arg.startsWith('--root='))o.root=arg.slice(7);
  else if(arg.startsWith('--backup-dir='))o.backupDir=arg.slice(13);
  else throw Error('SI_PLANS_RESET_UNKNOWN_ARGUMENT');
 }
 if(!['oracle','json'].includes(o.mode))throw Error('SI_PLANS_RESET_MODE_INVALID');
 if(o.apply&&(!o.ack||!o.backup||!o.maintenance))
  throw Error('SI_PLANS_RESET_CONFIRM_STOP_AND_BACKUP_REQUIRED');
 if(o.apply&&o.root==='/data'&&process.env.SI_POC_MAINTENANCE_WINDOW!=='true')
  throw Error('SI_PLANS_RESET_MAINTENANCE_ENV_REQUIRED');
 if(resolve(o.root)===resolve(o.backupDir))throw Error('SI_PLANS_RESET_BACKUP_LOCATION_INVALID');
 return o;
}
function planFiles(opts){
 return FILES.map(spec=>{
  const path=process.env[spec.env]||join(opts.root,spec.name);
  if(!existsSync(path))return {name:spec.name,path,status:'ABSENT',approved:0};
  const before=readFileSync(path,'utf8'),content=JSON.parse(before);
  if(!spec.parse(content))throw Error('SI_PLANS_RESET_UNEXPECTED_FILE_FORMAT_'+spec.name);
  const reset=JSON.stringify(content)!==JSON.stringify(spec.clean);
  return {name:spec.name,path,status:reset?'RESET':'ALREADY_EMPTY',
   before,approved:spec.approved(content),hash:sha(before),
   after:JSON.stringify(spec.clean,null,2),
   total:spec.name==='si-rolling-plans.json'?content.plans.length:
    spec.name==='si-approved-batch-plans.json'?content.jobs.length:content.revision};
 });
}
async function planDatabase(){
 if(['NMC_DB_USER','NMC_DB_PASSWORD','NMC_DB_CONNECT_STRING'].some(
  k=>!process.env[k]))throw Error('SI_PLANS_RESET_ORACLE_CONNECTION_REQUIRED');
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
   throw Error('SI_PLANS_RESET_WRONG_SCHEMA_OR_PDB');
  const exists=new Set((await conn.execute(
   `SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
    ('SI_PLAN_ROLLING','SI_PLAN_ROLLING_VERSION','SI_PLAN_ROLLING_AUDIT',
     'SI_PLAN_ROLLING_VESSEL','SI_PLAN_ROLLING_REASON','SI_INSPECTION_CASE')`,[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows.map(x=>x.TABLE_NAME));
  if(ROLLING_TABLES.some(t=>!exists.has(t)))
   throw Error('SI_PLANS_RESET_MIGRATION_018_REQUIRED');
  // Abort when unknown future schema has FK references into the plan tables.
  const refs=(await conn.execute(`SELECT parent.TABLE_NAME PARENT_TABLE,
   child.TABLE_NAME CHILD_TABLE
   FROM USER_CONSTRAINTS child JOIN USER_CONSTRAINTS parent
    ON child.R_CONSTRAINT_NAME=parent.CONSTRAINT_NAME
   WHERE child.CONSTRAINT_TYPE='R'`,[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  const allowed=new Set(ROLLING_TABLES);
  const foreign=refs.filter(r=>allowed.has(r.PARENT_TABLE)&&!allowed.has(r.CHILD_TABLE));
  if(foreign.length)throw Error('SI_PLANS_RESET_UNEXPECTED_CHILD_TABLE_'+
   foreign.map(x=>x.CHILD_TABLE).join('_'));
  const tables=[];
  for(const table of ROLLING_TABLES){
   const row=(await conn.execute('SELECT COUNT(*) N FROM '+table,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
   const count=Number(row.N);
   if(count>20000)throw Error('SI_PLANS_RESET_NOT_A_SMALL_POC_'+table);
   tables.push({table,count});
  }
  const statuses=(await conn.execute(`SELECT STATUS,COUNT(*) N FROM SI_PLAN_ROLLING
   GROUP BY STATUS`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  const inspectionCases=exists.has('SI_INSPECTION_CASE')?
   Number((await conn.execute('SELECT COUNT(*) N FROM SI_INSPECTION_CASE',[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N):0;
  const approved=statuses.filter(x=>['APPROVED','IN_EXECUTION','COMPLETED'].includes(x.STATUS))
    .reduce((n,x)=>n+Number(x.N),0);
  return {conn,tables,approved,inspectionCases,
   statuses:statuses.map(x=>({status:x.STATUS,count:Number(x.N)}))};
 }catch(e){await conn.close();throw e;}
}
const savePrivate=(path,value)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,value,{mode:0o600,flag:'wx'});
};
const replaceAtomic=(path,value)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.reset-'+randomUUID()+'.tmp';
 writeFileSync(temp,value,{mode:0o600,flag:'wx'});
 renameSync(temp,path);
};
export async function resetSiPlans(argv=process.argv.slice(2)){
 const opts=options(argv),files=planFiles(opts);
 const db=opts.mode==='oracle'?await planDatabase():null;
 const report={
  action:'SI_PLANS_ONLY_RESET',mode:opts.mode,dryRun:!opts.apply,
  summary:'Clears rolling/standalone plans and bulk-plan jobs, NOT vessel source events or inspection cases',
  createdAt:new Date().toISOString(),
  json:files.map(({before,after,...row})=>row),
  oracle:db?.tables||[],
  oracleStatuses:db?.statuses||[],
  savedInspectionCases:db?.inspectionCases??null,
  warning:'Existing approved SI cases and checklist executions are PRESERVED. '+
   'They may prevent starting an entirely new case for the same candidate. '+
   'Use the separately guarded full SI action reset only when all SI actions must be cleared.',
  preserved:['NMC_CASE','NMC_AI_ASSESSMENT','SI_INSPECTION_CASE','SI_CANDIDATE_EVENT',
   'SI_CANDIDATE_DECISION','SI_PSC_SELECTION_POLICY','SI_PSC_SELECTION_DECISION',
   'SI_CHK_TEMPLATE','SI_CHK_REVISION','all Airia 99 vessel identities',
   'all MSW source imports','historical saved risk','checklist answers']
 };
 const approvals=files.reduce((n,x)=>n+(x.approved||0),0)+(db?.approved||0);
 try{
  if(!opts.apply){
   process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
  }
  if(approvals&&!opts.includeApproved)
   throw Error('SI_PLANS_RESET_APPROVED_PLANS_REQUIRE_EXTRA_CONFIRMATION');
  const backupDir=join(opts.backupDir,
   new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
  for(const row of files.filter(f=>f.before!==undefined))
   savePrivate(join(backupDir,'json',row.name),row.before);
  if(db){
   const {conn}=db;
   try{
    for(const {table,count}of db.tables.filter(x=>x.count>0)){
     const cols=(await conn.execute(`SELECT COLUMN_NAME,DATA_TYPE
       FROM USER_TAB_COLUMNS WHERE TABLE_NAME=:t`,{t:table},
       {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
     const fetchInfo=Object.fromEntries(cols.filter(x=>x.DATA_TYPE==='CLOB')
      .map(x=>[x.COLUMN_NAME,{type:oracledb.STRING}]));
     const rows=(await conn.execute('SELECT * FROM '+table,[],
      {outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo,maxRows:20001})).rows;
     if(rows.length!==count)throw Error('SI_PLANS_RESET_CONCURRENT_CHANGE');
     savePrivate(join(backupDir,'oracle',table+'.json'),
      JSON.stringify({table,rows,count},null,2));
    }
    // Validate counts again just before a SINGLE Oracle transaction.
    for(const {table,count}of db.tables){
     const latest=Number((await conn.execute('SELECT COUNT(*) N FROM '+table,[],
      {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N);
     if(latest!==count)throw Error('SI_PLANS_RESET_TABLE_CHANGED_'+table);
    }
    for(const {table,count}of db.tables.filter(x=>x.count>0)){
     const out=await conn.execute('DELETE FROM '+table);
     if(out.rowsAffected!==count)
      throw Error('SI_PLANS_RESET_DELETED_UNEXPECTED_COUNT_'+table);
    }
    await conn.commit();
   }catch(e){await conn.rollback();throw e;}
  }
  for(const f of files.filter(x=>x.status==='RESET'))replaceAtomic(f.path,f.after);
  report.dryRun=false;report.status='APPLIED';report.backupDirectory=backupDir;
  savePrivate(join(backupDir,'summary.json'),JSON.stringify(report,null,2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report;
 }finally{if(db)await db.conn.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 resetSiPlans().catch(e=>{
  console.error('SI_PLANS_RESET_FAILED '+String(e.message||'UNKNOWN')
   .replace(/[^a-zA-Z0-9_ -]/g,''));
  process.exitCode=1;
 });
