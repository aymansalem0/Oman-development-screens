import test from 'node:test';
import assert from 'node:assert/strict';
import {maritimePlanSchedulingContext,validateOperatorScheduleAgainstSource}
 from '../si-maritime-plan-source.mjs';
const plan={id:'11111111-1111-4111-8111-111111111111',number:'IP-20261020',
 status:'APPROVED',approvedVessels:[{
  imo:'9328471',planRank:1,regimes:['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'],
  inspectionReasons:[
   {eventKey:'MSW-PSC-1',sourceType:'PSC_PORT_CALL',sourceEventId:'PC-1'},
   {eventKey:'MSW-SERVICE-1',sourceType:'SERVICE_REQUEST',sourceEventId:'SR-1'}
  ]},{
  imo:'9247813',planRank:2,regimes:['FOCUSED_INSPECTION'],
  inspectionReasons:[{eventKey:'NMC-1',sourceType:'NMC_CASE',
   sourceEventId:'NMC-REF-1',sourceReference:'CASE-NMC-1'}]
 }]};
const dashboard={vesselCandidates:[{
 imo:'9328471',vesselName:'MV Gulf Horizon',vesselType:'Tanker',
 sourceEvents:[{
  eventKey:'MSW-PSC-1',sourceType:'PSC_PORT_CALL',port:'Fujairah',
  sourceReference:'MSW-POC-PC-1',eta:'2026-10-20T08:00',
  departureAt:'2026-10-23T18:00:00+04:00',approval:'SOURCE_FINAL'
 },{
  eventKey:'MSW-SERVICE-1',sourceType:'SERVICE_REQUEST',port:'Fujairah',
  sourceReference:'MSW-POC-SR-1',eta:null,departureAt:null,approval:'UNVERIFIED'
 }]},{
 imo:'9247813',vesselName:'Al Noor Mariner',vesselType:'Cargo',
 sourceEvents:[{eventKey:'NMC-1',sourceType:'NMC_CASE',port:'Jebel Ali',
  sourceReference:'CASE-NMC-1',approval:'APPROVED'}]
 }]};
const erp={data:{Ports:[{port_id:'FUJ',port_name:'Fujairah',active:'Y',
 window_start:'06:00',window_end:'20:00'},
 {port_id:'JEA',port_name:'Jebel Ali',active:'Y',
 window_start:'06:00',window_end:'20:00'}]}};
test('Source-final ETD becomes locked batch-scheduling deadline without date-review workflow',()=>{
 const result=maritimePlanSchedulingContext(plan,dashboard,erp);
 assert.equal(result.items.length,2);
 const v=result.items[0];
 assert.equal(v.portId,'FUJ');
 assert.equal(v.regime,'PSC');
 assert.equal(v.etaLocal,'2026-10-20 08:00');
 assert.equal(v.etaSourceReference,'MSW-POC-PC-1');
 assert.equal(v.berthAtLocal,'');
 assert.equal(v.berthConfirmed,false);
 assert.equal(v.etdLocal,'2026-10-23 18:00');
 assert.equal(v.windowSource,'MSW_FINAL');
 assert.equal(v.etdSource,'SOURCE_FINAL_NO_DATE_APPROVAL');
 assert.equal(v.windowEvidenceReference,'MSW-POC-PC-1');
 assert.equal(v.siteAccessConfirmed,false,'berth access is NOT inferred from ETA');
 assert.deepEqual(v.regimes,['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION']);
 const nmc=result.items[1];
 assert.equal(nmc.sourceTypes[0],'NMC_CASE');
 assert.equal(nmc.etdLocal,'','NMC absent ETD cannot be fabricated');
 assert.equal(nmc.nmcReferrals[0].id,'NMC-REF-1');
});
test('Client cannot change imported final MSW date, port, regime or claimed source reference',()=>{
 const result=maritimePlanSchedulingContext(plan,dashboard,erp);
 const v=result.items[0],safe={
  imo:v.imo,portId:v.portId,vesselType:v.vesselType,regime:v.regime,
  earliestLocal:v.etaLocal,latestFinishLocal:v.etdLocal,
  windowSource:'MSW_FINAL',windowEvidenceReference:v.dateEvidenceReference};
 assert.doesNotThrow(()=>validateOperatorScheduleAgainstSource(result,[safe]));
 for(const [name,val] of [
   ['latestFinishLocal','2026-10-24 18:00'],['portId','JEA'],
   ['regime','FOCUSED'],['windowEvidenceReference','FAKE']
 ]){
  assert.throws(()=>validateOperatorScheduleAgainstSource(result,[{...safe,[name]:val}]),
   /SI_V2_/);
 }
});

