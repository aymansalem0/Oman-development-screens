import test from 'node:test';
import assert from 'node:assert/strict';
import {
 buildPocErpSchedulingOverlay,fillPocSchedulingVisitContext,
 validatePocSchedulingDemoRequest
} from '../si-scheduling-poc-fixtures.mjs';
import {validateMaritimeSchedulingInput,proposeMaritimeBatchSchedule}
 from '../si-maritime-batch-scheduling.mjs';
import {SiElectronicScheduler} from '../si-electronic-scheduling.mjs';
import {validateOperatorScheduleAgainstSource}
 from '../si-maritime-plan-source.mjs';

const now=Date.parse('2026-10-14T05:30:00.000Z');
const sourceSnapshot={
 snapshotId:'erp-upload-existing-10-oct',importedAt:'2026-10-10T11:09:00Z',
 data:{
  Ports:[
   {port_id:'JEA',port_name:'Jebel Ali',active:'Y',window_start:'07:00',window_end:'18:00'},
   {port_id:'FUJ',port_name:'Fujairah',active:'Y',window_start:'07:00',window_end:'18:00'}
  ],
  Inspectors:[{inspector_id:'REAL-01',display_name:'Recorded Officer',active:'Y',
    home_port_id:'FUJ',daily_capacity:'2'}],
  Qualifications:[],Inspector_Ports:[],Shifts:[],Leaves:[],Bookings:[],
  Blackouts:[],Travel_Matrix:[],POC_Requests:[]
 }
};
const cases=()=>({
 planId:'22222222-2222-4222-8222-222222222222',status:'SCHEDULE_INPUT_REQUIRED',
 items:[
  {imo:'9400643',name:'Golden Voyager',portId:'JEA',portName:'Jebel Ali',
   portSourceLocked:true,etaLocal:'',etdLocal:'',vesselType:'CARGO',
   regime:'SERVICE',regimes:['UAE_SERVICE_INSPECTION'],
   locationType:'BERTH',locationName:'',siteAccessConfirmed:false,
   durationMinutes:120,nmcReferrals:[],sourceTypes:['SERVICE_REQUEST']},
  {imo:'9400849',name:'Golden Meridian',portId:'',portName:'',
   portSourceLocked:false,etaLocal:'2026-10-18 09:00',
   etdLocal:'2026-10-19 18:00',
   dateEvidenceReference:'REAL-MSW-1',etdSource:'SOURCE_FINAL_NO_DATE_APPROVAL',
   vesselType:'CARGO',regime:'PSC',regimes:['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'],
   locationType:'BERTH',locationName:'',siteAccessConfirmed:false,
   durationMinutes:180,nmcReferrals:[],sourceTypes:['PSC_PORT_CALL','SERVICE_REQUEST']},
  {imo:'9401049',name:'Golden Pioneer',portId:'',portName:'',
   portSourceLocked:false,etaLocal:'',etdLocal:'',vesselType:'PASSENGER',
   regime:'PSC',regimes:['PORT_STATE_CONTROL'],locationType:'BERTH',
   locationName:'',siteAccessConfirmed:false,durationMinutes:180,
   nmcReferrals:[],sourceTypes:['PSC_PORT_CALL']}
 ]
});
function request(v){
 return {imo:v.imo,portId:v.portId,vesselType:v.vesselType,regime:v.regime,
  locationType:v.locationType,locationName:v.locationName,
  siteAccessConfirmed:v.siteAccessConfirmed,durationMinutes:v.durationMinutes,
  earliestLocal:v.etaLocal||v.earliestLocal,
  latestFinishLocal:v.etdLocal||v.latestFinishLocal,
  windowSource:v.etdLocal?'MSW_FINAL':v.windowSource,
  windowEvidenceReference:v.etdLocal?v.dateEvidenceReference:v.windowEvidenceReference,
  pocDemo:true};
}
test('POC mode fills all visit fields from deterministic, labelled synthetic source without writing original ERP',()=>{
 const erp=structuredClone(sourceSnapshot);
 const demo=buildPocErpSchedulingOverlay(erp,{clock:()=>now});
 const original=JSON.stringify(cases());
 const result=fillPocSchedulingVisitContext(cases(),demo,{clock:()=>now});
 assert.equal(result.demoMode,true);
 assert.equal(result.demoFilledVessels,3);
 assert.equal(result.items.length,3);
 assert.equal(result.workforce.length,8);
 assert.ok(result.workforce.every(x=>x.inspectorId.startsWith('DEMO-INS-')));
 assert.equal(demo.originalErpSnapshotId,erp.snapshotId);
 assert.equal(erp.data.Inspectors.length,1);
 assert.equal(erp.data.Qualifications.length,0);
 assert.ok(demo.data.Qualifications.length>20);
 assert.equal(demo.data.Inspectors[0].display_name,'POC Demo Inspector 01');
 assert.equal(JSON.stringify(cases()),original);
 for(const v of result.items){
  assert.ok(v.portId&&v.locationName&&v.siteAccessConfirmed);
  assert.ok(v.etaLocal||v.earliestLocal);
  assert.ok(v.etdLocal||v.latestFinishLocal);
  assert.equal(v.demoFilled,true);
  const checked=validateMaritimeSchedulingInput(v.imo,request(v),demo.data,now);
  assert.equal(checked.reason,undefined,JSON.stringify({imo:v.imo,reason:checked.reason}));
 }
 assert.equal(result.items[1].etdLocal,'2026-10-19 18:00',
  'Imported source-final ETD must not silently change');
 assert.equal(result.items[1].dateEvidenceReference,'REAL-MSW-1');
 const again=fillPocSchedulingVisitContext(cases(),
  buildPocErpSchedulingOverlay(erp,{clock:()=>now}),{clock:()=>now});
 assert.deepEqual(result.items,again.items);
});
test('POC port/window must match server-generated demo source and cannot fake approved MSW source',()=>{
 const original=cases(),demo=buildPocErpSchedulingOverlay(sourceSnapshot,{clock:()=>now});
 const filled=fillPocSchedulingVisitContext(original,demo,{clock:()=>now});
 const requests=filled.items.map(request);
 assert.doesNotThrow(()=>validateOperatorScheduleAgainstSource(original,requests,
  {demo:true,context:filled}));
 assert.doesNotThrow(()=>validatePocSchedulingDemoRequest(filled,requests));
 assert.throws(()=>validatePocSchedulingDemoRequest(filled,
  requests.map((x,i)=>i===0?{...x,windowEvidenceReference:'FORGED'}:x)));
 assert.throws(()=>validateOperatorScheduleAgainstSource(original,
  requests.map((x,i)=>i===1?{...x,latestFinishLocal:'2026-10-20 12:00'}:x),
  {demo:true,context:filled}),/SI_V2_FINAL_MSW_ETD_IMMUTABLE/);
});

