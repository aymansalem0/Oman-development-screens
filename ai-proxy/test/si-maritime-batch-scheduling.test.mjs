import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeMaritimeBatchSchedule,validateMaritimeSchedulingInput} from '../si-maritime-batch-scheduling.mjs';
const now=Date.parse('2026-10-14T09:00:00+04:00');
const plan={id:'99999999-9999-4999-8999-999999999999',number:'IP-TEST',
 revision:3,status:'APPROVED',approvedBy:'MOEI_TEST_SUPERVISOR',
 approvedVessels:[{imo:'9328471',planRank:1,regimes:['FOCUSED_INSPECTION']},
  {imo:'9247813',planRank:2,regimes:['UAE_SERVICE_INSPECTION']}]};
const erp=()=>{
 const data={Ports:[{port_id:'FUJ',active:'Y'}],
  Inspectors:[{inspector_id:'ENG1',daily_capacity:'2'},
   {inspector_id:'ENG2',daily_capacity:'2'}],Travel_Matrix:[]};
 return {snapshotId:'snapshot123',importedAt:'2026-10-14T05:00:00.000Z',data};
};
const auth=(id,min=0,max=999999)=>({
 inspector_id:id,inspection_regime:'ANY',vessel_type:'ANY',
 min_gt:String(min),max_gt:String(max),
 qualification_code:'MOEI-DEMO-GT-REVIEW',evidence_ref:'POC-ONLY-AUTH',
 authority:'MOEI_APPROVED',valid_until:'2027-01-01',active:'Y'
});
const request=(imo,regime,gt=55000)=>({
 imo,portId:'FUJ',vesselType:'CARGO',regime,grossTonnage:gt,
 locationName:'Fujairah approved inspection berth',locationType:'BERTH',
 siteAccessConfirmed:true,windowSource:'OFFICER_CONFIRMED',
 windowEvidenceReference:'DEMO-WINDOW-REVIEW-001',
 earliestLocal:'2026-10-20 08:00',latestFinishLocal:'2026-10-20 15:00',
 durationMinutes:90
});
const policy={revision:5,config:{maxOptions:3,maxDailyInspections:2,travelBufferMinutes:30}};
const slots={
 '9328471':[{
  optionId:'ENG1-9',inspectorId:'ENG1',inspectorName:'Engineer 1',portId:'FUJ',
  portName:'Fujairah',startUtc:'2026-10-20T05:00:00.000Z',
  endUtc:'2026-10-20T06:30:00.000Z',startLocal:'2026-10-20 09:00',endLocal:'2026-10-20 10:30',
  score:94
 },{
  optionId:'ENG2-12',inspectorId:'ENG2',inspectorName:'Engineer 2',portId:'FUJ',
  portName:'Fujairah',startUtc:'2026-10-20T08:00:00.000Z',
  endUtc:'2026-10-20T09:30:00.000Z',startLocal:'2026-10-20 12:00',endLocal:'2026-10-20 13:30',
  score:75
 }],
 '9247813':[{
  optionId:'ENG1-9-b',inspectorId:'ENG1',inspectorName:'Engineer 1',portId:'FUJ',
  portName:'Fujairah',startUtc:'2026-10-20T05:00:00.000Z',
  endUtc:'2026-10-20T06:30:00.000Z',startLocal:'2026-10-20 09:00',endLocal:'2026-10-20 10:30',
  score:98
 },{
  optionId:'ENG2-12-b',inspectorId:'ENG2',inspectorName:'Engineer 2',portId:'FUJ',
  portName:'Fujairah',startUtc:'2026-10-20T08:00:00.000Z',
  endUtc:'2026-10-20T09:30:00.000Z',startLocal:'2026-10-20 12:00',endLocal:'2026-10-20 13:30',
  score:81
 }]
};
const scheduler={buildOptions(input){return {options:slots[input.imo]||[],exclusions:[]};}};
const invoke=(params={})=>proposeMaritimeBatchSchedule({
 plan,erpSnapshot:erp(),policy,
 requests:[request('9328471','FOCUSED'),request('9247813','SERVICE',15000)],
 gtAuthorizations:[auth('ENG1'),auth('ENG2')],
 scheduler,clock:()=>now,...params
});
test('Preview is a read-only HUMAN-approved-plan maritime schedule for 2 vessels',()=>{
 const result=invoke();
 assert.equal(result.status,'DRAFT_REQUIRES_SUPERVISOR_APPROVAL');
 assert.equal(result.summary.total,2);
 assert.equal(result.summary.proposed,2,'two engineers allow two simultaneous vessels');
 assert.equal(result.summary.caseWrites,0);
 assert.equal(result.summary.bookingWrites,0);
 assert.notEqual(result.rows[0].assignment.inspectorId,result.rows[1].assignment.inspectorId);
 assert.match(result.solver,/NO_GENERATIVE_AI/);
 assert.equal(result.rows[0].assignment.locationType,'BERTH');
 assert.equal(invoke().proposalHash,result.proposalHash,'same evidence yields same hash');
});
test('Never double-book a single engineer or exceed batch daily limits',()=>{
 const result=invoke({existingBookings:[{inspectorId:'ENG2',startUtc:'2026-10-20T05:00:00.000Z',endUtc:'2026-10-20T06:00:00.000Z'},{inspectorId:'ENG2',startUtc:'2026-10-20T08:00:00.000Z',endUtc:'2026-10-20T10:30:00.000Z'}]});
 assert.equal(result.summary.proposed,1);
 assert.equal(result.summary.unscheduled,1);
 assert.equal(result.rows.filter(x=>x.status==='UNSCHEDULED').length,1);
});
test('Tonnage limits are NOT required; eligibility uses professional regime/type ERP checks',()=>{
 const withoutGt=invoke({gtAuthorizations:[]});
 assert.equal(withoutGt.summary.proposed,2,'No tonnage range required for scheduling');
 const bad=request('9328471','FOCUSED');
 delete bad.windowSource;
 const val=validateMaritimeSchedulingInput('9328471',bad,erp().data,now);
 assert.equal(val.reason,'VERIFIED_VESSEL_ARRIVAL_DEPARTURE_WINDOW_REQUIRED');
 const missingSite={...request('9328471','FOCUSED'),siteAccessConfirmed:false};
 assert.equal(validateMaritimeSchedulingInput('9328471',missingSite,erp().data,now).reason,
  'BERTH_ANCHORAGE_AND_ACCESS_CONFIRMATION_REQUIRED');
});
test('NMC referrals are checked against authoritative live workspace, with no duplicate scheduling',()=>{
 const nmcPlan={...plan,approvedVessels:[{
  ...plan.approvedVessels[0],
  inspectionReasons:[{sourceType:'NMC_CASE',sourceEventId:'ref-1'}]}]};
 const payload={plan:nmcPlan,requests:[request('9328471','FOCUSED')]};
 const missing=invoke(payload);
 assert.equal(missing.rows[0].blocker,'NMC_APPROVED_REFERRAL_MISSING_OR_CLOSED');
 const live=invoke({...payload,nmcReferrals:[{id:'ref-1',imo:'9328471',
  status:'PENDING_SCHEDULING',caseStatus:'IN_PROGRESS'}]});
 assert.equal(live.summary.proposed,1);
 const double=invoke({...payload,nmcReferrals:[{id:'ref-1',imo:'9328471',
  status:'SCHEDULED',caseStatus:'IN_PROGRESS'}]});
 assert.equal(double.rows[0].blocker,'NMC_REFERRAL_ALREADY_SCHEDULED_RECONCILE');
});

test('Block unsourced vessel automatically; never fabricate a schedule, tonnage or departure',()=>{
 const result=invoke({requests:[request('9328471','FOCUSED')]});
 assert.equal(result.summary.proposed,1);
 assert.equal(result.rows.find(x=>x.imo==='9247813').blocker,'VESSEL_SCHEDULING_DATA_REQUIRED');
 assert.equal(result.summary.total,2);
});
test('Require approved plan; reject unknown IMO or duplicate requests',()=>{
 assert.throws(()=>invoke({plan:{...plan,status:'READY_FOR_APPROVAL'}}),
  /SI_V2_APPROVED_PLAN_REQUIRED/);
 assert.throws(()=>invoke({requests:[request('9328471','FOCUSED'),
  request('9328471','FOCUSED')]}),/SI_V2_DUPLICATE_REQUEST_IMO/);
 assert.throws(()=>invoke({requests:[request('9999999','FOCUSED')]}),
  /SI_V2_OUT_OF_PLAN_IMO/);
});
