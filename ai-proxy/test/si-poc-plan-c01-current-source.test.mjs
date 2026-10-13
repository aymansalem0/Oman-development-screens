import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SiCandidateAgent} from '../si-candidate-agent.mjs';
import {mockSiC01} from '../si-agent-mock.mjs';
import {SiInspectionPlan} from '../si-inspection-plan.mjs';
import {SiRollingPlanStore} from '../si-rolling-plan-store.mjs';

test('C01 on newly created plan only evaluates vessels currently in genuine pending source pool',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'si-c01-current-'));
 try{
  let currentImo='9328471',calls=0;
  const candidate=()=>({key:'evt-'+currentImo,imo:currentImo,
   vesselName:'MOEI POC '+currentImo,regime:'FOCUSED_INSPECTION',
   status:'PENDING_REVIEW',inspectionCase:null,eligibility:'MANDATORY',
   priority:'PRIORITY',reasons:['NMC_HUMAN_APPROVED_REFERRAL'],
   currentRisk:{score:85,level:'HIGH',assessmentId:'A-'+currentImo,
    policyRevision:2},
   events:[{eventKey:'NMC-'+currentImo,sourceType:'NMC_CASE',
    sourceEventId:'NMC-SOURCE-'+currentImo,sourceReference:'NMC-HUMAN-'+currentImo,
    provenance:'NMC_HUMAN_APPROVED',approval:'APPROVED',
    evidenceIds:['EVD-'+currentImo]}]});
  const targeting={dashboard:async()=>{
   const c=candidate();
   return {policy:{version:2,config:{sourceTriggerScores:{NMC_CASE:100,SERVICE_REQUEST:100,PSC_PORT_CALL:20}}},
    riskPolicyRevision:2,fleetSnapshotId:'TEST-FLEET-1',
    summary:{inspectionsCreated:0},candidates:[c],
    vesselCandidates:[{
     imo:c.imo,vesselName:c.vesselName,vesselType:'Tanker',flag:'AE',
     sourceTypes:['NMC_CASE'],sourceEvents:c.events,regimes:[c.regime],
     currentRisk:c.currentRisk,pendingWorkflows:1,createdWorkflows:0,
     scheduledWorkflows:0}]
   };
  }};
  const agent=new SiCandidateAgent({targeting,provider:'mock',
   executeAgent:async input=>{calls++;return mockSiC01(input)}});
  const rolling=new SiRollingPlanStore({mode:'json',file:join(dir,'plans.json')});
  const plan=new SiInspectionPlan({targeting,candidateAgent:agent,
   rollingPlans:rolling,file:join(dir,'legacy.json')});
  const make=async title=>{
   const data=await agent.source();
   return rolling.create({title,startsOn:'2026-10-13',endsOn:'2026-10-16'},
    'inspection-officer',{candidates:data.candidates,sourceHash:data.snapshotHash});
  };
  const a=await make('First source snapshot');
  assert.equal((await plan.snapshot(a.id)).availableCount,1);
  assert.equal(calls,0,'creating/opening drafts must not call provider');
  let s=await plan.snapshot(a.id);
  await plan.rerank({planId:a.id,expectedRevision:0,
   expectedSourceHash:s.sourceHash,actor:'inspection-officer',confirmRun:true});
  assert.equal(calls,1);
  assert.equal((await plan.snapshot(a.id)).rows.find(x=>x.planSelected).imo,'9328471');
  // New independent approved NMC referral arrives, old vessel no longer pending.
  currentImo='9400409';
  const b=await make('Today new pending vessel');
  s=await plan.snapshot(b.id);
  assert.equal(s.rows[0].imo,'9400409');
  assert.equal(s.availableCount,1);
  assert.equal(calls,1);
  const rec=await plan.rerank({planId:b.id,expectedRevision:0,
   expectedSourceHash:s.sourceHash,actor:'inspection-officer',confirmRun:true});
  assert.equal(rec.selectedForPlan,1);
  assert.deepEqual(rec.rows.filter(x=>x.planSelected).map(x=>x.imo),['9400409']);
  assert.ok(!rec.rows.some(x=>x.imo==='9328471'));
  assert.equal(calls,2);
  assert.equal((await rolling.get(a.id)).latest.rows[0].imo,'9328471',
   'previous plan history must preserve original selection');
  assert.equal((await rolling.get(b.id)).latest.rows[0].imo,'9400409');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