test('POC user can calculate an actual read-only feasible schedule with complete synthetic data',()=>{
 const demo=buildPocErpSchedulingOverlay(sourceSnapshot,{clock:()=>now});
 const filled=fillPocSchedulingVisitContext(cases(),demo,{clock:()=>now});
 const approved={
  id:filled.planId,number:'IP-DEMO-20261014',
  status:'APPROVED',revision:1,approvedVessels:filled.items.map((v,i)=>({
   imo:v.imo,planRank:i+1,regimes:v.regimes,
   inspectionReasons:[{eventKey:'SOURCE-EVENT-'+v.imo,
    sourceType:i===0?'SERVICE_REQUEST':'PSC_PORT_CALL'}]
  }))
 };
 const scheduler=new SiElectronicScheduler({
  erp:{requireSnapshot:()=>demo},cases:{listInspectionRequests:async()=>[]},
  path:'/tmp/moei-si-demo-scheduler-not-present-no-writes-test.json',
  clock:()=>now
 });
 const response=proposeMaritimeBatchSchedule({
  plan:approved,erpSnapshot:demo,policy:scheduler.getPolicy(),
  requests:filled.items.map(request),nmcReferrals:[],
  existingBookings:[],scheduler,clock:()=>now
 });
 assert.equal(response.summary.total,3);
 assert.equal(response.summary.proposed,3,
   JSON.stringify(response.rows.map(r=>({imo:r.imo,blocker:r.blocker}))));
 assert.equal(response.summary.unscheduled,0);
 assert.equal(response.summary.caseWrites,0);
 assert.equal(response.summary.bookingWrites,0);
 assert.ok(response.variants.length>=1);
 assert.ok(response.rows.every(r=>r.status==='PROPOSED'&&
  r.assignment?.inspectorId.startsWith('DEMO-INS-')));
 assert.ok(response.board.engineers.length>=1);
 assert.ok(response.board.days.length>=1);
});

