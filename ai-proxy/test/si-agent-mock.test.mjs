import test from 'node:test';
import assert from 'node:assert/strict';
import {buildC01Source,validateC01,SiCandidateAgent} from '../si-candidate-agent.mjs';
import {mockSiC01,mockSiP01,mockSiA04} from '../si-agent-mock.mjs';
import {validateP01} from '../si-ai-prioritization.mjs';
import {validateA04} from '../si-inspection-preparation.mjs';

const candidate=(key,sourceType,imo,score)=>({
 key,imo,vesselName:'POC Vessel',regime:'FOCUSED_INSPECTION',
 status:'PENDING_REVIEW',inspectionCase:null,
 eligibility:sourceType==='NMC_CASE'?'MANDATORY':'MANUAL_REVIEW',
 priority:'STANDARD',reasons:[],currentRisk:score===null?null:
 {score,level:'High',assessmentId:'assessment-'+imo,policyRevision:2},
 events:[{eventKey:'evt-'+key,sourceEventId:'id-'+key,
  sourceReference:'ref-'+key,sourceType,
  provenance:'SYNTHETIC_POC',approval:'APPROVED',evidenceIds:['ev-'+key]}]
});
const inputs=()=>({
 policy:{version:3},riskPolicyRevision:2,fleetSnapshotId:'fleet-a',
 candidates:[
  candidate('nmc','NMC_CASE','9328471',81),
  candidate('psc','PSC_PORT_CALL','9400409',null),
  {...candidate('approved','NMC_CASE','9438124',62),status:'INSPECTION_CREATED'}
 ]
});
const agent=(targeting=()=>inputs())=>new SiCandidateAgent({
 targeting:{dashboard:async()=>targeting()},
 pscPolicy:async()=>({version:6}),
 provider:'mock',executeAgent:async body=>mockSiC01(body)
});
test('C01 no-cost preview uses only unapproved real source candidates',async()=>{
 const p=await agent().preview();
 assert.equal(p.status,'PREVIEW_ONLY_NO_AI');
 assert.equal(p.externalCalls,0);
 assert.equal(p.provider,'MOCK');
 assert.equal(p.eligibleCount,2);
 assert.equal(p.pscQuotaPolicyRevision,6);
 assert.ok(p.candidates.every(c=>c.candidateKey!=='approved'));
 assert.equal(p.snapshotHash.length,64);
});
test('C01 returns stable advisory without approving cases or Airia',async()=>{
 const a=agent(),p=await a.preview();
 const r=await a.run({actor:'reviewer',confirmRun:true,
  expectedSnapshotHash:p.snapshotHash});
 assert.equal(r.provider,'MOCK');
 assert.equal(r.externalCalls,0);
 assert.equal(r.mutations,false);
 assert.equal(r.humanDecisionRequired,true);
 assert.equal(r.recommendations.length,2);
 assert.equal(r.recommendations.find(x=>x.candidateKey==='nmc').recommendation,'SELECT_RECOMMENDED');
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').recommendation,'MANUAL_REVIEW');
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').dataGaps[0],'MISSING_NMC_SAVED_RISK');
});
test('C01 never fabricates risk 0 for missing saved assessment',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const r=mockSiC01(source);
 assert.equal(r.recommendations.find(x=>x.candidateKey==='psc').recommendation,'MANUAL_REVIEW');
 assert.equal(source.candidates.find(c=>c.candidateKey==='psc').currentRisk,null);
});
test('C01 rejects stale snapshot before any external request',async()=>{
 let snapshot=inputs(),calls=0;
 const a=new SiCandidateAgent({targeting:{dashboard:async()=>snapshot},
  provider:'mock',executeAgent:async b=>{calls++;return mockSiC01(b)}});
 const preview=await a.preview();
 snapshot={...snapshot,policy:{version:4}};
 await assert.rejects(a.run({actor:'reviewer',confirmRun:true,
   expectedSnapshotHash:preview.snapshotHash}),/SI_C01_SOURCE_CHANGED_REPREVIEW/);
 assert.equal(calls,0);
});
test('C01 input must explicitly authorize even a free mock run',async()=>{
 const a=agent(),p=await a.preview();
 await assert.rejects(a.run({actor:'rev',expectedSnapshotHash:p.snapshotHash}),
  /SI_C01_CONFIRMATION_REQUIRED/);
});
test('C01 Airia mode requires separate paid-cost confirmation',async()=>{
 let calls=0;
 const a=new SiCandidateAgent({targeting:{dashboard:async()=>inputs()},provider:'airia',
  executeAgent:async p=>{calls++;return mockSiC01(p)}});
 const p=await a.preview();
 await assert.rejects(a.run({actor:'rev',confirmRun:true,
  expectedSnapshotHash:p.snapshotHash}),/SI_C01_CONFIRMATION_REQUIRED/);
 assert.equal(calls,0);
});
test('C01 fails closed on unknown evidence, duplicate candidates, and regulatory override',()=>{
 const source=buildC01Source(inputs(),{version:6});
 const valid=mockSiC01(source);
 const forged=structuredClone(valid);
 forged.recommendations[0].evidenceRefs=['invented'];
 assert.throws(()=>validateC01(forged,source),/SI_C01_UNVERIFIED_RECOMMENDATION/);
 const repeated=structuredClone(valid);
 repeated.recommendations[1].candidateKey='nmc';
 assert.throws(()=>validateC01(repeated,source),/SI_C01_UNVERIFIED_RECOMMENDATION/);
 const illegal=structuredClone(valid);
 illegal.recommendations[1].recommendation='SELECT_RECOMMENDED';
 illegal.recommendations[1].suggestedRank=2;
 assert.throws(()=>validateC01(illegal,source),/SI_C01_HARD_RULE_OVERRIDE/);
});
test('P01 MOCK response passes unchanged existing validator, without model calls',()=>{
 const input={schemaVersion:'SI-P01-v1',candidates:[
 {candidateKey:'one',allowedEvidence:['EV1'],missingData:[]},
 {candidateKey:'two',allowedEvidence:['EV2'],missingData:['MISSING_HISTORY']}
 ]};
 const result=validateP01(mockSiP01(input),input.candidates);
 assert.deepEqual(result.map(x=>x.suggestedRank),[1,2]);
 assert.equal(result[1].evidenceRefs[0],'EV2');
 assert.equal(result[1].status,'ADVISORY_HUMAN_REVIEW');
});
test('A04 MOCK passes existing model response validator; optional item never mandatory',()=>{
 const input={baseChecklistItemIds:['fire-safety','certificates'],
  evidenceManifestRefs:['EV1','EV2']};
 const r=validateA04(mockSiA04(input),{checkIds:input.baseChecklistItemIds,
  evidenceIds:input.evidenceManifestRefs});
 assert.equal(r.suggestedAdditionalItems.length,1);
 assert.equal(r.suggestedAdditionalItems[0].recommendationOnly,true);
 assert.equal(r.predictedDeficiencies.length,0);
 assert.equal(r.requiresInspectorReview,true);
 assert.equal(r.status,'DRAFT_REVIEW');
});
test('C01 preview is deterministic for identical current evidence',()=>{
 const a=buildC01Source(inputs(),{version:1}),b=buildC01Source(inputs(),{version:1});
 assert.equal(a.snapshotHash,b.snapshotHash);
 assert.notEqual(a.snapshotHash,buildC01Source(inputs(),{version:2}).snapshotHash);
});
