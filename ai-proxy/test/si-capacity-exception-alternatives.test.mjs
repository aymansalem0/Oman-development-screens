import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestCapacityExceptionActions} from '../si-capacity-exception-alternatives.mjs';

const erp={data:{
 Inspectors:[
  {inspector_id:'ENG-LOCAL',active:'Y',home_port_id:'JEA'},
  {inspector_id:'ENG-CROSS',active:'Y',home_port_id:'KHF'},
  {inspector_id:'ENG-NOSKILL',active:'Y',home_port_id:'KHF'}],
 Qualifications:[
  {inspector_id:'ENG-LOCAL',active:'Y',inspection_regime:'PSC',
   vessel_type:'CARGO',valid_until:'2028-01-01'},
  {inspector_id:'ENG-CROSS',active:'Y',inspection_regime:'PSC',
   vessel_type:'CARGO',valid_until:'2028-01-01'},
  {inspector_id:'ENG-NOSKILL',active:'Y',inspection_regime:'SERVICE',
   vessel_type:'CARGO',valid_until:'2028-01-01'}],
 Travel_Matrix:[{from_port_id:'KHF',to_port_id:'JEA',
  route_allowed:'Y',one_way_minutes:'75'}]
}};
const policy={config:{allowCrossPort:true}};
const selection={roster:[
 {imo:'9400796',vesselType:'CARGO',regimes:['PORT_STATE_CONTROL']},
 {imo:'9400447',vesselType:'CARGO',regimes:['PORT_STATE_CONTROL']}],
 mandatoryImos:['9400447']};
const proposal={rows:[
 {imo:'9400796',status:'UNSCHEDULED',
  blocker:'GLOBAL_PLAN_CONFLICT_OR_CAPACITY',
  diagnostics:{portId:'JEA',earliestLocal:'2026-10-20 09:00'},
  exclusions:[{inspectorId:'ENG-LOCAL',reasons:['NO_WORKING_SHIFT']}]},
 {imo:'9400447',status:'UNSCHEDULED',
  blocker:'NO_FEASIBLE_ERP_SHIFT_QUALIFICATION_PORT_OR_WINDOW',
  diagnostics:{portId:'JEA',earliestLocal:'2026-10-20 09:00'},
  exclusions:[{inspectorId:'ENG-CROSS',reasons:['NO_WORKING_SHIFT']}]}
]};

test('conditional alternatives explain overtime and cross-port without creating schedules',()=>{
 const out=suggestCapacityExceptionActions({proposal,selection,erpSnapshot:erp,policy});
 assert.equal(out.length,2);
 assert.deepEqual(out[0].actions.map(x=>x.code),[
  'CROSS_PORT_ALTERNATIVE_REVIEW',
  'OUT_OF_HOURS_SHIFT_APPROVAL_REVIEW',
  'CHECK_REGULATORY_CANCELLATION_OR_DEFERRAL_ELIGIBILITY']);
 assert.deepEqual(out[0].actions[0].inspectorIds,['ENG-CROSS']);
 assert.deepEqual(out[0].actions[1].inspectorIds,['ENG-LOCAL']);
 assert.equal(out[0].actions[0].status,'CONDITIONAL_NOT_BOOKABLE');
 assert.equal(out[0].actions[1].status,'CONDITIONAL_NOT_BOOKABLE');
 assert.equal(out[0].actions[2].status,'PERMISSION_UNVERIFIED_NO_CANCELLATION');
 assert.ok(out.every(x=>x.aiProviderCalls===0));
 assert.ok(out.every(x=>x.bookingsCreated===0));
 assert.ok(out.every(x=>x.actions.every(a=>a.canExecuteAutomatically===false)));
});
test('mandatory vessel cannot be cancelled because of missing capacity',()=>{
 const out=suggestCapacityExceptionActions({proposal,selection,erpSnapshot:erp,policy});
 assert.equal(out[1].mandatory,true);
 assert.ok(out[1].actions.some(a=>a.code==='ESCALATE_MANDATORY_INSPECTION_CAPACITY'));
 assert.ok(!out[1].actions.some(a=>
  a.code==='CHECK_REGULATORY_CANCELLATION_OR_DEFERRAL_ELIGIBILITY'));
});
test('cross-port suggestions require approved travel and full qualifications',()=>{
 const rejected={data:{...erp.data,
  Travel_Matrix:[{...erp.data.Travel_Matrix[0],route_allowed:'N'}]}};
 const out=suggestCapacityExceptionActions({
  proposal,selection,erpSnapshot:rejected,policy});
 assert.ok(out.every(x=>!x.actions.some(a=>a.code==='CROSS_PORT_ALTERNATIVE_REVIEW')));
});
test('false/no qualification or no source time cannot authorize out-of-hours',()=>{
 const altered={...proposal,rows:[{...proposal.rows[0],
  diagnostics:{portId:'JEA',earliestLocal:null}}]};
 const out=suggestCapacityExceptionActions({proposal:altered,selection,erpSnapshot:erp,policy});
 assert.ok(!out[0].actions.some(x=>x.code==='OUT_OF_HOURS_SHIFT_APPROVAL_REVIEW'));
});
