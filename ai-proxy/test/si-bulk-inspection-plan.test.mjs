import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiBulkInspectionPlan} from '../si-bulk-inspection-plan.mjs';

function setup(){
 const dir=mkdtempSync(join(tmpdir(),'si-all-reasons-'));
 const queue=[],cases=[],dossiers=new Map(),ai=[];
 const rec=(key,imo,regime,source,eventKey)=>({
   key,imo,regime,status:'PENDING_REVIEW',
   events:[{eventKey,sourceType:source,sourceEventId:eventKey,
     sourceReference:source+'-REF-'+imo,approval:'APPROVED',
     contextNote:'Source-reported inspection reason for '+eventKey,
     evidenceIds:['evidence-'+eventKey],provenance:'POC_SIMULATOR'}]
 });
 const candidates=[
  rec('c1','9328471','FOCUSED_INSPECTION','NMC_CASE','NMC-1'),
  rec('c2','9400409','UAE_SERVICE_INSPECTION','SERVICE_REQUEST','SVC-2'),
  rec('c3','9400409','PORT_STATE_CONTROL','PSC_PORT_CALL','PSC-3')
 ];
 const rows=[
  {imo:'9328471',vesselName:'Desert Voyager',effectiveRank:1,planSelected:true},
  {imo:'9400409',vesselName:'Gulf Horizon',effectiveRank:2,planSelected:true}
 ];
 let sourceHash='saved-c01-hash',revision=4,planStale=false;
 const inspectionPlan={snapshot:async()=>({
  sourceHash,revision,stale:planStale,
  agentRunId:'C01-OPERATOR-4',rows,provider:'MOCK',
  generatedAt:'2026-10-13T08:00:00Z'
 })};
 const targeting={
  dashboard:async()=>({candidates}),
  inspectionCaseRegistry:async()=>({cases:[...cases]}),
  decideBatch:async({items,actor,approvedPlanId})=>{
   assert.equal(items.length,2);
   assert.equal(items[1].candidateKeys.length,2);
   assert.deepEqual(items[1].inspectionReasons.map(x=>x.sourceType),
    ['PSC_PORT_CALL','SERVICE_REQUEST']);
   assert.equal(items[1].inspectionReasons.length,2);
   const created=items.map(x=>({
    id:'CASE-'+x.imo,imo:x.imo,
    candidateKey:x.candidateKey,candidateKeys:x.candidateKeys,
    inspectionReasons:x.inspectionReasons,regimes:x.regimes,
    approvedBy:actor,approvedPlanId
   }));
   if(cases.length)throw Error('DUPLICATE_APPROVAL');
   cases.push(...created);
   return {cases:created};
  }
 };
 const preparation={
  enabled:true,ready:true,provider:'mock',
  get:async id=>({saved:dossiers.get(id)||null,stale:false}),
  prepare:async(id,{actor,expectedVersion})=>{
    assert.equal(actor,'test.supervisor');assert.equal(expectedVersion,0);
    const doc={caseId:id,status:'PREPARED',version:1};
    dossiers.set(id,doc);return {saved:doc};
  },
  generate:async(id,{expectedVersion,confirmCost})=>{
   assert.equal(expectedVersion,1);assert.equal(confirmCost,true);
   ai.push(['A04',id]);
   const doc={caseId:id,status:'DRAFT_REVIEW',version:2};
   dossiers.set(id,doc);return {saved:doc};
  }
 };
 const priority={
  enabled:true,ready:true,provider:'mock',
  preview:async()=>({eligibleCount:cases.length,snapshotHash:'risk-4'}),
  run:async()=>{ai.push(['P01']);return {status:'SUCCEEDED'};}
 };
 const bulk=new SiBulkInspectionPlan({inspectionPlan,targeting,preparation,priority,
  file:join(dir,'jobs.json'),submitTask:fn=>queue.push(fn)});
 const request={actor:'test.supervisor',
  reason:'All source reasons were reviewed before approving the plan.',
  expectedRevision:4,expectedSourceHash:'saved-c01-hash',
  expectedAgentRunId:'C01-OPERATOR-4',confirmApproval:true,
  generateA04:true,runP01:false,confirmAiCost:false};
 return {bulk,request,cases,dossiers,ai,queue,
  change:()=>{sourceHash='another-hash';revision++;},
  stale:()=>{planStale=true;},
  done:()=>rmSync(dir,{recursive:true,force:true})};
}
test('wizard preview includes every source reason, even 2 separate regimes for the same IMO',async()=>{
 const t=setup();
 try{
  const p=await t.bulk.preview();
  assert.equal(p.selectedVessels,2);
  assert.equal(p.vessels[1].reasons.length,2);
  assert.deepEqual(p.vessels[1].inspectionRegimes,['PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION']);
  assert.deepEqual(p.vessels[1].candidateKeys,['c3','c2']);
  assert.equal('options' in p.vessels[1],false);
  assert.equal('defaultCandidateKey' in p.vessels[1],false);
  assert.equal(t.ai.length,0,'read-only preview never calls AI');
 }finally{t.done()}
});
test('one supervisor approval creates one case per vessel with ALL reasons and two dossiers',async()=>{
 const t=setup();
 try{
  const accepted=await t.bulk.approve(t.request);
  assert.equal(accepted.status,'QUEUED');
  assert.equal(t.cases.length,0,'queued job has not committed decisions yet');
  await t.queue.shift()();
  const job=t.bulk.get(accepted.id);
  assert.equal(job.status,'COMPLETED');
  assert.equal(job.totalSelected,2);
  assert.equal(job.approvedCount,2);
  assert.equal(t.cases.length,2);
  assert.equal(t.cases[1].candidateKeys.length,2);
  assert.equal(t.cases[1].inspectionReasons.length,2);
  assert.equal(job.items[1].reasonCount,2);
  assert.equal(t.dossiers.size,2);
  assert.equal(t.ai.filter(x=>x[0]==='A04').length,2);
  assert.equal(t.ai.filter(x=>x[0]==='P01').length,0);
  const repeated=await t.bulk.approve(t.request);
  assert.equal(repeated.id,accepted.id);
  assert.equal(t.queue.length,0,'duplicate approval never enqueues a second batch');
 }finally{t.done()}
});
test('never accept an old plan or an API payload choosing only one source',async()=>{
 const t=setup();
 try{
  await assert.rejects(t.bulk.approve({...t.request,choices:[
    {imo:'9328471',candidateKey:'c1'},{imo:'9400409',candidateKey:'c2'}
  ]}),/SI_BULK_APPROVAL_INVALID/);
  t.change();
  await assert.rejects(t.bulk.approve(t.request),
    /SI_BULK_SNAPSHOT_CHANGED_REVIEW_AGAIN/);
  assert.equal(t.cases.length,0);
 }finally{t.done()}
});
test('explicit cost confirmation required for real Airia A04; P01 retired',async()=>{
 const t=setup();
 try{
  t.bulk.preparation.provider='airia';
  t.bulk.priority.provider='airia';
  await assert.rejects(t.bulk.approve({...t.request,generateA04:false,runP01:true}),
    /SI_P01_OUT_OF_CURRENT_POC_SCOPE/);
  await assert.rejects(t.bulk.approve(t.request),
    /SI_BULK_EXPLICIT_AI_COST_CONFIRMATION_REQUIRED/);
  const p=await t.bulk.approve({...t.request,generateA04:false,runP01:false});
  await t.queue.shift()();
  assert.equal(t.bulk.get(p.id).status,'COMPLETED');
  assert.equal(t.dossiers.size,2);assert.equal(t.ai.length,0);
 }finally{t.done()}
});
test('dossier failure is shown as PARTIAL, existing approved cases are not rolled back',async()=>{
 const t=setup();
 try{
  const original=t.bulk.preparation.get;
  t.bulk.preparation.get=async id=>{
   if(id==='CASE-9400409')throw Object.assign(Error('missing'),{code:'SI_MIGRATION_010_REQUIRED'});
   return original(id);
  };
  const accepted=await t.bulk.approve(t.request);
  await t.queue.shift()();
  const job=t.bulk.get(accepted.id);
  assert.equal(job.status,'PARTIAL');
  assert.equal(job.approvedCount,2);
  assert.equal(job.items[1].state,'PREPARATION_FAILED');
  assert.equal(job.items[1].error,'SI_MIGRATION_010_REQUIRED');
  assert.equal(t.cases.length,2);
 }finally{t.done()}
});
