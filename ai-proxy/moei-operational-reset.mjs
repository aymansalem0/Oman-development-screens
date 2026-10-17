/**
 * Only the user's audited Oracle V3 OPERATIONAL reset is allowed.
 * The HTTP process can PREVIEW and QUEUE, never APPLY while serving traffic.
 * The offline runner executes after a verified backup and stopped writers.
 */
import oracledb from 'oracledb';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {RuntimeSettings} from './runtime-settings.mjs';

const SCRIPT_URL=new URL('./tools/moei-operational-reset-v3.sql',import.meta.url);
export const REQUEST_FILE=process.env.MOEI_OPERATIONAL_RESET_REQUEST_FILE||
  '/data/moei-operational-reset-request.json';
const ACK='RESET_MOEI_OPERATIONAL_PROCESS';
const MODE_PATTERN="g_mode                  CONSTANT VARCHAR2(10) := 'PREVIEW';";
const SWITCHES=[
 ["g_backup_verified       CONSTANT VARCHAR2(3)  := 'NO';",
  "g_backup_verified       CONSTANT VARCHAR2(3)  := 'YES';"],
 ["g_services_stopped      CONSTANT VARCHAR2(3)  := 'NO';",
  "g_services_stopped      CONSTANT VARCHAR2(3)  := 'YES';"],
 ["g_alert_scanner_disabled CONSTANT VARCHAR2(3) := 'NO';",
  "g_alert_scanner_disabled CONSTANT VARCHAR2(3) := 'YES';"],
 ["g_clear_case_alert_links CONSTANT VARCHAR2(3) := 'NO';",
  "g_clear_case_alert_links CONSTANT VARCHAR2(3) := 'YES';"],
 ["g_ack CONSTANT VARCHAR2(45) := 'NOT_CONFIRMED';",
  "g_ack CONSTANT VARCHAR2(45) := '"+ACK+"';"]
];
export class OperationalResetError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const abort=(code,status)=>{throw new OperationalResetError(code,status);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeWrite=(file,body)=>{
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(body,null,2),{mode:0o600,flag:'wx'});
 renameSync(tmp,file);
};
export function sourceResetBlock(mode='PREVIEW',source=readFileSync(SCRIPT_URL,'utf8')){
 if(!['PREVIEW','APPLY'].includes(mode))abort('RESET_MODE_INVALID',422);
 if(!source.includes('OPERATIONAL PROCESS RESET V3')||
    !source.includes("g_required_schema      CONSTANT VARCHAR2(30) := 'NMC_AI';")||
    !source.includes("g_required_pdb         CONSTANT VARCHAR2(30) := 'FREEPDB1';")||
    !source.includes("add_target('SI_SCHED_WORK_ORDER');")||
    !source.includes("add_target('NMC_ALERT');")||
    !source.includes("add_target('SI_CHK_AUDIT','RUN_ID IS NOT NULL')"))
  abort('RESET_REVIEWED_SCRIPT_INVALID',503);
 function exactly(from,to){
  if(source.split(from).length!==2)abort('RESET_SCRIPT_SWITCH_MISMATCH',503);
  source=source.replace(from,to);
 }
 // Refuse to run the uploaded original APPLY defaults. The bundled file is
 // fail-closed PREVIEW; offline APPLY changes only these reviewed constants.
 if(source.split(MODE_PATTERN).length!==2)
  abort('RESET_SCRIPT_PREVIEW_DEFAULT_MISSING',503);
 if(mode==='APPLY'){
  exactly(MODE_PATTERN,MODE_PATTERN.replace("'PREVIEW'","'APPLY'"));
  for(const [from,to]of SWITCHES)exactly(from,to);
 }
 const start=source.indexOf('\nDECLARE\n');
 const end=source.lastIndexOf('\nEND;\n/');
 if(start<0||end<=start)abort('RESET_SCRIPT_BLOCK_INVALID',503);
 return source.slice(start+1,end+'\nEND;'.length);
}
export function parseResetPreview(lines){
 const counts=[];
 for(const line of lines){
  const m=/^(SI_[A-Z0-9_]+|NMC_ALERT(?:_AUDIT)?)\s+rows=([0-9]+)/.exec(line);
  if(m)counts.push({table:m[1],count:Number(m[2])});
 }
 const total=counts.reduce((sum,x)=>sum+x.count,0);
 const unsafe=lines.some(line=>/BLOCKING|REVIEW: unfamiliar process table|DELETE TRIGGER|UPDATE TRIGGER/.test(line));
 return {scope:'SI_OPERATIONAL_ACTIONS_AND_NMC_ALERTS',
  preserved:['NMC_VESSEL and all vessel master data','NMC_CASE and NMC_CASE_AUDIT',
   'SI_CANDIDATE_EVENT and source feeds','SI checklist templates/library/master',
   'NMC saved risk/A01-A03','Google users and runtime settings',
   'SDB applications (not covered by supplied Oracle V3 reset)'],
  tables:counts,totalRows:total,unsafe,alertsIncluded:true,
  includesNmcCases:false,oracleOnly:true};
}
export async function executeReviewedReset(mode='PREVIEW',{
 env=process.env,driver=oracledb,outputLimit=700
}={}){
 if(env.NMC_DB_MODE!=='oracle')abort('RESET_ORACLE_MODE_REQUIRED',409);
 if(!env.NMC_DB_CONNECT_STRING||!env.NMC_DB_USER||!env.NMC_DB_PASSWORD)
  abort('RESET_ORACLE_CONNECTION_REQUIRED',503);
 const conn=await driver.getConnection({
  user:env.NMC_DB_USER,password:env.NMC_DB_PASSWORD,
  connectString:env.NMC_DB_CONNECT_STRING
 });
 try{
  await conn.execute('BEGIN DBMS_OUTPUT.ENABLE(1000000); END;');
  await conn.execute(sourceResetBlock(mode));
  const lines=[];
  for(let i=0;i<outputLimit;i++){
   const result=await conn.execute(
    'BEGIN DBMS_OUTPUT.GET_LINE(:line,:done); END;',
    {line:{dir:driver.BIND_OUT,type:driver.STRING,maxSize:32767},
     done:{dir:driver.BIND_OUT,type:driver.NUMBER}});
   if(result.outBinds.done!==0)break;
   lines.push(String(result.outBinds.line||''));
  }
  if(!lines.some(x=>x.includes('NMC cases=PRESERVED')))
   abort('RESET_EXPECTED_REPORT_MISSING',503);
  if(mode==='APPLY'&&!lines.some(x=>x.includes('ORACLE RESET COMMITTED')))
   abort('RESET_COMMIT_REPORT_MISSING',503);
  const parsed=parseResetPreview(lines);
  return {mode,lines,...parsed,sha256:sha(lines.join('\n'))};
 }finally{await conn.close();}
}
export function currentResetRequest(file=REQUEST_FILE){
 if(!existsSync(file))return null;
 const row=JSON.parse(readFileSync(file,'utf8'));
 if(row?.schema!=='MOEI-OPERATIONAL-RESET-REQUEST-v1')
  abort('RESET_REQUEST_CORRUPT',503);
 return row;
}
export function resetRequestView(file=REQUEST_FILE){
 const row=currentResetRequest(file);
 if(!row)return {status:'NONE'};
 return {status:row.status,id:row.id,requestedAt:row.requestedAt,
  requestedBy:row.requestedBy,plannedRows:row.plannedRows,
  completedAt:row.completedAt||null,
  outcome:row.outcome||null,scope:'SI_OPERATIONAL_ACTIONS_AND_NMC_ALERTS'};
}
export async function queueOperationalReset({
 actor,previewSha,confirmation,acknowledgePreservation
}={}, {env=process.env,file=REQUEST_FILE,preview=executeReviewedReset}={}){
 if(env.MOEI_OPERATIONAL_RESET_ENABLED!=='true')
  abort('RESET_FEATURE_NOT_ENABLED',403);
 if(!actor||typeof actor!=='string'||actor.length>120)
  abort('RESET_ADMIN_ACTOR_REQUIRED',403);
 if(confirmation!==ACK||acknowledgePreservation!==true||
    !/^[a-f0-9]{64}$/.test(String(previewSha||'')))
  abort('RESET_PREVIEW_AND_EXPLICIT_ACK_REQUIRED',422);
 const previous=currentResetRequest(file);
 if(previous&&['QUEUED','RUNNING','ORACLE_COMMITTED'].includes(previous.status))
  abort('RESET_REQUEST_ALREADY_PENDING',409);
 const fresh=await preview('PREVIEW',{env});
 if(fresh.sha256!==previewSha||fresh.unsafe)
  abort('RESET_PREVIEW_CHANGED_OR_BLOCKED',409);
 const req={schema:'MOEI-OPERATIONAL-RESET-REQUEST-v1',
  id:randomUUID(),status:'QUEUED',requestedBy:actor,
  requestedAt:new Date().toISOString(),
  previewSha:fresh.sha256,plannedRows:fresh.totalRows,
  confirmedScope:'SI_OPERATIONAL_ACTIONS_AND_NMC_ALERTS',
  requiresExternalOracleBackup:true,requiresOfflineWriterStop:true,
  requiresAlertScannerDisabled:true};
 // This lock file is intentionally durable on /data. The offline runner
 // requires the same queued UUID and a backup manifest before any SQL APPLY.
 safeWrite(file,req);
 return resetRequestView(file);
}
export function saveResetOutcome(request,patch,file=REQUEST_FILE){
 if(!request||!request.id)abort('RESET_REQUEST_MISSING',409);
 const current=currentResetRequest(file);
 if(current?.id!==request.id)abort('RESET_REQUEST_CHANGED',409);
 const next={...current,...patch};
 safeWrite(file,next);
 return resetRequestView(file);
}
export function validateOfflineResetPrerequisites({
 request=currentResetRequest(),env=process.env,
 backupManifest=null,writerStopConfirmed=false,
 runtimeFile=process.env.NMC_RUNTIME_SETTINGS_STORE_PATH||
  '/data/nmc-runtime-settings.json'
}={}){
 if(env.MOEI_OPERATIONAL_RESET_ENABLED!=='true'||env.NMC_DB_MODE!=='oracle')
  abort('RESET_OFFLINE_MODE_NOT_ENABLED',403);
 if(request?.status!=='QUEUED')abort('RESET_REQUEST_NOT_QUEUED',409);
 if(Date.now()-Date.parse(request.requestedAt)>24*3600000||
    Date.parse(request.requestedAt)>Date.now()+60000)
  abort('RESET_REQUEST_EXPIRED',409);
 if(writerStopConfirmed!==true)abort('RESET_WRITERS_MUST_BE_STOPPED',409);
 if(env.SI_POC_MAINTENANCE_WINDOW!=='true')
  abort('RESET_MAINTENANCE_MODE_REQUIRED',409);
 if(!backupManifest||backupManifest.schema!=='MOEI-ORACLE-BACKUP-VERIFIED-v1'||
    backupManifest.database!=='NMC_AI@FREEPDB1'||
    backupManifest.verifiedRestorable!==true||
    typeof backupManifest.backupReference!=='string'||
    backupManifest.backupReference.length<8||
    Date.now()-Date.parse(backupManifest.verifiedAt)>24*3600000||
    Date.parse(backupManifest.verifiedAt)>Date.now()+60000)
  abort('RESET_RECENT_RESTORABLE_BACKUP_PROOF_REQUIRED',409);
 if(!existsSync(runtimeFile))
  abort('RESET_ALERT_SCANNER_OVERRIDE_REQUIRED',409);
 const settings=new RuntimeSettings({env,file:runtimeFile});
 settings.load();
 if(settings.get('NMC_ALERT_SCAN_ENABLED')!==false||
    !Object.hasOwn(settings.overrides,'NMC_ALERT_SCAN_ENABLED'))
  abort('RESET_ALERT_SCANNER_RUNTIME_OVERRIDE_MUST_BE_OFF',409);
 return true;
}
