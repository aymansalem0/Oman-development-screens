/**
 * MOEI Smart Inspection controlled POC ACTION reset.
 * Read-only --plan default. --apply requires maintenance window + verified
 * restorable external DB backup and writes separate per-table local snapshot.
 * NEVER touches NMC_CASE/NMC_AI/RISK, source events, published rules,
 * fleet catalogue, Airia 99, original ERP/PSC files or checklist library.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ACTION_TABLES=[
 ['SI_CHK_AI_REVIEW'],['SI_CHK_AI_PROPOSAL'],['SI_CHK_EVIDENCE'],
 ['SI_CHK_CASE_ITEM'],['SI_CHK_AUDIT',"RUN_ID IS NOT NULL"],
 ['SI_CHK_CASE_RUN'],['SI_INSPECTION_LIFECYCLE_AUDIT'],
 ['SI_INSPECTION_LIFECYCLE'],['SI_PREPARATION_AUDIT'],
 ['SI_PREPARATION_DOSSIER'],['SI_PLAN_ROLLING_REASON'],
 ['SI_PLAN_ROLLING_VESSEL'],['SI_PLAN_ROLLING_AUDIT'],
 ['SI_PLAN_ROLLING_VERSION'],['SI_PLAN_ROLLING'],
 ['SI_INSPECTION_CASE'],['SI_CANDIDATE_DECISION'],
 ['SI_PSC_SELECTION_DECISION'],['SI_AI_PRIORITY_RUN']
];
// Action-only JSON transformation. Never discard source events or published policy.
const JSON_ACTIONS=[
 ['SI_TARGETING_STORE_PATH','si-candidate-targeting.json',o=>({...o,decisions:[],cases:[]}),o=>
  Array.isArray(o.events)&&Array.isArray(o.decisions)&&Array.isArray(o.cases)&&
  Array.isArray(o.rules)&&o.rules.length>0],
 ['SI_SELECTION_STORE_PATH','si-psc-selection.json',o=>({...o,decisions:[]}),o=>
  Array.isArray(o.policies)&&o.policies.length>0&&Array.isArray(o.decisions)],
 ['SI_INSPECTION_PLAN_PATH','si-inspection-plan.json',()=>({revision:0,overrides:{},latest:null,audit:[]}),o=>
  typeof o==='object'&&!Array.isArray(o)&&Number.isInteger(o.revision)],
 ['SI_ROLLING_PLAN_PATH','si-rolling-plans.json',()=>({version:1,plans:[]}),o=>
  o.version===1&&Array.isArray(o.plans)],
 ['SI_BATCH_PLAN_PATH','si-approved-batch-plans.json',()=>({version:1,jobs:[]}),o=>
  o.version===1&&Array.isArray(o.jobs)],
 ['SI_PREPARATION_STORE_PATH','si-preparations.json',()=>({documents:{},audit:[]}),o=>
  !!o.documents&&typeof o.documents==='object'&&Array.isArray(o.audit)],
 ['SI_LIFECYCLE_STORE_PATH','si-inspection-lifecycle.json',()=>({}),o=>
  o&&typeof o==='object'&&!Array.isArray(o)],
 ['SI_CHECKLIST_CASES_PATH','si-checklist-case-answers.json',()=>({version:1,cases:{}}),o=>
  o.version===1&&o.cases&&typeof o.cases==='object'&&!Array.isArray(o.cases)],
 ['SI_SCHEDULING_STORE_PATH','si-scheduling-poc.json',o=>({
  ...o,proposals:[],confirmed:[],audit:o.audit.filter(v=>v?.event==='POLICY_PUBLISHED')
 }),o=>o.schema===1&&Array.isArray(o.policyHistory)&&
  Array.isArray(o.proposals)&&Array.isArray(o.confirmed)&&Array.isArray(o.audit)]
];
const sha=data=>createHash('sha256').update(data).digest('hex');
const args=argv=>{
 const x={mode:process.env.NMC_DB_MODE||'json',apply:false,ack:false,verified:false,
  maintenance:false,root:'/data',out:'/data/si-poc-reset-backups'};
 for(const a of argv){
  if(a==='--plan')x.apply=false;
  else if(a==='--apply')x.apply=true;
  else if(a==='--ack=RESET_SI_POC_ACTIONS')x.ack=true;
  else if(a==='--backup-confirmed=VERIFIED')x.verified=true;
  else if(a==='--maintenance-confirmed=STOPPED')x.maintenance=true;
  else if(a==='--mode=json'||a==='--mode=oracle')x.mode=a.slice(7);
  else if(a.startsWith('--root='))x.root=a.slice(7);
  else if(a.startsWith('--backup-dir='))x.out=a.slice(13);
  else throw Error('SI_RESET_UNKNOWN_ARGUMENT');
 }
 if(x.apply&&(!x.ack||!x.verified||!x.maintenance))
  throw Error('SI_RESET_EXPLICIT_ACK_BACKUP_AND_STOPPED_SERVICE_REQUIRED');
 if(x.apply&&x.root==='/data'&&process.env.SI_POC_MAINTENANCE_WINDOW!=='true')
  throw Error('SI_RESET_MAINTENANCE_ENV_REQUIRED');
 if(!['oracle','json'].includes(x.mode))throw Error('SI_RESET_MODE_INVALID');
 if(resolve(x.out)===resolve(x.root))throw Error('SI_RESET_BACKUP_PATH_INVALID');
 return x;
};
function planJson(config){
 const plans=[];
 for(const [env,name,transform,valid]of JSON_ACTIONS){
  const path=process.env[env]||join(config.root,name);
  if(!existsSync(path)){plans.push({name,path,status:'ABSENT'});continue;}
  const before=readFileSync(path,'utf8'),obj=JSON.parse(before);
  if(!valid(obj))throw Error('SI_RESET_JSON_INVALID_'+name.toUpperCase().replace(/[^A-Z0-9]/g,'_'));
  const next=transform(structuredClone(obj)),changes=JSON.stringify(obj)!==JSON.stringify(next);
  plans.push({name,path,status:changes?'RESET':'ALREADY_CLEAN',
    beforeHash:sha(before),beforeBytes:Buffer.byteLength(before),
    oldRecordKeys:Object.keys(obj),next,original:before});
 }
 return plans;
}
async function planOracle(){
 const oracledb=(await import('oracledb')).default;
 for(const k of ['NMC_DB_USER','NMC_DB_PASSWORD','NMC_DB_CONNECT_STRING'])
  if(!process.env[k])throw Error('SI_RESET_ORACLE_ENV_MISSING');
 const conn=await oracledb.getConnection({
  user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING
 });
 try{
  const ctx=(await conn.execute("SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') SCHEMA_NAME,SYS_CONTEXT('USERENV','CON_NAME') PDB_NAME FROM DUAL",[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
  if(ctx.SCHEMA_NAME!=='NMC_AI'||ctx.PDB_NAME.toUpperCase()!=='FREEPDB1')
   throw Error('SI_RESET_UNEXPECTED_SCHEMA_OR_PDB');
  const existing=new Set((await conn.execute("SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME LIKE 'SI_%'",[],
   {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows.map(x=>x.TABLE_NAME));
  if(!existing.has('SI_INSPECTION_CASE'))throw Error('SI_RESET_MIGRATION_009_REQUIRED');
  const plans=[];
  for(const [table,where]of ACTION_TABLES){
   if(!existing.has(table)){plans.push({table,status:'NOT_INSTALLED',count:0});continue;}
   const condition=where?' WHERE '+where:'';
   const count=(await conn.execute('SELECT COUNT(*) N FROM '+table+condition,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N;
   plans.push({table,where:where||null,status:'READY',count:Number(count)});
  }
  // External tables carrying FKs to SI action tables cannot be silently ignored.
  const refs=(await conn.execute(`SELECT p.TABLE_NAME PARENT_NAME,c.TABLE_NAME CHILD_NAME
     FROM USER_CONSTRAINTS c JOIN USER_CONSTRAINTS p
       ON c.R_CONSTRAINT_NAME=p.CONSTRAINT_NAME
     WHERE c.CONSTRAINT_TYPE='R' AND p.TABLE_NAME LIKE 'SI_%'`,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  const planned=new Set(ACTION_TABLES.map(x=>x[0]));
  const unsafe=refs.filter(x=>planned.has(x.PARENT_NAME)&&!planned.has(x.CHILD_NAME));
  if(unsafe.length)throw Error('SI_RESET_EXTERNAL_FOREIGN_KEY_DEPENDENTS_'+
    unsafe.map(x=>x.CHILD_NAME).join('_'));
  return {plans,context:ctx,conn,oracledb};
 }catch(e){await conn.close();throw e;}
}
const writePrivate=(file,content)=>{
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,content,{mode:0o600,flag:'wx'});
 renameSync(tmp,file);
};
export async function resetPocActions(argv=process.argv.slice(2)){
 const opts=args(argv),json=planJson(opts);
 let database=null;
 if(opts.mode==='oracle')database=await planOracle();
 const report={schema:'SI-POC-RESET-v1',createdAt:new Date().toISOString(),
  mode:opts.mode,apply:opts.apply,
  preserved:['NMC_CASE','NMC_CASE_AUDIT','NMC_AI_ASSESSMENT',
   'NMC_RISK_POLICY_PROJECTION','SI_CANDIDATE_EVENT','SI_TARGETING_RULE_VERSION',
   'SI_PSC_SELECTION_POLICY','SI_CHK_TEMPLATE','SI_CHK_REVISION',
   'all 99 Airia identities, master data and source files'],
  json:json.map(({next,original,...rest})=>rest),
  oracle:database?.plans||[]};
 if(!opts.apply){
  if(database)await database.conn.close();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report;
 }
 const folder=join(opts.out,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
 // Snapshot ALL targeted JSON stores; only after snapshot every file is modified.
 for(const row of json.filter(x=>x.original!==undefined))
  writePrivate(join(folder,'json',row.name),row.original);
 if(database){
  // ORACLE snapshot: each full row, including CLOBs, into /data backup folder,
  // before starting the deletion transaction. No external write after commit.
  const {conn,oracledb,plans}=database;
  oracledb.fetchAsString=[oracledb.CLOB];
  try{
   for(const row of plans.filter(x=>x.status==='READY'&&x.count>0)){
    if(row.count>25000)throw Error('SI_RESET_ORACLE_TABLE_EXCEEDS_POC_LIMIT');
    const columns=(await conn.execute(
      'SELECT COLUMN_NAME,DATA_TYPE FROM USER_TAB_COLUMNS WHERE TABLE_NAME=:table',
      {table:row.table},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
    const fetchInfo=Object.fromEntries(columns.filter(x=>x.DATA_TYPE==='CLOB').map(x=>[
      x.COLUMN_NAME,{type:oracledb.STRING}
    ]));
    const rows=(await conn.execute('SELECT * FROM '+row.table+
      (row.where?' WHERE '+row.where:''),
      [],{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo,maxRows:25001})).rows;
    if(rows.length!==row.count)throw Error('SI_RESET_CONCURRENT_ORACLE_CHANGE');
    writePrivate(join(folder,'oracle',row.table+'.json'),
      JSON.stringify({table:row.table,where:row.where,count:rows.length,rows},null,2));
   }
   const dbReport=plans.filter(x=>x.status==='READY'&&x.count>0);
   for(const row of dbReport){
    const current=(await conn.execute('SELECT COUNT(*) N FROM '+row.table+
      (row.where?' WHERE '+row.where:''),[],
      {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0].N;
    if(Number(current)!==row.count)throw Error('SI_RESET_ORACLE_CHANGED_DURING_BACKUP');
   }
   // Commit AFTER all preflight snapshots, with FK leaf->root ordering.
   for(const row of dbReport){
    const affected=await conn.execute('DELETE FROM '+row.table+
      (row.where?' WHERE '+row.where:''));
    if(Number(affected.rowsAffected)!==row.count)
      throw Error('SI_RESET_UNEXPECTED_DELETION_COUNT_'+row.table);
   }
   await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{await conn.close();}
 }
 // All baseline files are written only after DB state is safely snapshotted.
 for(const row of json.filter(x=>x.status==='RESET')){
  const tmp=row.path+'.si-reset-'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify(row.next,null,2),{mode:0o600,flag:'wx'});
  renameSync(tmp,row.path);
 }
 report.result='RESET_APPLIED';report.backupDirectory=folder;
 writePrivate(join(folder,'reset-report.json'),JSON.stringify(report,null,2));
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 resetPocActions().catch(e=>{
  console.error('SI_RESET_FAILED: '+String(e.message||'UNKNOWN').replace(/[^A-Z0-9_ -]/gi,''));
  process.exitCode=1;
 });
