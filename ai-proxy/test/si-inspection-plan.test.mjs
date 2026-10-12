import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectInspectionPlan,SiInspectionPlan} from '../si-inspection-plan.mjs';

const imoNmc='9328471',imoPsc='9400409',imoServ='9702281',imoApproved='9438124';
const mkVessel=(imo,source,risk,created=0)=>({
 imo,vesselName:'Test Vessel '+imo,flag:'AE',vesselType:'Cargo',
 sourceTypes:[source],regimes:['FOCUSED_INSPECTION'],
 sourceEvents:[{sourceType:source,approval:'APPROVED',
   eventKey:'EV-'+imo,sourceReference:'CASE-'+imo,evidenceIds:['EV-'+imo]}],
 currentRisk:risk===null?null:{score:risk,level:'High',assessmentId:'A-'+imo,policyRevision:2},
 candidateKeys:[imo],pendingWorkflows:created?0:1,createdWorkflows:created,
 scheduledWorkflows:0
});
const sample=()=>[
 mkVessel(imoNmc,'NMC_CASE',90),
 mkVessel(imoPsc,'PSC_PORT_CALL',null),
 mkVessel(imoServ,'SERVICE_REQUEST',35),
 mkVessel(imoApproved,'NMC_CASE',81,1)
];
const dashboard=()=>({vesselCandidates:sample(),
 summary:{inspectionsCreated:1,candidateVessels:4},policy:{version:1}});
const source=()=>({snapshotHash:'a'.repeat(64),
 candidates:sample().filter(v=>v.pendingWorkflows>0).map(v=>({
  candidateKey:v.imo,imo:v.imo,regime:'FOCUSED_INSPECTION',
  sourceTypes:v.sourceTypes,currentRisk:v.currentRisk,
  allowedEvidence:['EV-'+v.imo]
 }))});
