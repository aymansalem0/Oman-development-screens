import test from 'node:test';
import assert from 'node:assert/strict';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';
const ID='00000001-0000-4000-8000-000000000000';
const HASH='a'.repeat(64);
const plan=()=>({id:ID,status:'READY_FOR_APPROVAL',revision:2,
 selectionSourceHash:HASH,approvedVessels:[],
 savedPlanRows:[{
  imo:'9400796',editable:true,planSelected:true,
  mandatoryReferral:false,requiredInPlan:false,
  vesselName:'Test vessel',sources:['PSC_PORT_CALL'] }],
 updatedAt:'2026-10-14T00:00:00Z',
 audit:[]});
const vessel=[{imo:'9400796',planRank:1,
 regimes:['PORT_STATE_CONTROL'],
 inspectionReasons:[{eventKey:'PSC-SOURCE-EVENT',
  sourceType:'PSC_PORT_CALL',sourceReference:'PSC-1'}]}];
const decision={sourceHash:HASH,planRevision:2,
 selectionHash:'b'.repeat(64),proposalHash:'c'.repeat(64),
 erpSnapshotId:'ERP-VERIFIED',
 rejected:[],pscRiskRatePercent:25,uaeFlagRatePercent:0};
function make(){
 const initial=plan(),events=[],state={commits:0,rollbacks:0};
 const con={
  async execute(sql){events.push(sql.replace(/\s+/g,' ').trim());
   return {rowsAffected:1,rows:[]};},
  async commit(){state.commits++;},async rollback(){state.rollbacks++;}
 };
 const store=new SiRollingPlanStore({mode:'oracle'});
 store.db=async fn=>fn(con);
 store.query=async()=>[{STATE_JSON:JSON.stringify(initial)}];
 return {store,initial,events,state};
}
const params=withinTransaction=>({
 expectedRevision:2,expectedSourceHash:HASH,
 actor:'supervisor@moei',reason:'Verified integrated inspector capacity',
 vessels:vessel,integratedDecision:decision,withinTransaction
});
test('integrated plan saves roster and orders under ONE Oracle commit',async()=>{
 const x=make();
 let callbackStatus;
 const approved=await x.store.approveForScheduling(ID,params(async(connection,next)=>{
  callbackStatus=next.status;
  await connection.execute('INSERT INTO SI_SCHED_APPROVAL');
  await connection.execute('INSERT INTO SI_SCHED_WORK_ORDER');
 }));
 assert.equal(callbackStatus,'APPROVED');
 assert.equal(approved.scheduleMode,'SINGLE_CAPACITY_VERIFIED_PLAN_APPROVAL');
 assert.equal(approved.capacityDecision.proposalHash,decision.proposalHash);
 assert.equal(approved.approvedVessels.length,1);
 assert.equal(x.state.commits,1);
 assert.equal(x.state.rollbacks,0);
 const scheduleIndex=x.events.findIndex(s=>s.includes('SI_SCHED_APPROVAL'));
 const workIndex=x.events.findIndex(s=>s.includes('SI_SCHED_WORK_ORDER'));
 assert.ok(scheduleIndex>0&&workIndex>scheduleIndex);
});
test('work-order failure aborts plan approval with rollback and no commit',async()=>{
 const x=make();
 await assert.rejects(x.store.approveForScheduling(ID,params(async(connection)=>{
  await connection.execute('INSERT INTO SI_SCHED_APPROVAL');
  throw Error('SIMULATED_SCHEDULING_WORK_ORDER_FAILURE');
 })),/SIMULATED_SCHEDULING_WORK_ORDER_FAILURE/);
 assert.equal(x.state.commits,0);
 assert.equal(x.state.rollbacks,1);
 assert.equal(x.initial.status,'READY_FOR_APPROVAL',
  'no database status change committed');
});
test('integrated plan cannot be committed using non-transactional JSON store',async()=>{
 const x=new SiRollingPlanStore({mode:'json'});
 await assert.rejects(
  x.approveForScheduling(ID,params(async()=>{})),
  /SI_INTEGRATED_ATOMIC_ORACLE_REQUIRED/);
});
