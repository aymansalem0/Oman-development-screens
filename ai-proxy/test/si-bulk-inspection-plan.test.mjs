import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiBulkInspectionPlan} from '../si-bulk-inspection-plan.mjs';

const mk=({multiple=false,risk=true}={})=>{
 const dir=mkdtempSync(join(tmpdir(),'si-bulk-'));
 const queue=[],cases=[],preparations=new Map(),agentCalls=[];
 const selected=[{imo:'9328471',vesselName:'Vessel One',effectiveRank:1,planSelected:true},
  {imo:'9400409',vesselName:'Vessel Two',effectiveRank:2,planSelected:true}];
 const candidate=(imo,regime,key)=>({
  key,imo,regime,status:'PENDING_REVIEW',
  events:[{sourceType:'NMC_CASE',approval:'APPROVED'}]
 });
 const candidates=[
  candidate('9328471','FOCUSED_INSPECTION','candidate-one'),
  candidate('9400409','PORT_STATE_CONTROL','candidate-two'),
  ...(multiple?[candidate('9400409','UAE_SERVICE_INSPECTION','candidate-three')]:[])
 ];
 let snapshotHash='source-one',revision=3;
 const plan={snapshot:async()=>({stale:false,agentRunId:'C01-RUN-101',
  sourceHash:snapshotHash,revision,generatedAt:'2026-10-12T10:00:00Z',
  provider:'MOCK',rows:selected})};
 const targeting={
  dashboard:async()=>({candidates}),
  inspectionCaseRegistry:async()=>({cases:[...cases]}),
  decideBatch:async({items,actor,approvedPlanId})=>{
   // All cases become visible together, matching Oracle transaction semantics.
   const created=items.map(payload=>{
    const matching=candidates.find(c=>c.key===payload.candidateKey);
    assert.equal(matching?.imo,payload.imo);
    const existing=cases.find(c=>c.candidateKey===payload.candidateKey);
    if(existing)throw Error('DUPLICATE_CASE');
    return {id:'case-'+payload.imo,imo:payload.imo,
     regime:matching.regime,candidateKey:payload.candidateKey,
     approvedBy:actor,approvedPlanId};
   });
   cases.push(...created);
   return {cases:created};
  }
 };
 const preparation={
  enabled:true,ready:true,provider:'mock',
  get:async id=>({saved:preparations.get(id)||null,stale:false}),
  prepare:async(id,{actor,expectedVersion})=>{
   assert.equal(expectedVersion,0);
   const record={caseId:id,status:'PREPARED',version:1,actor};
   preparations.set(id,record);
   return {saved:record};
  },
  generate:async(id,{actor,expectedVersion,confirmCost})=>{
   agentCalls.push({agent:'A04',id});
   assert.equal(expectedVersion,1);
   assert.equal(confirmCost,true);
   assert.equal(actor,'test.supervisor');
   const record={caseId:id,status:'DRAFT_REVIEW',version:3};
   preparations.set(id,record);
   return {saved:record};
  }
 };
 const priority={enabled:true,ready:true,provider:'mock',
  preview:async()=>({snapshotHash:'approved-cases-hash',eligibleCount:cases.length}),
  run:async()=>{agentCalls.push({agent:'P01'});return {status:'SUCCEEDED'};}};
 const si=new SiBulkInspectionPlan({inspectionPlan:plan,targeting,preparation,priority,
  file:join(dir,'batches.json'),submitTask:fn=>queue.push(fn)});
 const settings={reason:'Reviewed saved NMC evidence and approved plan as a batch.',
  expectedSourceHash:'source-one',expectedRevision:3,
  expectedAgentRunId:'C01-RUN-101',confirmApproval:true,
  generateA04:true,runP01:true,confirmAiCost:false,
  choices:[{imo:'9328471',candidateKey:'candidate-one'},
   {imo:'9400409',candidateKey:'candidate-two'}]};
 return {si,cases,preparations,queue,settings,agentCalls,
  invalidate:()=>{snapshotHash='changed-source';revision++;},
  done:()=>rmSync(dir,{recursive:true,force:true})};
};
test('one batch approval creates two traceable cases and two A04 drafts; P01 once',async()=>{
 const t=mk();try{
  const preview=await t.si.preview();
  assert.equal(preview.selectedVessels,2);
  assert.equal(preview.vessels.every(v=>v.defaultCandidateKey!==null),true);
  assert.equal(t.agentCalls.length,0);
  const job=await t.si.approve(t.settings);
  assert.equal(job.status,'QUEUED');
  assert.equal(t.cases.length,0,'HTTP approval only accepts async job');
  await t.queue.shift()();
  const result=t.si.get(job.id);
  assert.equal(result.status,'COMPLETED');
  assert.equal(result.approvedCount,2);
  assert.equal(t.cases.length,2);
  assert.equal(result.items.every(x=>x.dossierStatus==='PREPARED'),true);
  assert.equal(t.cases.every(x=>x.approvedPlanId===job.id),true);
  assert.equal(result.items.every(x=>x.aiDossierStatus==='DRAFT_REVIEW'),true);
  assert.equal(t.agentCalls.filter(x=>x.agent==='A04').length,2);
  assert.equal(t.agentCalls.filter(x=>x.agent==='P01').length,1);
  const duplicate=await t.si.approve(t.settings).catch(e=>e.code);
  // First saved action invalidates the saved C01 snapshot on a real source.
  // Synthetic stub does not change it, so dedupe returns the same batch.
  assert.equal(duplicate.id,job.id);
  assert.equal(t.queue.length,0);
 }finally{t.done()}
});
test('a stale plan, incomplete selection or mismatched candidate is rejected before any write',async()=>{
 const t=mk({multiple:true});try{
  const p=await t.si.preview();
  assert.equal(p.vessels[1].requiresRegimeChoice,true);
  await assert.rejects(t.si.approve({...t.settings,
   choices:t.settings.choices.slice(0,1)}),/SI_BULK_SELECTION_INCOMPLETE/);
  await assert.rejects(t.si.approve({...t.settings,choices:[
   t.settings.choices[0],{imo:'9400409',candidateKey:'random-other-regime'}
  ]}),/SI_BULK_CANDIDATE_NOT_ELIGIBLE/);
  t.invalidate();
  await assert.rejects(t.si.approve(t.settings),/SI_BULK_SNAPSHOT_CHANGED_REVIEW_AGAIN/);
  assert.equal(t.cases.length,0);
 }finally{t.done()}
});
test('no automatic Airia charges without explicit batch cost confirmation',async()=>{
 const t=mk();try{
  t.si.preparation.provider='airia';
  t.si.priority.provider='airia';
  await assert.rejects(t.si.approve(t.settings),
   /SI_BULK_EXPLICIT_AI_COST_CONFIRMATION_REQUIRED/);
  assert.equal(t.cases.length,0);
  const safe=await t.si.approve({...t.settings,generateA04:false,runP01:false});
  await t.queue.shift()();
  assert.equal(t.si.get(safe.id).status,'COMPLETED');
  assert.equal(t.agentCalls.length,0);
  assert.equal(t.preparations.size,2);
 }finally{t.done()}
});
test('no available cases means no fake batch approval',async()=>{
 const t=mk();try{
  t.si.plan.snapshot=async()=>({stale:true,sourceHash:'different',revision:6,
   agentRunId:'C01-RUN-101',provider:'MOCK',rows:[]});
  const preview=await t.si.preview();
  assert.equal(preview.selectedVessels,0);
  assert.equal(preview.stale,true);
  await assert.rejects(t.si.approve(t.settings),
   /SI_BULK_SNAPSHOT_CHANGED_REVIEW_AGAIN/);
  assert.equal(t.cases.length,0);
 }finally{t.done()}
});
test('failure after one Oracle case is visible as partial and never silently undone',async()=>{
 const t=mk();try{
  const original=t.si.preparation.get;
  t.si.preparation.get=async id=>{
   if(id==='case-9400409')throw Object.assign(Error('missing migration'),{code:'SI_MIGRATION_010_REQUIRED'});
   return original(id);
  };
  const job=await t.si.approve(t.settings);
  await t.queue.shift()();
  const result=t.si.get(job.id);
  assert.equal(result.status,'PARTIAL');
  assert.equal(result.approvedCount,2);
  assert.equal(result.items[1].state,'PREPARATION_FAILED');
  assert.equal(result.items[1].inspectionCaseId,'case-9400409');
  assert.equal(result.items[1].error,'SI_MIGRATION_010_REQUIRED');
 }finally{t.done()}
});
