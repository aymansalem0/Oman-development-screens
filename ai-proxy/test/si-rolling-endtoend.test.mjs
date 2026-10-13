import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';
import {SiInspectionPlan} from '../si-inspection-plan.mjs';
import {SiBulkInspectionPlan} from '../si-bulk-inspection-plan.mjs';

const IMO='9328471';
const CASE_ID='9c17a7e3-001d-4f68-8090-e92c8edc5c01';
const SOURCE='NMC-20261013-001';
function scenario(){
 const dir=mkdtempSync(join(tmpdir(),'moei-rolling-endtoend-'));
 let sourceVersion=1,c01Calls=0;const queue=[],cases=[];
 const event=()=>({eventKey:SOURCE,sourceType:'NMC_CASE',
  sourceEventId:SOURCE,sourceReference:'NMC-REF-001',approval:'APPROVED',
  contextNote:'Referral approved by NMC human supervisor',
  evidenceIds:['EVD-NMC-1'],provenance:'NMC_HUMAN_APPROVED'});
 const raw=()=>({candidateKey:'ref-'+sourceVersion,imo:IMO,regime:'FOCUSED_INSPECTION',
  sourceTypes:['NMC_CASE'],currentRisk:{score:85},
  allowedEvidence:['EVD-NMC-1']});
 const agent={provider:'mock',
  source:async()=>({
   snapshotHash:String(sourceVersion).repeat(64),
   candidates:cases.length?[]:[raw()]
  }),
  run:async()=>{c01Calls++;return {
   agentRunId:'C01-MOCK-'+c01Calls,provider:'MOCK',mock:true,externalCalls:0,
   snapshotHash:String(sourceVersion).repeat(64),
   recommendations:cases.length?[]:[{candidateKey:raw().candidateKey,
    imo:IMO,regime:raw().regime,recommendation:'SELECT_RECOMMENDED',
    confidence:.9,suggestedRank:1,reason:'Approved NMC referral',
    priorityRationale:'Mandatory NMC source',evidenceRefs:['EVD-NMC-1'],dataGaps:[]}]
  };}
 };
 const targeting={
  dashboard:async()=>({
   candidates:cases.length?[]:[{
    key:raw().candidateKey,imo:IMO,regime:'FOCUSED_INSPECTION',
    status:'PENDING_REVIEW',events:[event()]
   }],
   vesselCandidates:[{
    imo:IMO,vesselName:'UAE Test Tanker',flag:'AE',vesselType:'TANKER',
    sourceTypes:['NMC_CASE'],regimes:['FOCUSED_INSPECTION'],
    sourceEvents:[event()],currentRisk:{score:85},
    pendingWorkflows:cases.length?0:1,createdWorkflows:cases.length,
    scheduledWorkflows:0
   }],
   summary:{inspectionsCreated:cases.length}
  }),
  inspectionCaseRegistry:async()=>({cases:structuredClone(cases),events:[]}),
  decideBatch:async({items,actor,approvedPlanId})=>{
   assert.equal(actor,'supervisor@moei');
   assert.equal(items.length,1);
   assert.equal(items[0].inspectionReasons[0].eventKey,SOURCE);
   if(cases.length)throw Error('REPEAT_SOURCE_EVENT_NOT_ALLOWED');
   const created={id:CASE_ID,imo:IMO,candidateKey:items[0].candidateKey,
     approvedPlanId,regime:'FOCUSED_INSPECTION',regimes:items[0].regimes,
     inspectionReasons:items[0].inspectionReasons,sourceEventKeys:[SOURCE],
     status:'CREATED'};
   cases.push(created);sourceVersion++;
   return {cases:[created]};
  }
 };
 const rolling=new SiRollingPlanStore({mode:'json',file:join(dir,'plans.json')});
 const plan=new SiInspectionPlan({targeting,candidateAgent:agent,
  rollingPlans:rolling,file:join(dir,'legacy-c01.json')});
 const dossiers=new Map();
 const preparation={enabled:true,ready:true,provider:'mock',
  get:async id=>({saved:dossiers.get(id)||null,stale:false}),
  prepare:async(id,{expectedVersion,actor})=>{
   assert.equal(expectedVersion,0);assert.equal(actor,'supervisor@moei');
   const saved={caseId:id,status:'PREPARED',version:1};
   dossiers.set(id,saved);return {saved};
  }};
 const priority={enabled:false,ready:false,provider:'mock'};
 const bulk=new SiBulkInspectionPlan({inspectionPlan:plan,targeting,preparation,
  priority,file:join(dir,'batches.json'),submitTask:fn=>queue.push(fn)});
 return {agent,rolling,plan,bulk,queue,cases,
  c01Calls:()=>c01Calls,
  cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('end-to-end no-cost rolling: create, C01, preview, supervisor approve, cases, execute, new plan',async()=>{
 const x=scenario();
 try{
  const first=await x.rolling.create({
   title:'Morning inspection',startsOn:'2026-10-13',endsOn:'2026-10-15',
   port:'Jebel Ali'},'officer@moei');
  const second=await x.rolling.create({
   title:'Afternoon inspection',startsOn:'2026-10-13',endsOn:'2026-10-15'},'officer@moei');
  assert.equal(x.c01Calls(),0,'opening/planning never incurs AI costs');
  assert.equal((await x.plan.snapshot(first.id)).selectedForPlan,null);
  assert.equal((await x.plan.snapshot(second.id)).selectedForPlan,null);
  const pre=await x.plan.snapshot(first.id);
  const selected=await x.plan.rerank({planId:first.id,actor:'officer@moei',
   expectedSourceHash:pre.sourceHash,expectedRevision:pre.revision,
   confirmRun:true,confirmCost:false});
  assert.equal(selected.selectedForPlan,1);
  assert.equal(x.c01Calls(),1,'only explicit C01 rerank runs AI mock');
  assert.equal((await x.rolling.get(second.id)).status,'DRAFT');
  const preview=await x.bulk.preview(first.id);
  assert.equal(preview.selectedVessels,1);
  assert.equal(preview.vessels[0].reasons[0].eventKey,SOURCE);
  assert.equal(preview.planNumber,first.number);
  const job=await x.bulk.approve({planId:first.id,actor:'supervisor@moei',
   reason:'Validated vessel and source event with supporting evidence',
   expectedRevision:preview.planRevision,
   expectedSourceHash:preview.sourceHash,
   expectedAgentRunId:preview.agentRunId,confirmApproval:true,
   generateA04:false,runP01:false,confirmAiCost:false});
  assert.equal(job.status,'QUEUED');
  assert.equal(x.cases.length,0,'human approval queued but not executed');
  await x.queue.shift()();
  const result=x.bulk.get(job.id);
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.rollingPlanId,first.id);
  assert.equal(x.cases.length,1);
  assert.equal(x.cases[0].approvedPlanId,job.id);
  assert.equal((await x.rolling.get(first.id)).status,'IN_EXECUTION');
  assert.equal((await x.rolling.get(first.id)).approvedVessels[0].caseId,CASE_ID);
  // Tomorrow's source data must NOT make the previously approved plan vanish.
  const history=await x.plan.snapshot(first.id);
  assert.equal(history.readOnlyHistorical,true);
  assert.equal(history.historicalSourceChanged,true);
  assert.equal(history.selectedForPlan,1);
  assert.equal(history.rows[0].imo,IMO);
  const newPlan=await x.rolling.create({
   title:'Next day plan',startsOn:'2026-10-14',endsOn:'2026-10-16'},'officer@moei');
  const tomorrow=await x.plan.snapshot(newPlan.id);
  assert.equal(tomorrow.agentRunId,null);
  assert.equal(tomorrow.selectedForPlan,null);
  assert.equal(x.c01Calls(),1,'new day does not automatically run AI');
  assert.equal((await x.rolling.get(second.id)).status,'DRAFT',
   'earlier unfinished independent plan unaffected');
  assert.equal((await x.rolling.get(first.id)).approvedVessels[0]
   .inspectionReasons[0].eventKey,SOURCE);
  await x.rolling.completeIfAllClosed(CASE_ID,'supervisor@moei',{
   list:async()=>({cases:[{id:CASE_ID,stage:'CLOSED'}]})
  });
  assert.equal((await x.rolling.get(first.id)).status,'COMPLETED');
  await assert.rejects(
   x.rolling.cancel(first.id,(await x.rolling.get(first.id)).revision,
    'supervisor@moei','Closing approved plan manually'),
   /SI_ROLLING_APPROVED_PLAN_IMMUTABLE/);
 }finally{x.cleanup();}
});
