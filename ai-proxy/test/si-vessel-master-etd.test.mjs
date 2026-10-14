import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ExcelJS from 'exceljs';
import {projectVesselMasterEtd} from '../si-vessel-master-etd.mjs';
import {MSW_DEMO_FEEDS,VESSEL_MASTER_ETD_DEMO_FEED,
 generateMswPocFiles} from '../tools/generate-msw-demo-feeds.mjs';

const identities=[
 {sequence:1,imo:'9247813',name:'Al Noor Mariner'},
 {sequence:2,imo:'9328471',name:'MV Gulf Horizon'}
];
const evt=(imo,sourceType,etd,port='Jebel Ali')=>({
 eventKey:sourceType+'-'+imo,
 payload:{imo,sourceType,sourceApprovalStatus:'SOURCE_FINAL',
  departureAt:etd,port,provenance:'POC_SIMULATOR',
  sourceReference:'POC-'+sourceType+'-'+imo}
});
const now=Date.parse('2026-10-14T12:00:00+04:00');
test('Operational Vessel Master adds final ETD from source events without date sign-off',()=>{
 const master=projectVesselMasterEtd({identities,now,sourceEvents:[
  evt('9247813','SERVICE_REQUEST','2026-10-22T16:00:00+04:00'),
  evt('9247813','PSC_PORT_CALL','2026-10-22T16:00:00+04:00')
 ]});
 assert.equal(master.total,2);
 assert.equal(master.rows[0].etdStatus,'FINAL_POC');
 assert.equal(master.rows[0].etdLocal,'2026-10-22T16:00');
 assert.equal(master.rows[0].currentPort,'Jebel Ali');
 assert.deepEqual(master.rows[0].etdSourceTypes,['SERVICE_REQUEST','PSC_PORT_CALL'].sort());
 assert.equal(master.rows[1].etdStatus,'MISSING');
 assert.equal(master.rows[1].etdLocal,null);
 assert.equal(master.rows[0].etdBusinessRule,'FINAL_ON_SOURCE_IMPORT_NO_DATE_APPROVAL');
});
test('Conflicting future ETDs or different port sources fail closed, not random pick',()=>{
 const conflict=projectVesselMasterEtd({identities,now,sourceEvents:[
  evt('9247813','SERVICE_REQUEST','2026-10-22T16:00:00+04:00','Jebel Ali'),
  evt('9247813','PSC_PORT_CALL','2026-10-23T16:00:00+04:00','Jebel Ali')
 ]});
 assert.equal(conflict.summary.conflicting,1);
 assert.equal(conflict.rows[0].etdStatus,'CONFLICT');
 assert.equal(conflict.rows[0].etdLocal,null);
 const portConflict=projectVesselMasterEtd({identities,now,sourceEvents:[
  evt('9247813','SERVICE_REQUEST','2026-10-22T16:00:00+04:00','Jebel Ali'),
  evt('9247813','PSC_PORT_CALL','2026-10-22T16:00:00+04:00','Fujairah')
 ]});
 assert.equal(portConflict.rows[0].etdStatus,'CONFLICT');
});
test('Past date, ETA without ETD and unreviewed sources are not treated as final current ETD',()=>{
 const master=projectVesselMasterEtd({identities,now,sourceEvents:[
  evt('9247813','PSC_PORT_CALL','2026-10-01T08:00:00+04:00'),
  {payload:{imo:'9328471',sourceType:'PSC_PORT_CALL',
   sourceApprovalStatus:'UNVERIFIED',departureAt:'2026-10-25T18:00:00+04:00',
   eta:'2026-10-22T08:00',port:'Jebel Ali'}}
 ]});
 assert.equal(master.rows[0].etdStatus,'HISTORICAL_ONLY');
 assert.equal(master.rows[0].etdLocal,null);
 assert.equal(master.rows[1].etdStatus,'MISSING');
});
test('Three reproducible Excel exports have 99 coherent ETDs and 6 overlap IMOs',async()=>{
 const services=MSW_DEMO_FEEDS.SERVICE_REQUEST.rows;
 const portCalls=MSW_DEMO_FEEDS.PSC_PORT_CALL.rows;
 const master=VESSEL_MASTER_ETD_DEMO_FEED.rows;
 assert.deepEqual([services.length,portCalls.length,master.length],[60,45,99]);
 const byIMO=new Map(master.map(x=>[x[0],x]));
 const six=services.filter(r=>portCalls.some(p=>p[2]===r[2]));
 assert.equal(six.length,6);
 for(const r of [...services,...portCalls]){
  const m=byIMO.get(r[2]);
  assert.ok(m);
  assert.equal(r[7],m[4]);
  assert.equal(r[3],m[2]);
 }
 for(const row of portCalls)
  assert.ok(Date.parse(row[4]+':00+04:00')<Date.parse(row[7]+':00+04:00'));
 const dir=mkdtempSync(join(tmpdir(),'si-vessel-master-etd-'));
 try{
  const exported=await generateMswPocFiles(dir);
  assert.equal(exported.length,3);
  assert.ok(exported.some(x=>x.sourceType==='VESSEL_MASTER'&&x.importable===false));
  for(const file of exported){
   assert.ok(existsSync(file.path));
   const book=new ExcelJS.Workbook();await book.xlsx.readFile(file.path);
   const expected=file.sourceType==='VESSEL_MASTER'?'VESSEL_MASTER':
      file.sourceType==='SERVICE_REQUEST'?'SERVICE_REQUESTS':'PSC_PORT_CALLS';
   const sheet=book.getWorksheet(expected);
   assert.ok(sheet);
   assert.equal(sheet.rowCount,file.count+1);
   assert.equal(sheet.getRow(1).getCell(file.sourceType==='VESSEL_MASTER'?5:8).value,
    'etd_local');
   assert.match(String(sheet.getRow(2).getCell(
    file.sourceType==='VESSEL_MASTER'?5:8).value),/^2026-10-\d\dT\d\d:\d\d$/);
  }
  await assert.rejects(generateMswPocFiles(dir),/MSW_POC_OUTPUT_EXISTS_/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
