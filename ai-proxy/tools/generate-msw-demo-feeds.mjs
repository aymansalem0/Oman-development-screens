/**
 * MOEI SI: 99 partner-identity demo vessels, linked MSW service/PSC Excel
 * feeds and a per-vessel operational master with FINAL POC ETD.
 *
 * Dates, port calls, ETAs, ETDs and requests are SYNTHETIC samples.
 * No AIS, production MSW or vessel-registry authority is claimed.
 * Existing POC source-event IDs are immutable; use unique ETD-source IDs.
 */
import ExcelJS from 'exceljs';
import {mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AIRIA_DEMO_99_RECORDS} from '../airia-demo-cohort.mjs';

const ports=['Jebel Ali','Khalifa Port','Fujairah','Rashid Port','Port Zayed'];
const types=['Vessel Inspection Request','Maritime Compliance Inspection',
 'Vessel Safety Inspection','Inspection for Marine Service',
 'Registration-related Inspection'];
// Same IMO => same final POC departure across ALL source workbooks.
const finalEtdForIndex=i=>
 '2026-10-'+String(22+i%5).padStart(2,'0')+'T'+
 String(16+i%4).padStart(2,'0')+':00';
const serviceHeaders=['request_id','request_reference','imo','port',
 'request_date','service_type','notes','etd_local'];
const pscHeaders=['port_call_id','port_call_reference','imo','port',
 'eta_local','visit_purpose','notes','etd_local'];
const masterHeaders=['imo','vessel_name','current_port','eta_local',
 'etd_local','timezone','etd_status','etd_source',
 'service_request_ref','psc_port_call_ref','data_nature'];

// The 6 overlapping vessels (indices 54...59) preserve the PSC port
// in BOTH files. This avoids asserting two simultaneous vessel ports.
const portForIndex=i=>i>=54?ports[(i-54+2)%ports.length]:ports[i%ports.length];
const services=AIRIA_DEMO_99_RECORDS.slice(0,60).map((v,i)=>[
 'MSW-DEMO-SR-ETD-'+String(i+1).padStart(4,'0'),
 'MSW-POC-INS-ETD-'+String(i+1).padStart(4,'0'),v.imo,
 portForIndex(i),'2026-10-'+String(13+i%4).padStart(2,'0'),
 types[i%types.length],
 'SYNTHETIC POC ONLY — not a verified MSW export; '+v.name,
 finalEtdForIndex(i)
]);
const psc=AIRIA_DEMO_99_RECORDS.slice(54).map((v,i)=>{
 const global=i+54;
 return [
  'MSW-DEMO-PC-ETD-'+String(i+1).padStart(4,'0'),
  'MSW-POC-CALL-ETD-'+String(i+1).padStart(4,'0'),v.imo,
  portForIndex(global),
  '2026-10-'+String(17+i%5).padStart(2,'0')+'T'+
   String(8+i%10).padStart(2,'0')+':'+['00','15','30','45'][i%4],
  'Port Call Notification / PSC Candidate',
  'SYNTHETIC POC ONLY — selected PSC quota is separate; '+v.name,
  finalEtdForIndex(global)
 ];
});
const serviceMap=new Map(services.map(x=>[x[2],x]));
const pscMap=new Map(psc.map(x=>[x[2],x]));
const master=AIRIA_DEMO_99_RECORDS.map((v,i)=>{
 const sr=serviceMap.get(v.imo),call=pscMap.get(v.imo);
 const sources=[...(sr?['SERVICE_REQUEST']:[]),...(call?['PSC_PORT_CALL']:[])];
 return [
  v.imo,v.name,portForIndex(i),call?.[4]||'',
  finalEtdForIndex(i),'Asia/Dubai (UTC+04:00)',
  'FINAL_POC',sources.join(' + '),sr?.[1]||'',call?.[1]||'',
  'SYNTHETIC_POC'
 ];
});
export const MSW_DEMO_FEEDS={
 SERVICE_REQUEST:{sheet:'SERVICE_REQUESTS',headers:serviceHeaders,rows:services,
  name:'MSW_Service_Requests_POC_99_WITH_ETD.xlsx'},
 PSC_PORT_CALL:{sheet:'PSC_PORT_CALLS',headers:pscHeaders,rows:psc,
  name:'MSW_PSC_Port_Calls_POC_99_WITH_ETD.xlsx'}
};
export const VESSEL_MASTER_ETD_DEMO_FEED={
 sheet:'VESSEL_MASTER',headers:masterHeaders,rows:master,
 name:'MOEI_Vessel_Master_POC_99_WITH_ETD.xlsx'
};
if(services.length!==60||psc.length!==45||master.length!==99||
 new Set([...services,...psc].map(x=>x[2])).size!==99||
 new Set(master.map(x=>x[0])).size!==99)
 throw Error('MOEI_99_VESSEL_ETD_COHORT_MISMATCH');
