/**
 * Explicit one-time JSON -> Oracle migration. No automatic write at startup.
 * --plan (default): read-only, checks source files against Oracle primary keys.
 * --apply --backup-confirmed=VERIFIED: insert-only, preserves /data files,
 * verified published immutable revisions, pinned case snapshots, AI/HITL audit.
 */
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import oracledb from 'oracledb';
import {OracleSiChecklistLibrary,OracleSiChecklistField} from '../si-checklist-oracle.mjs';

const load=(file,key)=> {
 if(!existsSync(file))return [];
 const obj=JSON.parse(readFileSync(file,'utf8'));
 if(obj?.version!==1)throw new Error('SI_LEGACY_STORE_SCHEMA_INVALID');
 if(key==='templates'){
  if(!Array.isArray(obj.templates))throw new Error('SI_LEGACY_TEMPLATE_LIST_INVALID');
  return obj.templates;
 }
 if(!obj.cases||typeof obj.cases!=='object'||Array.isArray(obj.cases))
  throw new Error('SI_LEGACY_CASES_INVALID');
 return Object.values(obj.cases);
};
const getFlags=args=>{
 const o={apply:false,verified:false,
  library:process.env.SI_CHECKLIST_LIBRARY_PATH||'/data/si-checklist-library.json',
  cases:process.env.SI_CHECKLIST_CASES_PATH||'/data/si-checklist-case-answers.json',
  report:'/data/si-checklist-oracle-import-plan.json'};
 for(const a of args){
  if(a==='--plan')o.apply=false;
  else if(a==='--apply')o.apply=true;
  else if(a==='--backup-confirmed=VERIFIED')o.verified=true;
  else if(a.startsWith('--library='))o.library=a.slice(10);
  else if(a.startsWith('--cases='))o.cases=a.slice(8);
  else if(a.startsWith('--report='))o.report=a.slice(9);
  else throw new Error('SI_CHECKLIST_IMPORT_INVALID_ARGUMENT');
 }
 if(o.apply&&!o.verified)throw new Error('SI_CHECKLIST_IMPORT_BACKUP_VERIFICATION_REQUIRED');
 return o;
};
const inspect=async(con,templates,cases)=>{
 const existingTemplateRows=(await con.execute('SELECT TEMPLATE_ID,DRAFT_JSON FROM SI_CHK_TEMPLATE',
  [],{outFormat:oracledb.OUT_FORMAT_OBJECT,
   fetchInfo:{DRAFT_JSON:{type:oracledb.STRING}}})).rows;
 const existingCaseRows=(await con.execute('SELECT CASE_ID,SNAPSHOT_JSON FROM SI_CHK_CASE_RUN',
  [],{outFormat:oracledb.OUT_FORMAT_OBJECT,
   fetchInfo:{SNAPSHOT_JSON:{type:oracledb.STRING}}})).rows;
 const existingTemplates=new Map(existingTemplateRows.map(x=>[x.TEMPLATE_ID,JSON.parse(x.DRAFT_JSON)]));
 const existingCases=new Map(existingCaseRows.map(x=>[x.CASE_ID,JSON.parse(x.SNAPSHOT_JSON)]));
 const compare=(items,known,key)=>items.map(x=>{
  if(!x?.[key]||typeof x[key]!=='string'||!(/^[a-f0-9-]{36}$/i).test(x[key]))
   throw new Error('SI_CHECKLIST_IMPORT_ID_INVALID');
  const old=known.get(x[key]);
  return {id:x[key],action:old===undefined?'INSERT':
    JSON.stringify(old)===JSON.stringify(x)?'ALREADY_PRESENT':'CONFLICT'};
 });
 const t=compare(templates,existingTemplates,'id'),c=compare(cases,existingCases,'caseId');
 const caseRecords=(await con.execute('SELECT CASE_ID FROM SI_INSPECTION_CASE',
  [],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 const approved=new Set(caseRecords.map(x=>x.CASE_ID));
 const missingCases=c.filter(x=>!approved.has(x.id)).map(x=>x.id);
 return {templates:t,cases:c,missingApprovedCases:missingCases,
  conflicts:[...t,...c].filter(x=>x.action==='CONFLICT')};
};
export async function migrate(args=process.argv.slice(2)){
 const opts=getFlags(args),templates=load(opts.library,'templates'),
  cases=load(opts.cases,'cases');
 if(!process.env.NMC_DB_USER||!process.env.NMC_DB_PASSWORD||
  !process.env.NMC_DB_CONNECT_STRING)throw new Error('SI_CHECKLIST_ORACLE_CREDENTIALS_MISSING');
 const pool=await oracledb.createPool({
  user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
  connectString:process.env.NMC_DB_CONNECT_STRING,
  poolMin:1,poolMax:2,poolIncrement:1});
 const oracle={pool};
 const library=new OracleSiChecklistLibrary({oracle,jsonFile:'/app/.migration-only-no-library.json'});
 const field=new OracleSiChecklistField({
  oracle,library,targeting:{inspectionCase:async()=>null,bundles:[]},
  file:'/app/.migration-only-no-case-state.json'});
 let report;
 try{
  await library.initialize();await field.initialize();
  const con=await pool.getConnection();
  try{report=await inspect(con,templates,cases);}finally{await con.close();}
  report={timestamp:new Date().toISOString(),mode:opts.apply?'APPLY':'PLAN',
   sourceFiles:{library:opts.library,cases:opts.cases},
   ...report,actions:[]};
  if(opts.apply){
   if(report.conflicts.length||report.missingApprovedCases.length)
    throw new Error('SI_CHECKLIST_IMPORT_CONFLICT_OR_MISSING_APPROVED_CASE');
   for(const t of templates)report.actions.push(await library.importTemplate(t));
   for(const c of cases)report.actions.push(await field.importCase(c));
   report.status='APPLIED';
  }else report.status=report.conflicts.length||report.missingApprovedCases.length?
   'BLOCKED_REVIEW_REQUIRED':'READY_FOR_OPTIONAL_IMPORT';
  const output=resolve(opts.report);
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report;
 }finally{await pool.close(0);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 migrate().catch(e=>{
  const msg=String(e.message||'SI_CHECKLIST_ORACLE_IMPORT_FAILED');
  process.stderr.write('[SI-CHECKLIST] '+(/^[A-Z0-9_]{6,100}$/.test(msg)?
   msg:'SI_CHECKLIST_ORACLE_IMPORT_FAILED')+'\n');
  process.exitCode=1;
 });
}
