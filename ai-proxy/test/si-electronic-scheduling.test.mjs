import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {parseErpExcel,ErpWorkforceStore} from '../si-erp-workforce.mjs';
import {SiElectronicScheduler} from '../si-electronic-scheduling.mjs';

const columns={
  Ports:['port_id','port_name','city','emirate','timezone','active','window_start','window_end'],
  Inspectors:['inspector_id','erp_employee_id','display_name','active','role','home_port_id','home_city','daily_capacity','weekly_hours_limit','source_updated_at'],
  Inspector_Ports:['inspector_id','port_id','assignment_type','active','effective_from','effective_to'],
  Qualifications:['inspector_id','inspection_regime','vessel_type','qualification_code','valid_until','active'],
  Shifts:['inspector_id','weekday','start_local','end_local','status','effective_from','effective_to'],
  Leaves:['leave_id','inspector_id','start_local','end_local','leave_type','approval_status','source_updated_at'],
  Blackouts:['blackout_id','port_id_or_ALL','start_local','end_local','reason_code','blocks_booking','notes'],
  Travel_Matrix:['from_port_id','to_port_id','one_way_minutes','route_allowed','travel_approval_required'],
  Bookings:['booking_id','inspection_id','inspector_id','port_id','start_local','end_local','booking_status'],
  Scheduling_Policy:['group','setting_key','suggested_value','type','scope','meaning'],
  POC_Requests:['referral_id','imo','risk_level','requested_port','eta_local','deadline_local','regime','vessel_type','duration_minutes','nmc_case_ref','nmc_action_approved','expected_demo_route','notes']
};
const fixtures={
  Ports:[['JEA','Jebel Ali','Dubai','Dubai','Asia/Dubai','Y','06:00','22:00']],
  Inspectors:[
    ['ENG-1','ERP-1','Inspector One','Y','INSPECTOR','JEA','Dubai',2,40,'2026-10-10 08:00'],
    ['ENG-2','ERP-2','Inspector Two','Y','INSPECTOR','JEA','Dubai',2,40,'2026-10-10 08:00']],
  Inspector_Ports:[['ENG-1','JEA','PRIMARY','Y','2026-01-01','2027-12-31'],
    ['ENG-2','JEA','PRIMARY','Y','2026-01-01','2027-12-31']],
  Qualifications:[['ENG-1','FOCUSED','CARGO','FOCUSED','2027-12-31','Y'],
    ['ENG-2','FOCUSED','CARGO','FOCUSED','2027-12-31','Y']],
  Shifts:['ENG-1','ENG-2'].flatMap(id=>['SUN','MON','TUE','WED','THU'].map(day=>
    [id,day,'08:00','17:00','WORKING','2026-01-01','2027-12-31'])),
  Leaves:[['L1','ENG-1','2026-10-12 00:00','2026-10-14 23:59','ANNUAL','APPROVED','2026-10-10 08:00']],
  Blackouts:[],
  Travel_Matrix:[['JEA','JEA','0','Y','N']],
  Bookings:[['B1','EXISTING','ENG-2','JEA','2026-10-12 08:00','2026-10-12 11:00','CONFIRMED']],
  Scheduling_Policy:[['MODE','approval_mode','HYBRID','ENUM','GLOBAL','POC default']],
  POC_Requests:[]
};
const now=Date.parse('2026-10-10T06:00:00Z');
async function excelBuffer(rows=fixtures){
  const workbook=new ExcelJS.Workbook();
  for(const [name,headers] of Object.entries(columns)){
    const sheet=workbook.addWorksheet(name);
    sheet.getRow(4).values=[, ...headers];
    for(const data of rows[name])sheet.addRow(data);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
// Our public ERP Excel sample was exported as legal x:-prefixed SpreadsheetML.
// ExcelJS 4.x rejects it before row/header validation. Exercise the same prefix
// representation without committing a binary fixture to the source repository.
async function namespacePrefixedExcelBuffer(){
  const zip=await JSZip.loadAsync(await excelBuffer());
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const names=Object.keys(zip.files).filter(n=>
    /^xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n));
  for(const name of names){
    const data=await zip.file(name).async('string');
    if(!data.includes('xmlns="'+ns+'"'))continue;
    const withPrefixes=data.replace(/<(\/?)((?:[A-Za-z][\w.-]*))(?=[\s/>])/g,
      '<$1x:$2').replace('xmlns="'+ns+'"','xmlns:x="'+ns+'"');
    zip.file(name,withPrefixes);
  }
  return Buffer.from(await zip.generateAsync({type:'nodebuffer'}));
}
test('valid namespace-prefixed ERP XLSX imports all 11 worksheets despite ExcelJS prefix limitation',async()=>{
  const input=await namespacePrefixedExcelBuffer();
  const data=await parseErpExcel(input);
  assert.equal(data.Ports[0].port_id,'JEA');
  assert.equal(data.Inspectors.length,2);
  assert.equal(data.Qualifications.length,2);
  assert.equal(data.Shifts.length,10);
  assert.equal(data.Bookings[0].booking_status,'CONFIRMED');
  assert.equal(data.Ports[0].timezone,'Asia/Dubai');
});
test('namespace repair does not bypass authorization-grade sheet or reference validation',async()=>{
  const rows=structuredClone(fixtures);
  rows.Inspectors[0][5]='FAKE_PORT_ID';
  // Rebuild similarly prefixed invalid content, then confirm the original
  // reference/eligibility validation remains mandatory.
  const zip=await JSZip.loadAsync(await excelBuffer(rows));
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  for(const n of Object.keys(zip.files).filter(n=>/^xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n))){
    const data=await zip.file(n).async('string');
    if(!data.includes('xmlns="'+ns+'"'))continue;
    zip.file(n,data.replace(/<(\/?)((?:[A-Za-z][\w.-]*))(?=[\s/>])/g,
      '<$1x:$2').replace('xmlns="'+ns+'"','xmlns:x="'+ns+'"'));
  }
  await assert.rejects(()=>parseErpExcel(await zip.generateAsync({type:'nodebuffer'})),
    e=>e.code==='ERP_UNKNOWN_HOME_PORT');
});
test('ERP workbook headers, snapshot preview and commit, only explicit commit persists',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'si-erp-'));
  try{
    const file=join(dir,'erp.json'),store=new ErpWorkforceStore({path:file});
    assert.equal(store.status().ready,false);
    const buffer=await excelBuffer();
    const preview=await store.previewBase64(buffer.toString('base64'));
    assert.equal(preview.counts.Inspectors,2);
    assert.equal(store.status().ready,false);
    store.commit(preview.snapshotId);
    assert.equal(store.status().ready,true);
    assert.equal(new ErpWorkforceStore({path:file}).status().snapshotId,preview.snapshotId);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('rejects unknown ERP engineer references without replacing prior data',async()=>{
  const rows=structuredClone(fixtures);rows.Leaves[0][1]='UNKNOWN';
  await assert.rejects(async()=>parseErpExcel(await excelBuffer(rows)),/ERP_UNKNOWN_INSPECTOR/);
});
function setup(dir){
  const erp=new ErpWorkforceStore({path:join(dir,'erp.json')});
  erp.snapshot={schema:1,snapshotId:'a'.repeat(64),
    importedAt:new Date(now).toISOString(),
    data:Object.fromEntries(Object.entries(fixtures).map(([name,rows])=>[
      name,rows.map(cells=>Object.fromEntries(columns[name].map((h,i)=>[h,String(cells[i]??'')])))]))};
  const req={id:'ref-1',caseId:'case-1',imo:'9328471',status:'PENDING_SCHEDULING',
    caseStatus:'IN_PROGRESS',sourceLevel:'Critical',sourceAssessmentId:'AIS-1'};
  const cases={
    listInspectionRequests:async()=>[req],
    get:async()=>({id:'case-1',version:1,status:'IN_PROGRESS'}),
    scheduleInspection:async(id,version,ref,data)=>{
      assert.equal(id,'case-1');assert.equal(version,1);assert.equal(ref,'ref-1');
      assert.ok(data.inspector);assert.ok(data.scheduledAt);
      req.status='SCHEDULED';return {version:2};
    }
  };
  return {engine:new SiElectronicScheduler({erp,cases,path:join(dir,'scheduling.json'),clock:()=>now}),erp,cases};
}
const payload={referralId:'ref-1',portId:'JEA',regime:'FOCUSED',vesselType:'CARGO',
  durationMinutes:180,earliestLocal:'2026-10-12 08:00',deadlineLocal:'2026-10-12 17:00'};
test('conflicts and approved leave remove unavailable options; Critical NMC requires supervisor approval',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'si-schedule-'));
  try{
    const {engine}=setup(dir);
    const proposal=await engine.propose(payload);
    assert.equal(proposal.status,'PROPOSED');
    assert.ok(proposal.options.length>0);
    assert.ok(proposal.options.every(o=>o.inspectorId==='ENG-2'));
    assert.ok(proposal.options.every(o=>o.startLocal>='2026-10-12 11:30'));
    assert.equal(proposal.options[0].approval,'MANUAL_APPROVAL_REQUIRED');
    assert.ok(proposal.exclusions.some(x=>x.inspectorId==='ENG-1'&&x.reasons.includes('APPROVED_LEAVE')));
    await assert.rejects(engine.confirm({proposalId:proposal.id,optionId:proposal.options[0].optionId}),
      /SI_SUPERVISOR_APPROVAL_REQUIRED/);
    const result=await engine.confirm({proposalId:proposal.id,optionId:proposal.options[0].optionId,
      allowManual:true});
    assert.equal(result.booking.inspectorId,'ENG-2');
    assert.equal(result.booking.approvalMode,'SUPERVISOR');
    await assert.rejects(engine.confirm({proposalId:proposal.id,optionId:proposal.options[0].optionId,
      allowManual:true}),/SI_PROPOSAL_EXPIRED/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('auto approval becomes eligible ONLY under published policy permitting NMC requests',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'si-auto-'));
  try{
    const {engine}=setup(dir);
    const policy=engine.getPolicy();
    assert.equal(policy.config.autoApproveNmcReferrals,false);
    policy.config.autoApproveNmcReferrals=true;
    policy.config.autoMaxRiskLevel='Critical';
    const newer=engine.publishPolicy({expectedRevision:1,reason:'Controlled POC auto scheduling approval',
      publishedBy:'POC SUPERVISOR',config:policy.config});
    assert.equal(newer.revision,2);
    const proposal=await engine.propose(payload);
    assert.equal(proposal.options[0].approval,'AUTO_ELIGIBLE');
    assert.equal(engine.history().length,2);
    assert.throws(()=>engine.publishPolicy({expectedRevision:1,reason:'Version conflict test',
      publishedBy:'POC SUPERVISOR',config:policy.config}),/SI_POLICY_VERSION_CONFLICT/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
