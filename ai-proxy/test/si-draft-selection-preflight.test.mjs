import test from 'node:test';
import assert from 'node:assert/strict';
import {
 inspectSiDraftScope,assertSiDraftScope,SI_DRAFT_SOLVER_MAX_VESSELS
} from '../si-draft-selection-preflight.mjs';

const params=(active,serviceCap,maxPlan)=>{
 const source={selectionPolicyActive:active,policyRevision:9,
  selection:{pscRiskRatePercent:15,uaeFlagRatePercent:0,
   serviceRequestPlanCap:serviceCap,maxPlannedVessels:maxPlan},
  candidates:[]};
 return source;
};
function addService(source,n,{required=true}={}){
 for(let i=0;i<n;i++)source.candidates.push({
  imo:String(9100000+i),candidateKey:'SI-'+i,
  requiredInPlan:required,actionableServiceRequest:true,
  sourceTypes:['SERVICE_REQUEST'],
  sourceEvents:[{sourceType:'SERVICE_REQUEST',approval:'SOURCE_FINAL'}]});
}
function addNmc(source,n){
 for(let i=0;i<n;i++){
  const imo=String(9200000+i);
  source.candidates.push({imo,candidateKey:'NMC-'+i,
   requiredInPlan:true,actionableServiceRequest:false,
   sourceTypes:['NMC_CASE'],
   sourceEvents:[{sourceType:'NMC_CASE',approval:'APPROVED',
    sourceEventId:'S-'+imo}]});
 }
}
test('legacy policy with sixty source-final service requests requires publisher republish; not sixty NMC obligations',()=>{
 const src=params(false,null,null);addService(src,60);
 const scope=inspectSiDraftScope(src);
 assert.equal(scope.eligibleVessels,60);
 assert.equal(scope.protectedNmcVessels,0);
 assert.equal(scope.serviceRequestVessels,60);
 assert.equal(scope.legacyServiceRequestsForcedIntoOnePlan,60);
 assert.equal(scope.status,'SELECTION_POLICY_REPUBLICATION_REQUIRED');
 assert.equal(scope.noAiCalls,true);
 assert.throws(()=>assertSiDraftScope(src),/SI_DRAFT_PUBLISH_SERVICE_AND_PLAN_CAP_BEFORE_AIRIA/);
});
test('published cap 4 / 12 allows source preflight while keeping all sixty requests in candidate pool',()=>{
 const src=params(true,4,12);addService(src,60,{required:false});
 const scope=assertSiDraftScope(src);
 assert.equal(scope.status,'READY');
 assert.equal(scope.publishedServiceRequestPlanCap,4);
 assert.equal(scope.publishedMaxPlannedVessels,12);
 assert.equal(scope.eligibleVessels,60);
 assert.equal(scope.legacyServiceRequestsForcedIntoOnePlan,0);
 assert.equal(src.candidates.length,60);
});
test('genuinely approved NMC referrals are protected; old forty-vessel gate is NOT a real solver limit',()=>{
 const src=params(true,4,50);
 addNmc(src,42);addService(src,60,{required:false});
 const scope=assertSiDraftScope(src);
 assert.equal(scope.protectedNmcVessels,42);
 assert.equal(scope.status,'READY');
 assert.equal(scope.solverMaxVessels,500);
 assert.equal(SI_DRAFT_SOLVER_MAX_VESSELS,500);
});
test('approved NMC referrals exceeding a published plan max require human scope review',()=>{
 const src=params(true,4,50);addNmc(src,51);
 const scope=inspectSiDraftScope(src);
 assert.equal(scope.protectedNmcVessels,51);
 assert.equal(scope.status,'PROTECTED_NMC_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP');
 assert.throws(()=>assertSiDraftScope(src),/SI_DRAFT_NMC_PROTECTED_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP/);
});
test('multiple regime workflows and overlapping NMC/service triggers count one physical IMO',()=>{
 const src=params(true,4,12);addNmc(src,1);
 const original=src.candidates[0];src.candidates.push({
  ...original,candidateKey:'SECOND-REGIME',
  actionableServiceRequest:true,sourceTypes:['SERVICE_REQUEST'],
  sourceEvents:[{sourceType:'SERVICE_REQUEST',approval:'SOURCE_REVIEWED'},
   {sourceType:'NMC_CASE',approval:'APPROVED'}]});
 const scope=inspectSiDraftScope(src);
 assert.equal(scope.candidateWorkflows,2);
 assert.equal(scope.protectedNmcVessels,1);
 assert.equal(scope.serviceRequestVessels,1);
 assert.equal(scope.eligibleVessels,1);
});
