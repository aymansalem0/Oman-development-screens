import test from 'node:test';
import assert from 'node:assert/strict';
import {SiCandidateAgent} from '../si-candidate-agent.mjs';

const createSource=(count=112)=>({
 schemaVersion:'SI-C01-v1',snapshotHash:'a'.repeat(64),
 policyRevision:3,riskPolicyRevision:2,
 selectionPolicyActive:true,
 selection:{pscRiskRatePercent:0,uaeFlagRatePercent:0,
   serviceRequestPlanCap:4,maxPlannedVessels:8},
 ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']},
 aiAdvisory:{selectionSignals:['SOURCE_EVENT_EVIDENCE'],
   minimumSelectionConfidence:0},
 candidates:Array.from({length:count},(_,i)=>({
   imo:String(9100000+(i%99)),candidateKey:'C-'+i,
   regime:'UAE_SERVICE_INSPECTION',flag:'AE',
   vesselName:'Synthetic vessel '+(i%99),sourceTypes:['SERVICE_REQUEST'],
   currentRisk:null,requiredInPlan:false,actionableServiceRequest:true,
   sourceEvents:[{sourceType:'SERVICE_REQUEST',approval:'SOURCE_FINAL',
     eventKey:'EV-'+i}],
   allowedEvidence:['EV-'+i]
 }))
});
const runC01=({count=112,badBatch=null}={})=>{
 const source=createSource(count);
 let running=0,maxConcurrent=0,executed=0;
 const agent=new SiCandidateAgent({
   targeting:{dashboard:async()=>({})},provider:'airia',
   executeAgent:async payload=>{
     running++;executed++;maxConcurrent=Math.max(maxConcurrent,running);
     try{
       await new Promise(r=>setTimeout(r,8));
       if(payload.requestMeta.batchIndex===badBatch)
         throw new Error('PRIVATE UPSTREAM ERROR');
       return {recommendations:payload.candidates.map(c=>({
         candidateKey:c.candidateKey,imo:c.imo,
         recommendation:'MANUAL_REVIEW',confidence:0.7,
         reason:'Source-backed candidate awaits officer selection review.',
         evidenceRefs:[c.allowedEvidence[0]],dataGaps:[]
       }))};
     }finally{running--;}
   }
 });
 agent.source=async()=>source;
 const progress=[];
 return {source,progress,getMax:()=>maxConcurrent,getCalls:()=>executed,
   result:agent.run({actor:'MOEI Operator',confirmRun:true,
      expectedSnapshotHash:source.snapshotHash,confirmBatchCount:Math.ceil(count/25),
      onProgress:x=>progress.push(x)})};
};
test('112 eligible candidate workflows across 99 IMOs are all evaluated in five groups',async()=>{
 const x=runC01();
 const result=await x.result;
 assert.equal(result.batchesValidated,5);
 assert.equal(result.candidatesAnalyzed,112);
 assert.equal(result.verifiedAiRecommendations,112);
 assert.equal(result.recommendations.length,112);
 assert.equal(new Set(result.recommendations.map(r=>r.candidateKey)).size,112);
 assert.equal(new Set(x.source.candidates.map(r=>r.imo)).size,99);
 assert.equal(x.getCalls(),5,'five C01 calls are not five vessels');
 assert.ok(x.getMax()<=2&&x.getMax()>=2,'bounded concurrency reduces serialized latency');
 assert.equal(x.progress.at(-1).processedWorkflows,112);
 assert.equal(x.progress.at(-1).completedBatches,5);
 assert.equal(x.progress.at(-1).totalWorkflows,112);
});
test('any failed group blocks a partial C01 plan; no automatic retry or unchecked recommendation',async()=>{
 const x=runC01({badBatch:3});
 await assert.rejects(x.result,e=>
  e.code==='SI_C01_PROVIDER_UNAVAILABLE'&&e.batchIndex===3);
 assert.ok(x.getCalls()<=5);
 assert.ok(x.getMax()<=2);
});
