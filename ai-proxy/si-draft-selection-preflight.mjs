/**
 * Read-only, no-cost integrated draft scope check.
 * Explicitly distinguish NMC APPROVED regulatory referrals from
 * historical "all verified service requests required" legacy policy.
 * Never silently rewrite a published selection policy or remove a referral.
 */
import {isSiProtectedReferral} from './si-candidate-targeting.mjs';

export const SI_DRAFT_SOLVER_MAX_VESSELS=500;

export function inspectSiDraftScope(source){
 if(!source||!Array.isArray(source.candidates)||!source.selection)
  throw new Error('SI_DRAFT_SELECTION_SOURCE_INVALID');
 const byImo=new Map();
 for(const c of source.candidates){
  if(!c?.imo)continue;
  const old=byImo.get(c.imo)||{imo:c.imo,protectedNmc:false,
   serviceRequest:false,required:false};
  old.protectedNmc||=isSiProtectedReferral({events:c.sourceEvents||[]});
  old.serviceRequest||=c.actionableServiceRequest===true||
   c.sourceTypes?.includes('SERVICE_REQUEST')===true;
  old.required||=c.requiredInPlan===true;
  byImo.set(c.imo,old);
 }
 const vessels=[...byImo.values()];
 const protectedCount=vessels.filter(c=>c.protectedNmc).length;
 const serviceRequestCount=vessels.filter(c=>c.serviceRequest).length;
 const legacyServiceRequiredCount=vessels.filter(c=>
  c.serviceRequest&&!c.protectedNmc&&c.required).length;
 const selection=source.selection;
 const capped=source.selectionPolicyActive===true&&
  Number.isInteger(selection.serviceRequestPlanCap)&&
  Number.isInteger(selection.maxPlannedVessels);
 const status=!capped&&legacyServiceRequiredCount>0?
  'SELECTION_POLICY_REPUBLICATION_REQUIRED':
  capped&&protectedCount>selection.maxPlannedVessels?
  'PROTECTED_NMC_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP':
  protectedCount>SI_DRAFT_SOLVER_MAX_VESSELS?
  'PROTECTED_NMC_REFERRALS_EXCEED_SOLVER_MAX':'READY';
 return {
  status,eligibleVessels:vessels.length,candidateWorkflows:source.candidates.length,
  protectedNmcVessels:protectedCount,serviceRequestVessels:serviceRequestCount,
  legacyServiceRequestsForcedIntoOnePlan:legacyServiceRequiredCount,
  hasPublishedCappedPolicy:capped,
  publishedServiceRequestPlanCap:capped?selection.serviceRequestPlanCap:null,
  publishedMaxPlannedVessels:capped?selection.maxPlannedVessels:null,
  solverMaxVessels:SI_DRAFT_SOLVER_MAX_VESSELS,
  sourcePolicyRevision:source.policyRevision,
  requiresOfficerAction:status!=='READY',
  noAiCalls:true,noSourceMutation:true
 };
}

export function assertSiDraftScope(source){
 const scope=inspectSiDraftScope(source);
 const code={
  SELECTION_POLICY_REPUBLICATION_REQUIRED:
   'SI_DRAFT_PUBLISH_SERVICE_AND_PLAN_CAP_BEFORE_AIRIA',
  PROTECTED_NMC_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP:
   'SI_DRAFT_NMC_PROTECTED_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP',
  PROTECTED_NMC_REFERRALS_EXCEED_SOLVER_MAX:
   'SI_DRAFT_NMC_PROTECTED_REFERRALS_EXCEED_SOLVER_MAX'
 }[scope.status];
 if(!code)return scope;
 const error=new Error(code);
 error.code=code;error.status=409;error.scope=scope;
 throw error;
}
