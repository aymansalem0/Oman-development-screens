import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';
import {SiInspectionPlan} from '../si-inspection-plan.mjs';

function setup(){
 const dir=mkdtempSync(join(tmpdir(),'moei-rolling-plan-'));
 const rolling=new SiRollingPlanStore({mode:'json',file:join(dir,'rolling.json')});
 const vessel={imo:'9328471',vesselName:'Tanker 9328471',vesselType:'Tanker',
  flag:'AE',sourceTypes:['NMC_CASE'],regimes:['FOCUSED_INSPECTION'],
  sourceEvents:[{eventKey:'NMC-123',sourceType:'NMC_CASE',approval:'APPROVED',
   sourceReference:'NMC-123',evidenceIds:['NMC-123']}],
  pendingWorkflows:1,createdWorkflows:0,scheduledWorkflows:0,
  currentRisk:{score:87,level:'HIGH',assessmentId:'A1',policyRevision:1}};
 const c={candidateKey:'first-candidate',imo:vessel.imo,
  regime:'FOCUSED_INSPECTION',sourceTypes:['NMC_CASE'],
  currentRisk:vessel.currentRisk,allowedEvidence:['NMC-123']};
 const agent={provider:'mock',runCount:0,
  source:async()=>({snapshotHash:'f'.repeat(64),candidates:[c]}),
  run:async()=>({agentRunId:'C01-run-1',provider:'MOCK',mock:true,externalCalls:0,
   snapshotHash:'f'.repeat(64),recommendations:[{
    candidateKey:c.candidateKey,imo:vessel.imo,regime:'FOCUSED_INSPECTION',
    recommendation:'SELECT_RECOMMENDED',confidence:.9,suggestedRank:1,
    reason:'Human-approved maritime referral and saved maritime risk',
    priorityRationale:'Validated NMC referral receives highest allowed tier',
    evidenceRefs:['NMC-123'],dataGaps:[]} ]})};
 const targeting={dashboard:async()=>({vesselCandidates:[vessel],
  summary:{inspectionsCreated:0}})};
 const plan=new SiInspectionPlan({targeting,candidateAgent:agent,rollingPlans:rolling,
  file:join(dir,'legacy.json')});
 const create=(name='First plan')=>rolling.create({title:name,startsOn:'2026-10-13',
  endsOn:'2026-10-16'},'officer@moei',
  {candidates:[c],sourceHash:'f'.repeat(64)});
 return {dir,rolling,plan,create,
  done:()=>rmSync(dir,{recursive:true,force:true})};
}
test('independent rolling drafts retain distinct IDs, periods and revisions across multiple daily plans',async()=>{
 const x=setup();try{
  const p=await x.create('Morning Inspection');
  const q=await x.create('Afternoon Inspection');
  assert.notEqual(p.id,q.id);
  assert.equal(Object.hasOwn(p,'port'),false,'new plan has no port field');
  assert.notEqual(p.number,q.number);
  assert.equal((await x.rolling.list()).length,2);
  assert.equal((await x.plan.snapshot(p.id)).agentRunId,null);
  const before=await x.plan.snapshot(p.id);
  const run=await x.plan.rerank({planId:p.id,actor:'officer@moei',confirmRun:true,
   confirmCost:false,expectedRevision:before.revision,
   expectedSourceHash:before.sourceHash});
  assert.equal(run.selectedForPlan,1);
  assert.equal((await x.rolling.get(p.id)).status,'READY_FOR_APPROVAL');
  assert.equal((await x.rolling.get(q.id)).status,'DRAFT');
  assert.equal((await x.plan.snapshot(q.id)).agentRunId,null);
  assert.equal(existsSync(join(x.dir,'legacy.json')),false,
   'rolling plans must not overwrite old C01 single-plan file');
  await assert.rejects(x.plan.rerank({planId:p.id,actor:'officer@moei',
   expectedSourceHash:before.sourceHash,expectedRevision:0,confirmRun:true}),
   /SI_PLAN_CHANGED_REFRESH_REQUIRED/);
 }finally{x.done();}
});
test('approved rolling plan persists immutable frozen case/event links; new plan remains available',async()=>{
 const x=setup();try{
  const p=await x.create(),q=await x.create('Same-day second plan');
  const source=await x.plan.snapshot(p.id);
  await x.plan.rerank({planId:p.id,actor:'officer@moei',confirmRun:true,
   expectedRevision:0,expectedSourceHash:source.sourceHash});
  const ready=await x.rolling.get(p.id);
  const caseId='11111111-1111-4111-8111-111111111111';
  const batchId='22222222-2222-4222-8222-222222222222';
  await x.rolling.approve(p.id,{
   expectedRevision:ready.revision,batchId,actor:'supervisor@moei',
   cases:[{imo:'9328471',caseId,planRank:1,regimes:['FOCUSED_INSPECTION'],
    inspectionReasons:[{eventKey:'NMC-123',sourceType:'NMC_CASE',
     sourceReference:'NMC-123',reason:'Human-approved referral'}]}]
  });
  const approved=await x.rolling.get(p.id);
  assert.equal(approved.status,'APPROVED');
  assert.equal(approved.approvedVessels[0].caseId,caseId);
  assert.equal(approved.approvedVessels[0].inspectionReasons[0].eventKey,'NMC-123');
  await assert.rejects(x.rolling.saveDraft(p.id,approved.revision,'officer',x=>x),
   /SI_ROLLING_APPROVED_PLAN_IMMUTABLE/);
  await assert.rejects(x.rolling.cancel(p.id,approved.revision,'supervisor',
   'Attempt to cancel a plan that is already approved'),
   /SI_ROLLING_APPROVED_PLAN_IMMUTABLE/);
  assert.equal((await x.rolling.get(q.id)).status,'DRAFT');
  assert.equal((await x.rolling.approve(p.id,{
   expectedRevision:ready.revision,batchId,actor:'supervisor@moei',
   cases:[{imo:'9328471',caseId}]})).approvedBatchId,batchId,
   'retry of same batch is idempotent');
 }finally{x.done();}
});
test('canceling a draft requires a human reason and does not affect other plans',async()=>{
 const x=setup();try{
  const p=await x.create(),q=await x.create();
  assert.throws(()=>x.rolling.cancel(p.id,0,'officer','no'),/REASON_REQUIRED/);
  const cancelled=await x.rolling.cancel(p.id,0,'officer','Operational plan withdrawn');
  assert.equal(cancelled.status,'CANCELLED');
  assert.equal((await x.rolling.get(q.id)).status,'DRAFT');
  assert.equal((await x.rolling.list()).length,2);
 }finally{x.done();}
});