const advice=()=>({
 status:'ADVISORY_REVIEW_REQUIRED',agentRunId:'run-test',provider:'MOCK',
 mock:true,externalCalls:0,generatedAt:'2026-10-12T00:00:00Z',
 snapshotHash:'a'.repeat(64),
 recommendations:[
  {candidateKey:imoNmc,imo:imoNmc,regime:'FOCUSED_INSPECTION',
   recommendation:'SELECT_RECOMMENDED',confidence:.8,
   suggestedRank:1,priorityRationale:'MOCK NMC risk assessment evidence.',
   reason:'Approved NMC referral with valid risk.',evidenceRefs:['EV-'+imoNmc],dataGaps:[]},
  ...[imoPsc,imoServ].map(imo=>({
   candidateKey:imo,imo,regime:'FOCUSED_INSPECTION',
   recommendation:'MANUAL_REVIEW',confidence:.8,suggestedRank:null,
   priorityRationale:'No automatic selection before officer review.',
   reason:'Source remains in manual review.',evidenceRefs:['EV-'+imo],
   dataGaps:imo===imoPsc?['NO_NMC_RISK']:[]
  }))
 ]
});
const testEnv=()=>{const dir=mkdtempSync(join(tmpdir(),'si-plan-test-'));
 const file=join(dir,'plan.json');const calls=[];
 const candidateAgent={
  provider:'mock',
  source:async()=>source(),
  run:async input=>{calls.push(input);return advice();}
 };
 const plan=new SiInspectionPlan({targeting:{dashboard:async()=>dashboard()},
  candidateAgent,file});
 return {plan,file,calls,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
};
const request=(snapshot,change)=>({
 actor:'officer-test',expectedSourceHash:snapshot.sourceHash,
 expectedRevision:snapshot.revision,confirmRun:true,confirmCost:false,
 ...(change?{change}:{})
});

test('GET plan: source-backed all vessel rows, no automatic C01 call or invented zero',async()=>{
 const e=testEnv();
 try{
  const s=await e.plan.snapshot();
  assert.equal(s.rows.length,4);
  assert.equal(s.aiRecommendedVessels,null);
  assert.equal(s.selectedForPlan,null);
  assert.equal(s.externalCallsOnRead,0);
  assert.equal(s.approvedCases,1);
  assert.equal(e.calls.length,0);
  assert.equal(existsSync(e.file),false);
 }finally{e.cleanup();}
});
test('C01 initial confirmed MOCK run persists one vessel row/IMO and protected NMC rank',async()=>{
 const e=testEnv();
 try{
  const before=await e.plan.snapshot();
  const r=await e.plan.rerank(request(before));
  assert.equal(r.mock,true);
  assert.equal(r.externalCalls,0);
  assert.equal(r.aiRecommendedVessels,1);
  assert.equal(r.selectedForPlan,1);
  assert.equal(r.rows.find(x=>x.imo===imoNmc).effectiveRank,1);
  assert.equal(r.rows.find(x=>x.imo===imoApproved).editable,false);
  assert.equal(r.rows.find(x=>x.imo===imoPsc).risk,null);
  const current=await e.plan.snapshot();
  assert.equal(current.revision,1);
  assert.equal(current.aiRecommendedVessels,1);
  assert.equal(e.calls.length,1);
 }finally{e.cleanup();}
});
test('officer includes unselected PSC vessel then C01 re-ranks but respects protected NMC',async()=>{
 const e=testEnv();
 try{
  await e.plan.rerank(request(await e.plan.snapshot()));
  const out=await e.plan.rerank(request(await e.plan.snapshot(),{
   imo:imoPsc,selected:true,requestedRank:1,reason:'Officer wishes to examine arriving PSC vessel'
  }));
  assert.equal(out.rows.find(x=>x.imo===imoPsc).planSelected,true);
  assert.equal(out.rows.find(x=>x.imo===imoPsc).selectionOrigin,'OFFICER_AMENDED');
  assert.equal(out.rows.find(x=>x.imo===imoNmc).effectiveRank,1);
  assert.equal(out.rows.find(x=>x.imo===imoPsc).effectiveRank,2);
  assert.equal(out.aiRecommendedVessels,1);
  assert.equal(out.selectedForPlan,2);
  assert.equal(e.calls.length,2,'one explicit C01 rerun per confirmed operation');
  assert.equal(e.calls[1].officerPlanChanges[0].imo,imoPsc);
  assert.equal(e.calls[1].officerPlanChanges[0].requestedRank,1);
  assert.match(e.calls[1].officerPlanChanges[0].reason,/Officer wishes/);
  const saved=JSON.parse(readFileSync(e.file,'utf8'));
  assert.equal(saved.audit[1].change.reason,'Officer wishes to examine arriving PSC vessel');
 }finally{e.cleanup();}
});
test('officer can remove selected AI vessel without pretending original legal referral is deleted',async()=>{
 const e=testEnv();
 try{
  await e.plan.rerank(request(await e.plan.snapshot()));
  const out=await e.plan.rerank(request(await e.plan.snapshot(),{
   imo:imoNmc,selected:false,requestedRank:null,
   reason:'Officer documents conflicting arrival schedule'
  }));
  assert.equal(out.aiRecommendedVessels,1);
  assert.equal(out.selectedForPlan,0);
  const removed=out.rows.find(x=>x.imo===imoNmc);
  assert.equal(removed.aiRecommended,true);
  assert.equal(removed.planSelected,false);
  assert.equal(out.humanApprovalStillRequired,true);
  assert.equal((await e.plan.snapshot()).approvedCases,1);
 }finally{e.cleanup();}
});
test('rank edits are versioned and no stale/unknown/invalid candidate writes',async()=>{
 const e=testEnv();
 try{
  const first=await e.plan.snapshot();
  await assert.rejects(e.plan.rerank({...request(first),confirmRun:false}),
   /SI_PLAN_CONFIRMATION_REQUIRED/);
  const wrong=await e.plan.snapshot();
  for(const change of [
   {imo:'0000000',selected:true,requestedRank:2,reason:'Random fabricated vessel'},
   {imo:imoPsc,selected:true,requestedRank:-1,reason:'Invalid negative priority'},
   {imo:imoPsc,selected:true,requestedRank:1,reason:'short'}
  ])await assert.rejects(e.plan.rerank(request(wrong,change)));
  assert.equal(existsSync(e.file),false);
  await e.plan.rerank(request(first));
  await assert.rejects(e.plan.rerank(request(first)),/SI_PLAN_CHANGED_REFRESH_REQUIRED/);
  assert.equal(e.calls.length,1);
 }finally{e.cleanup();}
});
test('backend fail closed on paid provider without separate cost confirmation',async()=>{
 const e=testEnv();
 try{
  e.plan.agent.provider='airia';
  await assert.rejects(e.plan.rerank(request(await e.plan.snapshot())),
   /SI_PLAN_CONFIRMATION_REQUIRED/);
  assert.equal(e.calls.length,0);
  assert.equal(existsSync(e.file),false);
 }finally{e.cleanup();}
});
test('provider error never writes officer override: no misleading successful recommendation',async()=>{
 const e=testEnv();
 try{
  await e.plan.rerank(request(await e.plan.snapshot()));
  const before=await e.plan.snapshot();
  e.plan.agent.run=async()=>{throw new Error('PROVIDER_UNAVAILABLE')};
  await assert.rejects(e.plan.rerank(request(before,{
   imo:imoPsc,selected:true,requestedRank:1,
   reason:'Officer requests manual inclusion after port evidence'
  })),/PROVIDER_UNAVAILABLE/);
  const after=await e.plan.snapshot();
  assert.equal(after.revision,before.revision);
  assert.equal(after.selectedForPlan,before.selectedForPlan);
  assert.equal(JSON.parse(readFileSync(e.file,'utf8')).audit.length,1);
 }finally{e.cleanup();}
});
test('missing source assessment and multiple inspection regimes never become false AI selection',()=>{
 const d=dashboard(),src=source(),r=advice();
 d.vesselCandidates[1].candidateKeys=['p1','p2'];
 const rows=projectInspectionPlan(d,src,r,{});
 assert.equal(rows.length,4,'one vessel per IMO');
 assert.equal(rows.find(x=>x.imo===imoPsc).risk,null);
 assert.equal(rows.find(x=>x.imo===imoPsc).aiRecommended,false);
 assert.equal(rows.find(x=>x.imo===imoPsc).effectiveRank,null);
});
