import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';
import {SiAiPrioritization,SiPriorityError,buildSiPrioritySnapshot,validateP01}
  from '../si-ai-prioritization.mjs';

const vessels=Array.from({length:420},(_,i)=>({
  imo:String(9100000+i),
  inlineContext:{vessel:{name:'MOEI POC Vessel '+i,flag:'UAE',vesselType:'CARGO'}}
}));
const referral={id:'3e0b4d64-5421-47c5-a06b-b37c6dd40c23',
  caseId:'b2014003-4e08-4e97-adf6-1a2240032123',
  imo:vessels[1].imo,status:'PENDING_SCHEDULING',
  caseStatus:'IN_PROGRESS',createdAt:'2026-10-10T09:00:00Z',
  reason:'Supervisor-approved NMC referral',evidenceIds:['NMC-E-1'],
  sourceAssessmentId:'SAVE-02'};
const projection=[{imo:vessels[0].imo,riskScore:85,riskLevel:'Critical',
  sourceAssessmentId:'SAVE-01',policyRevision:2}];
const source=(id='SR-01',imo=vessels[0].imo)=>({
  sourceType:'SERVICE_REQUEST',sourceEventId:id,sourceReference:'SVC-'+id,imo,
  requestedRegime:'UAE_SERVICE_INSPECTION',port:'Jebel Ali',
  sourceApprovalStatus:'UNVERIFIED',provenance:'POC_SIMULATOR',
  evidenceIds:[],createdBy:'Operator'
});
const okResponse=input=>({recommendations:input.candidates.map((c,i)=>({
  candidateKey:c.candidateKey,suggestedRank:input.candidates.length-i,
  rationale:'Source-ref backed recommendation for operator review',
  evidenceRefs:[c.allowedEvidence[0]],dataGaps:c.missingData,confidence:.84
}))});
function context({enabled=true,output=okResponse}={}){
  const dir=mkdtempSync(join(tmpdir(),'si-p01-'));
  const targeting=new SiCandidateTargeting({mode:'json',
    file:join(dir,'targeting.json'),bundles:vessels,
    cases:{listInspectionRequests:async()=>[referral]},
    riskPolicy:{ready:true,projectCurrent:async()=>({
      policyRevision:2,projections:projection
    })}});
  let calls=0;
  const prioritization=new SiAiPrioritization({targeting,mode:'json',
    file:join(dir,'p01.json'),enabled,clock:()=>Date.parse('2026-10-10T12:00:00Z'),
    executeAgent:async input=>{calls++;if(output instanceof Error)throw output;
      return typeof output==='function'?output(input):output;}});
  return {targeting,prioritization,calls:()=>calls,
    cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('preview is deterministic, saved-source-only and never calls P01',async()=>{
  const w=context();
  try{
    await w.targeting.receiveEvent(source());
    const preview=await w.prioritization.preview();
    assert.equal(preview.status,'RULE_PREVIEW_ONLY_NO_AI');
    assert.equal(preview.eligibleCount,2);
    assert.equal(preview.items[0].eligibility,'MANDATORY');
    assert.equal(preview.items[1].risk.score,85);
    assert.equal(preview.items[1].provisionalScore!==null,true);
    assert.deepEqual(preview.items[0].missingData.includes('MISSING_RISK'),true);
    assert.equal(preview.items[0].risk,null);
    assert.equal(w.calls(),0);
    assert.equal((await w.prioritization.status()).latest,null);
    assert.equal(w.calls(),0);
  }finally{w.cleanup();}
});
test('explicit single call persists AI rank but NMC-approved hard tier remains first',async()=>{
  const w=context();
  try{
    await w.targeting.receiveEvent(source());
    const p=await w.prioritization.preview();
    const run=await w.prioritization.run({
      actor:'Inspection Supervisor',confirmCost:true,
      expectedSnapshotHash:p.snapshotHash});
    assert.equal(w.calls(),1);
    assert.equal(run.status,'SUCCEEDED');
    assert.equal(run.recommendations.length,2);
    assert.equal(run.recommendations[0].imo,referral.imo);
    assert.equal(run.recommendations[0].effectiveRank,1);
    assert.equal(run.recommendations[1].effectiveRank,2);
    assert.equal(run.recommendations[0].status,'ADVISORY_HUMAN_REVIEW');
    assert.equal(run.recommendations[0].source,'AIRIA_SI_P01_UNVERIFIED_ADVISORY');
  }finally{w.cleanup();}
});
test('saved run is stable across refresh, never updates NMC or creates cases',async()=>{
  const w=context();
  try{
    await w.targeting.receiveEvent(source());
    const p=await w.prioritization.preview();
    const before=await w.targeting.dashboard();
    await w.prioritization.run({actor:'Auditor',confirmCost:true,expectedSnapshotHash:p.snapshotHash});
    const status=await w.prioritization.status();
    assert.equal(status.latest.isStale,false);
    assert.equal((await w.prioritization.history()).length,1);
    const after=await w.targeting.dashboard();
    assert.deepEqual(after.candidates,before.candidates);
    assert.equal(after.summary.inspectionsCreated,0);
    assert.equal(w.calls(),1);
  }finally{w.cleanup();}
});
test('stale fingerprint blocks paid call before execution and flags prior run',async()=>{
  const w=context();
  try{
    await w.targeting.receiveEvent(source());
    const p=await w.prioritization.preview();
    await w.targeting.receiveEvent(source('SR-02',vessels[2].imo));
    await assert.rejects(()=>w.prioritization.run({
      actor:'Officer',confirmCost:true,expectedSnapshotHash:p.snapshotHash
    }),e=>e.code==='SI_P01_SOURCE_CHANGED_REPREVIEW');
    assert.equal(w.calls(),0);
    const newer=await w.prioritization.preview();
    assert.notEqual(p.snapshotHash,newer.snapshotHash);
    await w.prioritization.run({actor:'Officer',confirmCost:true,
      expectedSnapshotHash:newer.snapshotHash});
    await w.targeting.publishRules({expectedVersion:1,publishedBy:'Supervisor',
      reason:'Change published priority weight',
      config:{riskPriorityThreshold:65,includeMissingRiskInReview:true,
        prioritization:{weights:{risk:25,trigger:25,history:25,deadline:15,urgency:10},
          approvedNmcFirst:true,missingRiskAction:'REVIEW_REQUIRED'}}});
    assert.equal((await w.prioritization.status()).latest.isStale,true);
    assert.equal(w.calls(),1);
  }finally{w.cleanup();}
});
test('disabled, no consent, malformed output and fabricated refs fail closed',async()=>{
  const w=context({enabled:false});
  try{
    const p=await w.prioritization.preview();
    await assert.rejects(()=>w.prioritization.run({actor:'Officer',
      confirmCost:true,expectedSnapshotHash:p.snapshotHash}),e=>e.code==='SI_P01_NOT_ENABLED');
    assert.equal(w.calls(),0);
  }finally{w.cleanup();}
  const f=context({output:input=>({
    recommendations:input.candidates.map((c,i)=>({
      candidateKey:c.candidateKey,suggestedRank:i+1,
      rationale:'Unverifiable AI recommendation without actual source evidence',
      evidenceRefs:['FABRICATED_DOCUMENT'],dataGaps:[],confidence:.9
    }))
  })});
  try{
    const p=await f.prioritization.preview();
    await assert.rejects(()=>f.prioritization.run({actor:'Officer',
      confirmCost:false,expectedSnapshotHash:p.snapshotHash}),
      e=>e.code==='SI_P01_EXPLICIT_CONFIRMATION_REQUIRED');
    assert.equal(f.calls(),0);
    await assert.rejects(()=>f.prioritization.run({actor:'Officer',
      confirmCost:true,expectedSnapshotHash:p.snapshotHash}),
      e=>e.code==='SI_P01_UNVERIFIED_RECOMMENDATION');
    assert.equal(f.calls(),1);
    const [latest]=await f.prioritization.history();
    assert.equal(latest.status,'FAILED');
    assert.equal(latest.recommendations.length,0);
  }finally{f.cleanup();}
});
test('missing-saved-risk cannot be represented as risk zero or fake assessment',async()=>{
  const w=context();
  try{
    const p=await w.prioritization.preview();
    assert.equal(p.items.length,1);
    assert.equal(p.items[0].risk,null);
    assert.ok(p.items[0].missingData.includes('MISSING_RISK'));
    assert.equal(p.items[0].factors.find(f=>f.key==='risk').contribution,null);
    assert.ok(p.items[0].allowedEvidence.includes(referral.id));
  }finally{w.cleanup();}
});
test('settings reject invalid weights, and new publish retains unchanged source risk',async()=>{
  const w=context();
  try{
    await assert.rejects(()=>w.targeting.publishRules({
      expectedVersion:1,publishedBy:'Supervisor',reason:'Invalid percentage sum',
      config:{riskPriorityThreshold:65,includeMissingRiskInReview:true,
        prioritization:{weights:{risk:99,trigger:25,history:20,deadline:15,urgency:10},
          approvedNmcFirst:true,missingRiskAction:'REVIEW_REQUIRED'}}
    }),e=>e.code==='SI_POLICY_INPUT_INVALID');
    const before=await w.targeting.dashboard();
    const out=await w.targeting.publishRules({
      expectedVersion:1,publishedBy:'Supervisor',reason:'Approved new weighting mix',
      config:{riskPriorityThreshold:70,includeMissingRiskInReview:true,
        prioritization:{weights:{risk:25,trigger:25,history:25,deadline:15,urgency:10},
          approvedNmcFirst:true,missingRiskAction:'REVIEW_REQUIRED'}}
    });
    assert.equal(out.config.prioritization.weights.history,25);
    assert.deepEqual((await w.targeting.dashboard()).candidates[0].currentRisk,
      before.candidates[0].currentRisk);
    assert.equal(w.calls(),0);
  }finally{w.cleanup();}
});
