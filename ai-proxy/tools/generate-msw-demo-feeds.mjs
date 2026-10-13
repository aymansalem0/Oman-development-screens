/**
 * MOEI Smart Inspection / MSW-aligned SAMPLE importer spreadsheets.
 * These rows are GENERATED SYNTHETIC POC examples, NOT an MSW API extraction.
 * To import authoritative MSW data, replace them with a verified MSW export
 * mapped to the source-specific 8-column ETD-enhanced headers, then Preview & Commit.
 */
import ExcelJS from 'exceljs';
import {mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AIRIA_DEMO_99_RECORDS} from '../airia-demo-cohort.mjs';
const serviceHeaders=['request_id','request_reference','imo','port',
 'request_date','service_type','notes','etd_local'];
const pscHeaders=['port_call_id','port_call_reference','imo','port',
 'eta_local','visit_purpose','notes','etd_local'];
const ports=['Jebel Ali','Khalifa Port','Fujairah','Rashid Port','Port Zayed'];
const types=['Vessel Inspection Request','Maritime Compliance Inspection',
 'Vessel Safety Inspection','Inspection for Marine Service',
 'Registration-related Inspection'];
// ETD-inclusive POC import gets NEW unique source event IDs. Existing
// seven-column source events are immutable and cannot be overwritten.
const service=AIRIA_DEMO_99_RECORDS.slice(0,60).map((v,i)=>[
 'MSW-DEMO-SR-ETD-'+String(i+1).padStart(4,'0'),
 'MSW-POC-INS-ETD-'+String(i+1).padStart(4,'0'),v.imo,
 ports[i%ports.length],'2026-10-'+String(13+i%4).padStart(2,'0'),
 types[i%types.length],'SYNTHETIC POC ONLY — not a verified MSW export; '+v.name,
 '2026-10-'+String(20+i%6).padStart(2,'0')+'T'+String(16+i%4).padStart(2,'0')+':00'
]);
const psc=AIRIA_DEMO_99_RECORDS.slice(54).map((v,i)=>[
 'MSW-DEMO-PC-ETD-'+String(i+1).padStart(4,'0'),
 'MSW-POC-CALL-ETD-'+String(i+1).padStart(4,'0'),v.imo,
 ports[(i+2)%ports.length],
 '2026-10-'+String(17+i%5).padStart(2,'0')+'T'+
 String(8+i%10).padStart(2,'0')+':'+['00','15','30','45'][i%4],
 'Port Call Notification / PSC Candidate',
 'SYNTHETIC POC ONLY — selected PSC quota is separate; '+v.name,
 '2026-10-'+String(22+i%5).padStart(2,'0')+'T'+String(18+i%3).padStart(2,'0')+':00'
]);
export const MSW_DEMO_FEEDS={
 SERVICE_REQUEST:{sheet:'SERVICE_REQUESTS',headers:serviceHeaders,rows:service,
  name:'MSW_Service_Requests_POC_99_Cohort.xlsx'},
 PSC_PORT_CALL:{sheet:'PSC_PORT_CALLS',headers:pscHeaders,rows:psc,
  name:'MSW_PSC_Port_Calls_POC_99_Cohort.xlsx'}
};
if(new Set([...service,...psc].map(row=>row[2])).size!==99||
 service.length!==60||psc.length!==45||
 [...service,...psc].some(row=>!AIRIA_DEMO_99_RECORDS.some(v=>v.imo===row[2])))
 throw Error('MSW_POC_99_FLEET_COHORT_MISMATCH');
export async function generateMswPocFiles(outputDirectory,{overwrite=false}={}){
 if(!outputDirectory||!outputDirectory.trim())throw Error('MSW_OUTPUT_DIRECTORY_REQUIRED');
 const result=[];
 for(const [sourceType,spec] of Object.entries(MSW_DEMO_FEEDS)){
  const book=new ExcelJS.Workbook();
  book.creator='MOEI Smart Inspection — synthetic POC, NOT MSW export';
  const sheet=book.addWorksheet(spec.sheet);
  sheet.addRow(spec.headers);
  for(const row of spec.rows)sheet.addRow(row);
  sheet.views=[{state:'frozen',ySplit:1}];
  sheet.autoFilter={from:'A1',to:'H1'};
  spec.headers.forEach((x,i)=>{sheet.getColumn(i+1).width=
    i===6?70:i===5?38:i===4?25:Math.max(19,x.length+7);});
  const first=sheet.getRow(1);first.height=30;
  first.eachCell(cell=>{
   cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF075C72'}};
   cell.font={bold:true,color:{argb:'FFFFFFFF'}};
  });
  const readme=book.addWorksheet('README');
  const info=[
   ['MOEI Maritime Smart Inspection','MSW-ALIGNED POC INPUT (NOT A REAL MSW EXPORT)'],
   ['Source type',sourceType],
   ['Import sheet',spec.sheet],
   ['Source authority','SYNTHETIC POC ONLY; replace with verified MSW records'],
   ['Source rows',spec.rows.length],
   ['Combined fleet','60 service + 45 PSC, with 6 overlapping IMOs = exactly 99 unique partner-demo vessels'],
   ['Importer limits','2 MB / 1000 rows, no formulas, exact 8-column row-one headers (legacy 7 accepted)'],
   ['Date fields','ETD local YYYY-MM-DDTHH:mm for both files; PSC ETA is separate. All are synthetic and UNVERIFIED.'],
   ['Departure provenance','Imported ETD is FINAL for POC scheduling/ranking on import; no separate date approval. Source rows remain SYNTHETIC POC.'],
   ['PSC warning','Port-call import does not bypass PSC quota/selection policy'],
   ['Source validation','Preview -> resolve issues -> Commit; no AI or case approval'],
   ['Document provenance','IMO/name from Airia Partner Guide §8; events/dates/ports/service types are invented POC samples']
  ];
  for(const row of info)readme.addRow(row);
  readme.getColumn(1).width=30;readme.getColumn(2).width=105;
  readme.getRow(1).font={bold:true,color:{argb:'FF075C72'}};
  const path=join(resolve(outputDirectory),spec.name);
  if(existsSync(path)&&!overwrite)throw Error('MSW_POC_OUTPUT_EXISTS_'+spec.name);
  mkdirSync(resolve(outputDirectory),{recursive:true,mode:0o700});
  await book.xlsx.writeFile(path);
  result.push({sourceType,path,count:spec.rows.length});
 }
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),pathArg=args.find(x=>x.startsWith('--out='));
 const target=pathArg?.slice(6)||'/data/msw-demo-imports';
 generateMswPocFiles(target,{overwrite:args.includes('--overwrite-poc-only')})
  .then(files=>console.log(JSON.stringify({
   status:'SYNTHETIC_POC_CREATED',notRealMswExport:true,files},null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;});
}
