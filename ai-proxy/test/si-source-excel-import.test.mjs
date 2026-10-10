import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ExcelJS from 'exceljs';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';
import {SiSourceExcelImport} from '../si-source-excel-import.mjs';

const fleet=Array.from({length:420},(_,i)=>({
  imo:String(9100000+i),
  inlineContext:{vessel:{name:'POC Vessel '+i,flag:'UAE',vesselType:'CARGO'}}
}));
const referrals=[{
  id:'5ebfad21-b6ab-4415-a110-778aff2345e2',
  caseId:'655874d3-d344-411f-b934-752aaa5247bb',
  imo:fleet[3].imo,status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS',
  createdAt:'2026-10-10T09:00:00Z',reason:'Human-approved NMC referral',
  evidenceIds:['A01-EVID-001'],sourceAssessmentId:'SAVED-ASSESS-001'
}];
function makeWorkspace(){
  const dir=mkdtempSync(join(tmpdir(),'si-excel-sources-'));
  const targeting=new SiCandidateTargeting({mode:'json',
    file:join(dir,'candidate.json'),bundles:fleet,
    cases:{listInspectionRequests:async()=>referrals},
    riskPolicy:{ready:true,projectCurrent:async()=>({policyRevision:1,projections:[]})}});
  const service=new SiSourceExcelImport({targeting});
  return {targeting,service,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
async function excel(source,rows,{headers=null,sheetName=null}={}){
  const book=new ExcelJS.Workbook(),s=book.addWorksheet(sheetName||
    (source==='SERVICE_REQUEST'?'SERVICE_REQUESTS':'PSC_PORT_CALLS'));
  s.addRow(headers||(source==='SERVICE_REQUEST'
    ?['request_id','request_reference','imo','port','request_date','service_type','notes']
    :['port_call_id','port_call_reference','imo','port','eta_local','visit_purpose','notes']));
  for(const r of rows)s.addRow(r);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const svcRow=(id='SR-001',imo=fleet[0].imo)=>
  [id,'SVC-'+id,imo,'Jebel Ali','2026-10-10','Vessel Compliance Check','POC-only data'];
const pscRow=(id='PC-001',imo=fleet[1].imo)=>
  [id,'CALL-'+id,imo,'Khalifa','2026-10-15T09:15','PSC Port Call','POC-only data'];
const pv=(s,bytes,sourceType,fileName)=>s.preview({
  sourceType,fileName,workbookBase64:bytes.toString('base64')});
test('generated Excel templates are valid and match source-specific layouts',async()=>{
  const w=makeWorkspace();
  try{
    for(const source of ['SERVICE_REQUEST','PSC_PORT_CALL']){
      const template=await w.service.template(source);
      const result=await pv(w.service,template,source,'POC-template.xlsx');
      assert.equal(result.canCommit,true);
      assert.equal(result.newEvents,1);
      assert.equal(result.sample[0].imo,fleet[0].imo);
      assert.equal(result.status,'PREVIEW_READY');
    }
  }finally{w.cleanup();}
});
test('NMC source remains live, no Excel can inject its authoritative referrals',async()=>{
  const w=makeWorkspace();
  try{
    const before=await w.targeting.dashboard();
    assert.equal(before.summary.bySource.NMC_CASE,1);
    await assert.rejects(()=>w.service.template('NMC_CASE'),
      e=>e.code==='SI_XLSX_UNKNOWN_SOURCE');
    await assert.rejects(()=>pv(w.service,await excel('SERVICE_REQUEST',[svcRow()]),
      'NMC_CASE','fake.xlsx'),e=>e.code==='SI_XLSX_UNKNOWN_SOURCE');
    const source=await w.service.status();
    assert.equal(source.nmc.mode,'LIVE_NMC_READ_ONLY');
    assert.equal(source.nmc.currentReferrals,1);
    assert.equal(source.excelSources.SERVICE_REQUEST.importedEvents,0);
    assert.equal((await w.targeting.dashboard()).summary.bySource.NMC_CASE,1);
  }finally{w.cleanup();}
});
test('source Excel Preview never persists; Commit atomically creates only manual-review candidates',async()=>{
  const w=makeWorkspace();
  try{
    const bytes=await excel('SERVICE_REQUEST',[svcRow('SR-001'),svcRow('SR-002',fleet[1].imo)]);
    const p=await pv(w.service,bytes,'SERVICE_REQUEST','services.xlsx');
    assert.equal(p.canCommit,true);
    assert.equal(p.newEvents,2);
    assert.equal((await w.targeting.dashboard()).summary.candidates,1);
    const saved=await w.service.commit({previewId:p.previewId,
      sourceType:'SERVICE_REQUEST',actor:'POC Operator'});
    assert.equal(saved.importedEvents,2);
    assert.equal(saved.airiaCalls,0);
    const queue=await w.targeting.dashboard();
    assert.equal(queue.summary.bySource.NMC_CASE,1);
    assert.equal(queue.summary.bySource.SERVICE_REQUEST,2);
    assert.equal(queue.summary.bySource.PSC_PORT_CALL,0);
    assert.equal(queue.summary.candidates,3);
    assert.equal(queue.candidates.find(c=>c.imo===fleet[0].imo).eligibility,'MANUAL_REVIEW');
    assert.equal(queue.candidates.find(c=>c.imo===fleet[0].imo).events[0].approval,'UNVERIFIED');
    assert.equal(queue.summary.inspectionsCreated,0);
    const history=await w.service.status();
    assert.equal(history.recentBatches[0].importedCount,2);
    assert.equal(history.recentBatches[0].fileName,'services.xlsx');
    await assert.rejects(()=>w.service.commit({previewId:p.previewId,
      sourceType:'SERVICE_REQUEST',actor:'POC Operator'}),
      e=>e.code==='SI_XLSX_PREVIEW_EXPIRED');
    const replay=await pv(w.service,bytes,'SERVICE_REQUEST','services.xlsx');
    assert.equal(replay.replayedEvents,2);
    assert.equal(replay.newEvents,0);
    const again=await w.service.commit({previewId:replay.previewId,
      sourceType:'SERVICE_REQUEST',actor:'Another Operator'});
    assert.equal(again.importedEvents,0);
    assert.equal(again.duplicateEvents,2);
    assert.equal((await w.targeting.dashboard()).summary.candidates,3);
  }finally{w.cleanup();}
});
test('PSC and service feeds for same IMO become separate candidate regimes',async()=>{
  const w=makeWorkspace();
  try{
    const source=await pv(w.service,await excel('SERVICE_REQUEST',[svcRow()]),
      'SERVICE_REQUEST','one.xlsx');
    await w.service.commit({previewId:source.previewId,
      sourceType:'SERVICE_REQUEST',actor:'Operator'});
    const port=await pv(w.service,await excel('PSC_PORT_CALL',[pscRow('PC-001',fleet[0].imo)]),
      'PSC_PORT_CALL','psc.xlsx');
    assert.equal(port.newEvents,1);
    await w.service.commit({previewId:port.previewId,sourceType:'PSC_PORT_CALL',actor:'Operator'});
    const q=(await w.targeting.dashboard()).candidates.filter(c=>c.imo===fleet[0].imo);
    assert.equal(q.length,2);
    assert.deepEqual(new Set(q.map(c=>c.regime)),
      new Set(['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION']));
    assert.ok(q.every(c=>c.eligibility==='MANUAL_REVIEW'));
  }finally{w.cleanup();}
});
test('wrong sheet, unknown IMO and formulas fail closed without partial commit',async()=>{
  const w=makeWorkspace();
  try{
    await assert.rejects(()=>pv(w.service,await excel('PSC_PORT_CALL',[pscRow()]),
      'SERVICE_REQUEST','mismatch.xlsx'),e=>e.code==='SI_XLSX_SHEET_REQUIRED_SERVICE_REQUESTS');
    const bad=await pv(w.service,await excel('SERVICE_REQUEST',
      [svcRow('SR-OK'),svcRow('SR-BAD','9999999')]),'SERVICE_REQUEST','invalid.xlsx');
    assert.equal(bad.canCommit,false);
    assert.equal(bad.newEvents,1);
    assert.ok(bad.issues.some(x=>x.row===3&&x.code==='SI_XLSX_UNKNOWN_FLEET_IMO'));
    await assert.rejects(()=>w.service.commit({previewId:bad.previewId,
      sourceType:'SERVICE_REQUEST',actor:'Operator'}),e=>e.code==='SI_XLSX_PREVIEW_NOT_VALID');
    const rows=await excel('SERVICE_REQUEST',[svcRow()]);
    const book=new ExcelJS.Workbook();await book.xlsx.load(rows);
    book.getWorksheet('SERVICE_REQUESTS').getCell('A2').value={formula:'2+2',result:'SR-001'};
    const formula=await pv(w.service,Buffer.from(await book.xlsx.writeBuffer()),
      'SERVICE_REQUEST','formula.xlsx');
    assert.equal(formula.canCommit,false);
    assert.equal(formula.issues[0].code,'SI_XLSX_FORMULA_NOT_ALLOWED');
    assert.equal((await w.targeting.dashboard()).summary.candidates,1);
  }finally{w.cleanup();}
});
test('duplicate event IDs with different source facts cannot overwrite imported event',async()=>{
  const w=makeWorkspace();
  try{
    const p=await pv(w.service,await excel('SERVICE_REQUEST',[svcRow()]),
      'SERVICE_REQUEST','first.xlsx');
    await w.service.commit({previewId:p.previewId,sourceType:'SERVICE_REQUEST',actor:'Operator'});
    const r=svcRow();r[3]='Fujairah';
    const altered=await pv(w.service,await excel('SERVICE_REQUEST',[r]),
      'SERVICE_REQUEST','altered.xlsx');
    assert.equal(altered.canCommit,false);
    assert.equal(altered.issues[0].code,'SI_XLSX_EVENT_ID_CONFLICT');
    assert.equal((await w.service.status()).excelSources.SERVICE_REQUEST.importedEvents,1);
  }finally{w.cleanup();}
});