test('new draft immediately exposes eligible vessel; manual inclusion creates approval-ready plan without AI',async()=>{
 const x=setup();
 try{
  const p=await x.create('Manual plan no AI');
  const before=await x.plan.snapshot(p.id);
  assert.equal(before.agentRunId,null);
  assert.equal(before.availableCount,1);
  assert.equal(before.selectedForPlan,0);
  assert.equal(before.rows[0].imo,'9328471');
  assert.equal(before.rows[0].editable,true);
  const saved=await x.plan.select({
   planId:p.id,imo:'9328471',action:'INCLUDE',
   reason:'Required source-backed inspection within this planning period',
   expectedRevision:before.revision,expectedSourceHash:before.sourceHash,
   actor:'officer@moei'});
  assert.equal(saved.externalCalls,0);
  const after=await x.plan.snapshot(p.id);
  assert.equal(after.agentRunId,null);
  assert.equal(after.manualSelection,true);
  assert.equal(after.rows[0].planSelected,true);
  assert.equal(after.rows[0].effectiveRank,1);
  assert.equal(after.selectedForPlan,1);
  assert.equal((await x.rolling.get(p.id)).status,'READY_FOR_APPROVAL');
  assert.equal((await x.rolling.get(p.id)).savedPlanRows[0].disposition,'INCLUDE');
  await assert.rejects(x.plan.select({planId:p.id,imo:'9328471',
    action:'NOT_SELECTED',reason:'Remove after officer reviewed evidence',
    actor:'officer@moei',expectedRevision:0,expectedSourceHash:before.sourceHash}),
   /SI_PLAN_CHANGED_REFRESH_REQUIRED/);
 }finally{x.done();}
});
test('unselected and deferred vessels carry forward with reason; new plan remains independent',async()=>{
 const x=setup();try{
  const old=await x.create('Old day');
  const base=await x.plan.snapshot(old.id);
  await x.plan.select({planId:old.id,imo:'9328471',action:'DEFER',
    reason:'Inspection cannot be performed until vessel returns',
    reviewAfter:'2099-02-01',actor:'officer@moei',
    expectedRevision:0,expectedSourceHash:base.sourceHash});
  const next=await x.create('Next available plan');
  const carried=await x.rolling.get(next.id);
  assert.equal(carried.carryForward['9328471'].disposition,'DEFER');
  assert.equal(carried.carryForward['9328471'].reviewAfter,'2099-02-01');
  const view=await x.plan.snapshot(next.id);
  assert.equal(view.rows[0].previousPlan,old.number);
  assert.equal(view.rows[0].previousDisposition,'DEFER');
  assert.equal(view.rows[0].planSelected,null);
  assert.equal(view.rows[0].editable,true,
   'eligible vessel must remain accessible to an authorized officer');
  assert.equal((await x.rolling.get(old.id)).status,'DRAFT');
  await assert.rejects(x.plan.select({
   planId:next.id,imo:'9328471',action:'NOT_APPLICABLE',
   reason:'Attempt to suppress legally protected mandatory NMC source',
   actor:'officer@moei',expectedRevision:0,
   expectedSourceHash:view.sourceHash}),/SI_MANDATORY_REFERRAL_PROTECTED/);
  assert.equal((await x.rolling.get(next.id)).revision,0);
 }finally{x.done();}
});
