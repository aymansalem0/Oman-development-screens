/**
 * MOEI SI-C01 – AI vessel selection under a published business policy.
 *
 * IMPORTANT: Source records are never deleted/changed here. FINAL/REVIEWED
 * service requests remain actionable in Candidate Center even when not
 * chosen for THIS POC rolling plan; UNVERIFIED requests stay review-only.
 * Human-approved NMC referrals remain outside ALL optional quotas.
 */
import {compareInspections} from './si-inspection-ranking.mjs';

const isUae=x=>['UAE','AE','ARE','UNITED ARAB EMIRATES',
 'الإمارات','الإمارات العربية المتحدة'].includes(
 String(x||'').trim().toUpperCase().replace(/[\s._-]+/g,' '));
const unique=xs=>[...new Set(xs)];
const confidenceOf=r=>Number.isFinite(r?.confidence)?r.confidence:-1;

export function projectC01ConfiguredSelection(source,recommendations){
 if(!source||!Array.isArray(source.candidates)||
   !Array.isArray(recommendations)||!source.selection)
  throw Error('SI_C01_SELECTION_PROJECTION_INVALID');
 const policy=source.selection;
 const byKey=new Map(recommendations.map(r=>[r.candidateKey,r]));
 const byImo=new Map();
 for(const c of source.candidates){
   const current=byImo.get(c.imo)||{
     imo:c.imo,flag:c.flag||'',psc:false,service:false,
     mandatory:false,risk:null,records:[],sourceKeys:[]};
   if(c.sourceTypes.includes('PSC_PORT_CALL'))current.psc=true;
   if(c.actionableServiceRequest===true||
      // Historical contract: SOURCE_FINAL in a published legacy revision.
      (c.actionableServiceRequest===undefined&&
       c.sourceEvents?.some(e=>e.sourceType==='SERVICE_REQUEST'&&
         ['SOURCE_FINAL','SOURCE_REVIEWED'].includes(e.approval))))
     current.service=true;
   if(c.requiredInPlan)current.mandatory=true;
   if(c.currentRisk&&Number.isFinite(c.currentRisk.score))
     current.risk=Math.max(current.risk??-1,c.currentRisk.score);
   current.records.push(c);
   current.sourceKeys.push(c.candidateKey);
   if(!current.flag&&c.flag)current.flag=c.flag;
   byImo.set(c.imo,current);
 }
 const rows=[...byImo.values()];
 const score=r=>Math.max(-1,...r.records
   .map(c=>byKey.get(c.candidateKey))
   .filter(x=>x?.recommendation==='SELECT_RECOMMENDED')
   .map(confidenceOf));
 const recommended=r=>score(r)>=0;
 // AI decides suitability; deterministic tiebreakers never override an AI
 // DEFER or MANUAL_REVIEW and never create a new inspection reason.
 const byAdvice=(a,b)=>Number(recommended(b))-Number(recommended(a))||
   score(b)-score(a)||(b.risk??-1)-(a.risk??-1)||
   a.imo.localeCompare(b.imo);
 const psc=rows.filter(r=>r.psc&&!r.mandatory).sort(byAdvice);
 const uae=rows.filter(r=>isUae(r.flag)&&!r.mandatory).sort(byAdvice);
 const service=rows.filter(r=>r.service&&!r.mandatory).sort(byAdvice);
 const mandatory=rows.filter(r=>r.mandatory);
 const limit=(n,p)=>Math.floor(n*p/100);
 const pscCap=limit(psc.length,policy.pscRiskRatePercent);
 const uaeCap=limit(uae.length,policy.uaeFlagRatePercent);
 const limited=Number.isInteger(policy.serviceRequestPlanCap)&&
   Number.isInteger(policy.maxPlannedVessels);
 const serviceCap=limited?Math.min(service.length,policy.serviceRequestPlanCap):null;
 const maxPlan=limited?policy.maxPlannedVessels:null;
 // Legacy policy: do not impose a new service cap before ministry/publisher
 // explicitly publishes that setting. Those source requests were mandatory.
 const selected=new Set(mandatory.map(r=>r.imo));
 const pscSelected=[],uaeSelected=[],serviceSelected=[];
 const choose=(pool,target,cap,valid=()=>true)=>{
   if(cap===null)return;
   for(const row of pool.filter(recommended)){
     if(target.length>=cap)break;
     if(!valid(row))continue;
     if(maxPlan!==null&&!selected.has(row.imo)&&selected.size>=maxPlan)continue;
     target.push(row);
     selected.add(row.imo);
   }
 };
 // In a capped POC plan, service requests get a small visible share, then
 // PSC, then UAE-flag optional factors. Overlap uses one physical IMO slot.
 // No official execution priority is changed by this cohort allocation.
 if(limited)choose(service,serviceSelected,serviceCap);
 choose(psc,pscSelected,pscCap,row=>row.risk!==null);
 choose(uae,uaeSelected,uaeCap);
 const included=rows.filter(r=>selected.has(r.imo))
  .sort((a,b)=>Number(b.mandatory)-Number(a.mandatory)||
   compareInspections(a.records[0],b.records[0])||
   a.imo.localeCompare(b.imo));
 const sourceMethods=r=>unique([
   ...(r.mandatory?['PROTECTED_NMC_OR_LEGACY_SOURCE_OBLIGATION']:[]),
   ...(serviceSelected.includes(r)?['SERVICE_REQUEST_AI_CAPPED_POC_PLAN']:[]),
   ...(pscSelected.includes(r)?['PSC_RISK_AI']:[]),
   ...(uaeSelected.includes(r)?['UAE_FLAG_AI']:[])
 ]);
 const overlap=rows.filter(r=>
   Number(serviceSelected.includes(r))+
   Number(pscSelected.includes(r))+
   Number(uaeSelected.includes(r))>1).map(r=>r.imo);
 return {
   mode:'AI_RECOMMENDATION_UNDER_PUBLISHED_POLICY_NOT_APPROVAL',
   poolMode:policy.uaePoolMode,pscPoolMode:policy.pscPoolMode,
   policyRevision:source.policyRevision,snapshotHash:source.snapshotHash,
   pscRisk:{eligibleImos:psc.length,cap:pscCap,
     aiSelectedImos:pscSelected.map(r=>r.imo),
     missingRisk:psc.filter(r=>r.risk===null).length},
   uaeFlag:{eligibleImos:uae.length,cap:uaeCap,
     aiSelectedImos:uaeSelected.map(r=>r.imo)},
   serviceRequests:{eligibleImos:service.length,cap:serviceCap,
     aiSelectedImos:serviceSelected.map(r=>r.imo),
     waitingInBacklogImos:service.filter(r=>!selected.has(r.imo)).map(r=>r.imo)},
   mandatoryImos:mandatory.map(r=>r.imo),
   maxPlannedVessels:maxPlan,
   maxPlanExceededByProtectedSources:maxPlan!==null&&mandatory.length>maxPlan,
   overlappingImos:overlap,
   selectedImos:included.map(r=>r.imo),
   selectedRows:included.map(r=>({imo:r.imo,selectionBasis:sourceMethods(r),
     candidateKeys:r.sourceKeys,
     evidenceRefs:unique(r.records.flatMap(c=>
       byKey.get(c.candidateKey)?.evidenceRefs||[])),
     aiRecommendationConfidence:score(r)<0?null:score(r)})),
   aiRecommendedButQuotaExcluded:rows.filter(r=>
     recommended(r)&&!selected.has(r.imo)).map(r=>r.imo),
   manualReviewImos:rows.filter(r=>
     !r.mandatory&&(!recommended(r)||
       (r.psc&&r.risk===null&&!uaeSelected.includes(r)&&
         !serviceSelected.includes(r)))).map(r=>r.imo),
   sourceCandidateImos:rows.length,approved:false,
   aiSelectionValidated:true,configuredPolicy:policy
 };
}