test('Workforce display exposes active ERP scheduling skills but no private leave records',()=>{
 const snapshot={snapshotId:'POC-ERP-2026',data:{...erp.data,
  Inspectors:[
   {inspector_id:'ENG-01',display_name:'Marine Engineer One',active:'Y',
    daily_capacity:'2',home_port_id:'FUJ',private_phone:'DO-NOT-DISPLAY'},
   {inspector_id:'ENG-OFF',display_name:'Inactive Employee',active:'N',
    daily_capacity:'3'}
  ],
  Qualifications:[
   {inspector_id:'ENG-01',inspection_regime:'PSC',vessel_type:'TANKER',
    active:'Y',valid_until:'2027-12-31'},
   {inspector_id:'ENG-01',inspection_regime:'FOCUSED',active:'N',
    valid_until:'2027-12-31'}
  ],
  Leaves:[{inspector_id:'ENG-01',reason:'CONFIDENTIAL'}]
 }};
 const c=maritimePlanSchedulingContext(plan,dashboard,snapshot);
 assert.equal(c.erpSnapshotId,'POC-ERP-2026');
 assert.equal(c.workforce.length,1);
 assert.equal(c.workforce[0].inspectorId,'ENG-01');
 assert.equal(c.workforce[0].dailyCapacity,2);
 assert.deepEqual(c.workforce[0].qualifications,['PSC']);
 assert.doesNotMatch(JSON.stringify(c),/DO-NOT-DISPLAY|CONFIDENTIAL|Inactive Employee/);
});

test('Officer-confirmed berth arrival tightens, never changes, imported ETA/ETD',()=>{
 const context=maritimePlanSchedulingContext(plan,dashboard,erp);
 const v=context.items[0];
 const req={imo:v.imo,portId:v.portId,
  locationType:'BERTH',siteAccessConfirmed:true,
  vesselType:v.vesselType,regime:v.regime,
  earliestLocal:v.etaLocal,latestFinishLocal:v.etdLocal,
  windowSource:'MSW_FINAL',windowEvidenceReference:v.dateEvidenceReference,
  berthAtLocal:'2026-10-21 12:00',berthConfirmed:true,
  berthEvidenceReference:'MSW-BERTH-CHECK-003'};
 assert.doesNotThrow(()=>validateOperatorScheduleAgainstSource(context,[req]));
 assert.throws(()=>validateOperatorScheduleAgainstSource(context,[
  {...req,berthAtLocal:'2026-10-19 12:00'}]),
  /SI_V2_BERTHING_OUTSIDE_SOURCE_WINDOW/);
 assert.throws(()=>validateOperatorScheduleAgainstSource(context,[
  {...req,berthAtLocal:'2026-10-24 12:00'}]),
  /SI_V2_BERTHING_OUTSIDE_SOURCE_WINDOW/);
 assert.throws(()=>validateOperatorScheduleAgainstSource(context,[
  {...req,berthEvidenceReference:'MISSING',berthConfirmed:false}]),
  /SI_V2_BERTHING_CONFIRMATION_EVIDENCE_REQUIRED/);
 assert.equal(context.items[0].etaLocal,'2026-10-20 08:00');
 assert.equal(context.items[0].etdLocal,'2026-10-23 18:00');
});
