import test from 'node:test';
import assert from 'node:assert/strict';
import {checkVesselPlanPeriod,proposedVisitInsideExecutionPeriod}
 from '../si-plan-period-eligibility.mjs';
import {SiInspectionPlan} from '../si-inspection-plan.mjs';

const period={startsOn:'2026-10-16',endsOn:'2026-10-22'};
const event=(eta,etd)=>({eventKey:'EV-1',sourceType:'PSC_PORT_CALL',
 approval:'SOURCE_FINAL',sourceReference:'MSW-2026-POC-1',
 ...(eta?{eta}:{}),...(etd?{departureAt:etd}:{})});
const vessel=(eta,etd)=>({imo:'9247813',sourceEvents:[event(eta,etd)]});

test('arrival after October 22 cannot be Included in October 16-22 execution plan',()=>{
 const r=checkVesselPlanPeriod(vessel('2026-10-23T06:30',
   '2026-10-23T22:00:00Z'),period);
 assert.equal(r.status,'OUTSIDE_EXECUTION_PLAN');
 assert.equal(r.reasonCode,'ARRIVAL_AFTER_PLAN_END');
 assert.equal(r.planEndsOn,'2026-10-22');
});
test('confirmed departure before start blocks; overlap at UAE midnight is handled correctly',()=>{
 const r=checkVesselPlanPeriod(vessel('2026-10-12T06:00',
   '2026-10-15T19:00:00Z'),period);
 assert.equal(r.reasonCode,'DEPARTURE_BEFORE_PLAN_START');
 assert.equal(checkVesselPlanPeriod(vessel('2026-10-16T00:00',
   '2026-10-16T03:00:00Z'),period).status,'WITHIN_SOURCE_WINDOW');
});
test('missing or unverified date is NOT invented or automatically treated as outside',()=>{
 assert.equal(checkVesselPlanPeriod(vessel(null,null),period).status,
  'NEEDS_CAPACITY_CHECK');
 const draft=vessel('2026-10-23T09:00',null);
 draft.sourceEvents[0].approval='UNVERIFIED';
 assert.equal(checkVesselPlanPeriod(draft,period).status,'NEEDS_CAPACITY_CHECK');
});
test('any source-backed overlapping visit window avoids false exclusion',()=>{
 const v=vessel('2026-10-23T08:00',null);
 v.sourceEvents.push({...event('2026-10-20T09:00',
  '2026-10-21T15:00:00Z'),eventKey:'EV-2'});
 assert.equal(checkVesselPlanPeriod(v,period).status,'WITHIN_SOURCE_WINDOW');
});
test('proposed work assignment Oct 23 is refused even when source ETA is missing',()=>{
 assert.equal(proposedVisitInsideExecutionPeriod({
  startLocal:'2026-10-23 06:30',endLocal:'2026-10-23 08:30'},period),false);
 assert.equal(proposedVisitInsideExecutionPeriod({
  startLocal:'2026-10-21 18:00',endLocal:'2026-10-21 21:00'},period),true);
 assert.equal(proposedVisitInsideExecutionPeriod({
  startLocal:'2026-10-22 23:00',endLocal:'2026-10-23 00:30'},period),false);
});
test('backend Include rejects impossible date BEFORE any persisted draft or paid AI call',async()=>{
 const v=vessel('2026-10-23T06:30',null);
 let writes=0,aiCalls=0;
 const plan={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision:0,startsOn:period.startsOn,endsOn:period.endsOn,
  status:'DRAFT',overrides:{},audit:[]};
 const agent={provider:'mock',source:async()=>({snapshotHash:'source1',
  candidates:[{imo:v.imo,sourceTypes:['PSC_PORT_CALL']}]}),
  run:async()=>{aiCalls++;throw new Error('UNEXPECTED_AI_CALL');}};
 const engine=new SiInspectionPlan({targeting:{dashboard:async()=>({
  vesselCandidates:[v]})},candidateAgent:agent,rollingPlans:{
  get:async()=>plan,mutate:async()=>{writes++;return {};}}});
 await assert.rejects(engine.select({
  planId:plan.id,imo:v.imo,action:'INCLUDE',reason:'Planned inspection request',
  expectedRevision:0,expectedSourceHash:'source1',actor:'MOEI Officer'
 }),e=>e.code==='SI_VESSEL_OUTSIDE_EXECUTION_PLAN'&&
  e.periodEligibility?.reasonCode==='ARRIVAL_AFTER_PLAN_END');
 assert.equal(writes,0);
 assert.equal(aiCalls,0);
});