test('POC home-port roster automatically finds qualified remote engineers when the destination port has no staff',()=>{
 const demo=buildPocErpSchedulingOverlay(sourceSnapshot,{clock:()=>now});
 assert.equal(demo.data.Inspector_Ports.length,demo.data.Inspectors.length,
  'POC engineers are not falsely declared to be members of every port');
 const remote=demo.data.Inspectors.find(x=>x.home_port_id==='FUJ');
 assert.ok(remote);
 demo.data.Inspectors=[remote]; // only a Fujairah engineer remains
 const filled=fillPocSchedulingVisitContext(cases(),demo,{clock:()=>now});
 const vessel=filled.items.find(v=>v.imo==='9400643');
 const approved={id:filled.planId,number:'IP-REMOTE-POC',status:'APPROVED',
  revision:1,approvedVessels:[{imo:vessel.imo,planRank:1,
   regimes:vessel.regimes,inspectionReasons:[{eventKey:'SOURCE-9400643',
    sourceType:'SERVICE_REQUEST'}]}]};
 const scheduler=new SiElectronicScheduler({
  erp:{requireSnapshot:()=>demo},cases:{listInspectionRequests:async()=>[]},
  path:'/tmp/si-cross-port-poc-readonly-test.json',clock:()=>now
 });
 const proposal=proposeMaritimeBatchSchedule({
  plan:approved,erpSnapshot:demo,policy:scheduler.getPolicy(),
  requests:[request(vessel)],scheduler,clock:()=>now
 });
 assert.equal(proposal.summary.proposed,1,JSON.stringify(proposal.rows));
 assert.equal(proposal.summary.unscheduled,0);
 const assigned=proposal.rows[0].assignment;
 assert.equal(assigned.inspectorId,remote.inspector_id);
 assert.equal(assigned.crossPort,true);
 assert.equal(assigned.originPortId,'FUJ');
 assert.equal(assigned.portId,'JEA');
 assert.equal(assigned.travelMinutes,30);
 assert.ok(assigned.manualReasons.includes('CROSS_PORT_REQUIRES_APPROVAL'));
 assert.equal(proposal.variants[0].assignments[0].crossPort,true);
 assert.equal(proposal.board.engineers[0].assignments[0].originPortId,'FUJ');
 assert.equal(proposal.summary.bookingWrites,0);
 assert.equal(proposal.summary.caseWrites,0);
});
test('POC whole-plan solver fills concurrent visits using other ports when local inspector is busy',()=>{
 const demo=buildPocErpSchedulingOverlay(sourceSnapshot,{clock:()=>now});
 const local=demo.data.Inspectors.find(x=>x.home_port_id==='JEA');
 const remote=demo.data.Inspectors.find(x=>x.home_port_id==='FUJ');
 demo.data.Inspectors=[local,remote];
 const approved={id:'33333333-3333-4333-8333-333333333333',
  number:'IP-CROSS-PORT-POC',revision:1,status:'APPROVED',
  approvedVessels:[
   {imo:'9400643',planRank:1,regimes:['UAE_SERVICE_INSPECTION'],inspectionReasons:[]},
   {imo:'9400849',planRank:2,regimes:['UAE_SERVICE_INSPECTION'],inspectionReasons:[]}
  ]};
 const input=(imo)=>({imo,portId:'JEA',vesselType:'CARGO',regime:'SERVICE',
  locationType:'BERTH',locationName:'POC Jebel Ali berth',
  siteAccessConfirmed:true,earliestLocal:'2026-10-20 09:00',
  latestFinishLocal:'2026-10-20 11:00',durationMinutes:120,
  windowSource:'POC_DEMO',windowEvidenceReference:'POC-EXAMPLE',pocDemo:true});
 const scheduler=new SiElectronicScheduler({
  erp:{requireSnapshot:()=>demo},cases:{listInspectionRequests:async()=>[]},
  path:'/tmp/si-cross-port-concurrent-readonly-test.json',clock:()=>now
 });
 const result=proposeMaritimeBatchSchedule({
  plan:approved,erpSnapshot:demo,policy:scheduler.getPolicy(),
  requests:[input('9400643'),input('9400849')],scheduler,clock:()=>now
 });
 assert.equal(result.summary.unscheduled,0,JSON.stringify(result.rows));
 assert.equal(result.summary.proposed,2);
 assert.equal(new Set(result.rows.map(x=>x.assignment.inspectorId)).size,2);
 assert.ok(result.rows.some(x=>x.assignment.crossPort===true));
 assert.ok(result.variants[0].assignments.some(x=>
  x.crossPort===true&&x.manualReasons.includes('CROSS_PORT_REQUIRES_APPROVAL')));
});
test('Cross-port fallback still blocks prohibited routes: no fabricated travel eligibility',()=>{
 const demo=buildPocErpSchedulingOverlay(sourceSnapshot,{clock:()=>now});
 const remote=demo.data.Inspectors.find(x=>x.home_port_id==='FUJ');
 demo.data.Inspectors=[remote];
 demo.data.Travel_Matrix.find(x=>
  x.from_port_id==='FUJ'&&x.to_port_id==='JEA').route_allowed='N';
 const filled=fillPocSchedulingVisitContext(cases(),demo,{clock:()=>now});
 const v=filled.items.find(x=>x.imo==='9400643');
 const plan={id:filled.planId,status:'APPROVED',revision:1,approvedVessels:[
  {imo:v.imo,regimes:v.regimes,planRank:1,inspectionReasons:[]}]};
 const scheduler=new SiElectronicScheduler({
  erp:{requireSnapshot:()=>demo},cases:{listInspectionRequests:async()=>[]},
  path:'/tmp/si-cross-port-prohibited-readonly-test.json',clock:()=>now
 });
 const result=proposeMaritimeBatchSchedule({
  plan,erpSnapshot:demo,policy:scheduler.getPolicy(),
  requests:[request(v)],scheduler,clock:()=>now
 });
 assert.equal(result.summary.proposed,0);
 assert.equal(result.summary.unscheduled,1);
 assert.ok(result.rows[0].exclusions.some(x=>
  x.inspectorId===remote.inspector_id&&x.reasons.includes('PORT_NOT_ELIGIBLE')));
});
