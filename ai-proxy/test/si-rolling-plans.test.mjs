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
  endsOn:'2026-10-16'},'officer@moei');
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