if(services.some(x=>x[7]!==master.find(v=>v[0]===x[2])?.[4])||
 psc.some(x=>x[7]!==master.find(v=>v[0]===x[2])?.[4]||
  x[3]!==master.find(v=>v[0]===x[2])?.[2]||
  Date.parse(x[4]+':00+04:00')>=Date.parse(x[7]+':00+04:00')))
 throw Error('MOEI_99_VESSEL_ETD_CROSS_SOURCE_INCONSISTENCY');
export async function generateMswPocFiles(outputDirectory,{overwrite=false}={}){
 if(!outputDirectory||!outputDirectory.trim())throw Error('MSW_OUTPUT_DIRECTORY_REQUIRED');
 const target=resolve(outputDirectory);
 const specs=[...Object.entries(MSW_DEMO_FEEDS),
  ['VESSEL_MASTER',VESSEL_MASTER_ETD_DEMO_FEED]];
 const result=[];
 // Fail before writing any partial files if one would be overwritten.
 for(const [,spec] of specs){
  const path=join(target,spec.name);
  if(existsSync(path)&&!overwrite)throw Error('MSW_POC_OUTPUT_EXISTS_'+spec.name);
 }
 mkdirSync(target,{recursive:true,mode:0o700});
 for(const [sourceType,spec] of specs){
  const book=new ExcelJS.Workbook();
  book.creator='MOEI Smart Inspection — synthetic sample, not MSW/registry export';
  const sheet=book.addWorksheet(spec.sheet);
  sheet.addRow(spec.headers);
  for(const row of spec.rows)sheet.addRow(row);
  sheet.views=[{state:'frozen',ySplit:1}];
  sheet.autoFilter={from:'A1',to:sheet.getRow(1).getCell(spec.headers.length).address};
  spec.headers.forEach((name,i)=>{
   sheet.getColumn(i+1).width=name==='notes'?70:
    name==='etd_source'?36:name==='vessel_name'?30:
    name==='timezone'?26:Math.max(19,name.length+7);
  });
  sheet.getColumn(spec.headers.indexOf('etd_local')+1).fill={
   type:'pattern',pattern:'solid',fgColor:{argb:'FFE5F5F2'}};
  const first=sheet.getRow(1);first.height=29;
  first.eachCell(cell=>{
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF075C72'}};
   cell.font={bold:true,color:{argb:'FFFFFFFF'}};
  });
  const readme=book.addWorksheet('README');
  const info=[
   ['MOEI Maritime Smart Inspection','POC OPERATIONAL ETD — NOT LIVE SOURCE'],
   ['Source type',sourceType],
   ['Import sheet',spec.sheet],
   ['Row count',spec.rows.length],
   ['Date rule','Imported ETD is FINAL for POC, without a separate date sign-off'],
   ['Date zone','YYYY-MM-DDTHH:mm, Asia/Dubai UTC+04:00'],
   ['Authority','Entire fleet, ETD, ETA, port calls and service requests are synthetic demo data'],
   ['Vessel identity','99 IMO/name pairs come from Airia Partner Guide §8'],
   ['Cross-source join','Exactly 6 shared IMOs have matching ETD and port in both MSW Excel files'],
   ['PSC warning','PSC port call is NOT an automatic inspection approval'],
   ['Source import',sourceType==='VESSEL_MASTER'?
     'REFERENCE VIEW ONLY: no direct Vessel Master Excel importer in the current POC. Upload MSW source files to Candidate Source Imports.' :
     'Smart Inspection > Candidate Source Imports > Preview > Commit'],
   ['Legacy events','ETD source files use NEW *-ETD-* event IDs; review prior events to avoid duplicate candidates'],
   ['ETD nature','Operational latest port-call information; not immutable vessel identification'],
   ['ETA rule','Only PSC has source ETA; no estimated arrival is fabricated for service-only vessels']
  ];
  for(const row of info)readme.addRow(row);
  readme.getColumn(1).width=28;readme.getColumn(2).width=112;
  readme.getRow(1).font={bold:true,color:{argb:'FF075C72'}};
  const filepath=join(target,spec.name);
  await book.xlsx.writeFile(filepath);
  result.push({sourceType,path:filepath,count:spec.rows.length,
   importable:sourceType!=='VESSEL_MASTER'});
 }
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),pathArg=args.find(x=>x.startsWith('--out='));
 generateMswPocFiles(pathArg?.slice(6)||'/data/msw-demo-imports',{
  overwrite:args.includes('--overwrite-poc-only')
 }).then(files=>console.log(JSON.stringify({
   status:'SYNTHETIC_ETD_POC_CREATED',notRealMswExport:true,files},null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
