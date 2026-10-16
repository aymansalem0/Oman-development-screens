import test from 'node:test';
import assert from 'node:assert/strict';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';
import {SiInspectionPlan} from '../si-inspection-plan.mjs';

const ID='00000001-0000-4000-8000-000000000000';
const HASH='a'.repeat(64);
const IMO1='9400101',IMO2='9400102';
const verified=()=>({
 id:ID,status:'READY_FOR_APPROVAL',revision:0,
 selectionSourceHash:HASH,overrides:{},
 latest:{snapshotHash:HASH,agentRunId:'C01-ORIGINAL',
  rows:[{imo:IMO1,planSelected:true},{imo:IMO2,planSelected:false}]},
 savedPlanRows:[{imo:IMO1,planSelected:true},{imo:IMO2,planSelected:false}],
 capacityDraft:{status:'CAPACITY_VERIFIED_DRAFT',sourceHash:HASH,
  selectedImos:[IMO1],c01SelectedImos:[IMO1],
  proposalHash:'b'.repeat(64),selectedOptionId:'OPT-1'},
 audit:[{event:'CREATED'}]
});
const stale=()=>({
 ...verified(),revision:4,
 latest:{snapshotHash:HASH,agentRunId:'C01-RERANKED',
  rows:[{imo:IMO1,planSelected:false},{imo:IMO2,planSelected:true}]},
 savedPlanRows:[{imo:IMO1,planSelected:false},{imo:IMO2,planSelected:true}],
 capacityDraft:{...verified().capacityDraft,
  status:'STALE_AFTER_DRAFT_EDIT_RECALCULATE_CAPACITY',
  proposalHash:null,selectedOptionId:null,proposedAssignments:[]}
});
function setup(current=stale(),history=[verified()]){
 const counters={commits:0,rollbacks:0,writes:[]};
 const con={
  async execute(sql,binds){
   counters.writes.push({sql:sql.replace(/\s+/g,' '),binds});
   return {rowsAffected:1,rows:[]};
  },
  async commit(){counters.commits++;},
  async rollback(){counters.rollbacks++;}
 };
 const store=new SiRollingPlanStore({mode:'oracle'});
 store.db=async fn=>fn(con);
 store.query=async(_con,sql)=>{
  if(sql.includes('SI_PLAN_ROLLING_VERSION'))return history.map(p=>({
   STATE_JSON:JSON.stringify(p)}));
  return [{STATE_JSON:JSON.stringify(current)}];
 };
 return {store,counters};
}
const restore=x=>x.store.restoreVerifiedCapacityDraft(
 ID,4,'supervisor@moei','Restore previously reviewed C01 selection',HASH);

test('legacy rerank cannot mutate a saved integrated Draft or call provider',async()=>{
 let calls=0;
 const plan=new SiInspectionPlan({
  targeting:{dashboard:async()=>{calls++;throw Error('unexpected dashboard');}},
  candidateAgent:{provider:'mock',source:async()=>{calls++;throw Error('unexpected source');},
   run:async()=>{calls++;throw Error('unexpected AI');}},
  rollingPlans:{get:async()=>stale()}
 });
 const err=e=>e.code==='SI_INTEGRATED_DRAFT_SELECTION_LOCKED_START_NEW_PLAN'&&
  e.status===409;
 await assert.rejects(plan.rerank({planId:ID,actor:'officer',
  expectedRevision:4,expectedSourceHash:HASH,confirmRun:true}),err);
 await assert.rejects(plan.select({planId:ID,imo:IMO1,action:'INCLUDE',
  reason:'Officer requested inclusion',expectedRevision:4,
  expectedSourceHash:HASH,actor:'officer'}),err);
 await assert.rejects(plan.selectBulk({planId:ID,imos:[IMO1],
  action:'NOT_SELECTED',reason:'Officer requested exclusion',
  expectedRevision:4,expectedSourceHash:HASH,actor:'officer'}),err);
 assert.equal(calls,0,'provider, source and scheduling must not be invoked');
});

test('direct Oracle mutations cannot bypass frozen integrated Draft scope',async()=>{
 const x=setup(verified());
 await assert.rejects(x.store.mutate(ID,0,'officer',p=>{
  p.savedPlanRows=[{imo:IMO2,planSelected:true}];return p;
 },'C01_REEVALUATED'),e=>
  e.code==='SI_INTEGRATED_DRAFT_SELECTION_LOCKED_START_NEW_PLAN');
 assert.equal(x.counters.commits,0);
 assert.equal(x.counters.writes.length,0);
 assert.equal(x.counters.rollbacks,1);
});

test('restore only the verified Oracle roster, preserve old revision in audit and commit once',async()=>{
 const x=setup();
 const restored=await restore(x);
 assert.equal(restored.status,'READY_FOR_APPROVAL');
 assert.equal(restored.revision,5);
 assert.equal(restored.latest.agentRunId,'C01-ORIGINAL');
 assert.deepEqual(restored.savedPlanRows.filter(v=>v.planSelected).map(v=>v.imo),
  [IMO1]);
 assert.equal(restored.capacityDraft.status,'CAPACITY_VERIFIED_DRAFT');
 assert.equal(restored.capacityDraft.proposalHash,'b'.repeat(64));
 assert.equal(restored.audit.at(-1).event,'CAPACITY_VERIFIED_DRAFT_RESTORED');
 assert.equal(restored.audit.at(-1).restoredFromRevision,0);
 assert.equal(x.counters.commits,1);
 assert.equal(x.counters.rollbacks,0);
 assert.ok(x.counters.writes.some(x=>x.sql.includes('SI_PLAN_ROLLING_VERSION')));
 assert.ok(x.counters.writes.every(x=>!x.sql.includes('SI_SCHED_')));
});

test('stale draft with altered original source cannot be resurrected',async()=>{
 const original=verified();original.selectionSourceHash='c'.repeat(64);
 const x=setup(stale(),[original]);
 await assert.rejects(restore(x),e=>
  e.code==='SI_DRAFT_RESTORE_SCOPE_OR_SOURCE_CHANGED');
 assert.equal(x.counters.commits,0);
 assert.equal(x.counters.rollbacks,1);
 assert.equal(x.counters.writes.length,0);
});
test('approved plans cannot be restored to Draft',async()=>{
 const original=stale();original.status='APPROVED';
 const x=setup(original);
 await assert.rejects(restore(x),e=>
  e.code==='SI_ROLLING_APPROVED_PLAN_IMMUTABLE');
 assert.equal(x.counters.commits,0);
 assert.equal(x.counters.writes.length,0);
});
test('revision mismatch cannot restore an outdated client view',async()=>{
 const x=setup();
 await assert.rejects(x.store.restoreVerifiedCapacityDraft(
  ID,3,'supervisor@moei','Restore previously reviewed C01 selection',HASH),
  e=>e.code==='SI_ROLLING_VERSION_CONFLICT');
 assert.equal(x.counters.commits,0);
 assert.equal(x.counters.writes.length,0);
});
