/**
 * Controlled reset for the SYNTHETIC POC NMC incident decision/AI ledger.
 * The real incident SOURCE Incident_Registry is READ-ONLY and preserved.
 * AI_Assessments is a separate Google Sheet: no local DB reset can clear it.
 *
 * --plan default, --apply requires external backup + maintenance + explicit
 * acknowledgement. Existing tab is backed up locally with full SHA before
 * any destructive remote :clear request, then re-read to verify.
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NmcIncidentFeed,parseIncidentFeedRows} from '../nmc-incident-feed.mjs';
const sum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function flags(argv){
 const o={apply:false,confirmed:false,backup:false,maintenance:false,
  root:'/data/nmc-poc-reset-backups'};
 for(const a of argv){
  if(a==='--plan')o.apply=false;
  else if(a==='--apply')o.apply=true;
  else if(a==='--ack=RESET_SYNTHETIC_INCIDENT_AI_LEDGER')o.confirmed=true;
  else if(a==='--backup-confirmed=VERIFIED')o.backup=true;
  else if(a==='--maintenance-confirmed=STOPPED')o.maintenance=true;
  else if(a.startsWith('--backup-dir='))o.root=a.slice(13);
  else throw Error('NMC_INCIDENT_RESET_UNKNOWN_FLAG');
 }
 if(o.apply&&(!o.confirmed||!o.backup||!o.maintenance||
   process.env.SI_POC_MAINTENANCE_WINDOW!=='true'))
  throw Error('NMC_INCIDENT_RESET_BACKUP_ACK_AND_STOPPED_SERVICE_REQUIRED');
 return o;
}
function safeFile(path,value){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});
}
export async function resetIncidentLedger(argv=process.argv.slice(2),
 {feed,fetchImpl=globalThis.fetch}={}){
 const o=flags(argv);
 const input=feed||new NmcIncidentFeed({
   autoEnabled:false,executeIncidentAgents:null,agentEnabled:()=>false,
   fetchImpl
 });
 if(!input.configured)throw Error('NMC_INCIDENT_RESET_SOURCE_NOT_CONFIGURED');
 const source=await input.sheets('GET','Incident_Registry!A1:Z1500');
 const ledger=await input.sheets('GET','AI_Assessments!A1:AF1500');
 // Fail closed if source or assessment headers/scope differ from adapter.
 const {incidents,rejectedRows}=parseIncidentFeedRows(source.values||[]);
 const feedView=await input.load();
 if(rejectedRows.length||feedView.sourceValidationWarnings)
  throw Error('NMC_INCIDENT_RESET_INVALID_SOURCE_ROWS');
 if(incidents.some(i=>i.dataNature!=='SYNTHETIC_POC'))
  throw Error('NMC_INCIDENT_RESET_NON_SYNTHETIC_SOURCE_FORBIDDEN');
 const rawLedger=ledger.values||[];
 if(!rawLedger.length)throw Error('NMC_INCIDENT_RESET_NO_LEDGER_HEADER');
 const ids=new Set(incidents.map(x=>x.incidentId));
 const records=rawLedger.slice(1).filter(row=>row?.some(v=>String(v||'').trim()));
 const unknown=records.filter(row=>!ids.has(row[0]));
 if(unknown.length)throw Error('NMC_INCIDENT_RESET_UNMATCHED_LEDGER_EVENTS');
 const report={
  schema:'NMC-INCIDENT-LEDGER-RESET-1.0',
  mode:o.apply?'APPLY':'PLAN',
  source:'GOOGLE_SHEETS_SYNTHETIC_POC',
  incidentSourcePreserved:true,
  sourceIncidentCount:incidents.length,
  assessmentLedgerRowCount:records.length,
  ledgerHash:sum(rawLedger),
  sourceHash:sum(source.values||[]),
  warning:'AI_Assessments rows are backed up and then cleared; Incident_Registry untouched. External restores must be verified.'
 };
 if(!o.apply){process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;}
 const directory=join(o.root,'incident-ledger-'+new Date().toISOString()
   .replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
 safeFile(join(directory,'Incident_Registry-source-UNCHANGED.json'),source);
 safeFile(join(directory,'AI_Assessments-before-clear.json'),ledger);
 const [freshSource,freshLedger]=await Promise.all([
  input.sheets('GET','Incident_Registry!A1:Z1500'),
  input.sheets('GET','AI_Assessments!A1:AF1500')
 ]);
 if(sum(source.values||[])!==sum(freshSource.values||[])||
    sum(rawLedger)!==sum(freshLedger.values||[]))
  throw Error('NMC_INCIDENT_RESET_CONCURRENT_SHEET_CHANGE');
 if(records.length){
  const token=await input.accessToken();
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+
   encodeURIComponent(input.sheetId)+'/values/'+
   encodeURIComponent('AI_Assessments!A2:AF1500')+':clear';
  const res=await fetchImpl(url,{method:'POST',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json'
  },body:'{}',signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw Error('NMC_INCIDENT_RESET_CLEAR_REJECTED');
  const after=await input.sheets('GET','AI_Assessments!A1:AF1500');
  const extras=(after.values||[]).slice(1).filter(row=>row?.some(v=>String(v||'').trim()));
  if(extras.length)throw Error('NMC_INCIDENT_RESET_CLEAR_VERIFICATION_FAILED');
 }
 report.status='RESET_APPLIED';report.backupDirectory=directory;
 safeFile(join(directory,'reset-report.json'),report);
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 resetIncidentLedger().catch(e=>{
  console.error('NMC_INCIDENT_RESET_FAILED '+String(e.message||'UNKNOWN')
   .replace(/[^A-Z0-9_ -]/gi,''));
  process.exitCode=1;
 });
