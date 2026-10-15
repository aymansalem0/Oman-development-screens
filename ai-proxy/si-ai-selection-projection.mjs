/**
 * MOEI SI-C01 - CONFIGURED BUSINESS SELECTION, not statutory authorization.
 * Pure, read-only reconciliation of VERIFIED AI recommendations against
 * independently published source gates and versioned per-factor quotas.
 * One physical vessel = one IMO; source events/regimes remain traceable.
 */
import {compareInspections} from './si-inspection-ranking.mjs';

const flag=x=>['UAE','AE','ARE','UNITED ARAB EMIRATES',
 'الإمارات','الإمارات العربية المتحدة'].includes(
 String(x||'').trim().toUpperCase().replace(/[\\s._-]+/g,' '));
const unique=xs=>[...new Set(xs)];
const confidenceOf=r=>Number.isFinite(r?.confidence)?r.confidence:-1;

export function projectC01ConfiguredSelection(source,recommendations){
 if(!source||!Array.isArray(source.candidates)||!Array.isArray(recommendations)||
   !source.selection)throw Error('SI_C01_SELECTION_PROJECTION_INVALID');
 const policy=source.selection,byKey=new Map(recommendations.map(r=>[r.candidateKey,r]));
 const byImo=new Map();
 for(const c of source.candidates){
   const current=byImo.get(c.imo)||{
     imo:c.imo,flag:c.flag||'',psc:false,mandatory:false,
     risk:null,records:[],sourceKeys:[]};
   if(c.sourceTypes.includes('PSC_PORT_CALL'))current.psc=true;
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
 // AI decides which supported options should be shortlisted; risk is only
 // an evidence-backed tie-break within the PSC selection group.
 const psc=rows.filter(r=>r.psc&&!r.mandatory).sort((a,b)=>
   Number(recommended(b))-Number(recommended(a))||
   score(b)-score(a)||(b.risk??-1)-(a.risk??-1)||
   compareInspections(a.records[0],b.records[0])||
   a.imo.localeCompare(b.imo));
 const uae=rows.filter(r=>flag(r.flag)&&!r.mandatory).sort((a,b)=>
   Number(recommended(b))-Number(recommended(a))||
   score(b)-score(a)||a.imo.localeCompare(b.imo));
 const limit=(n,percent)=>Math.floor(n*percent/100);
 const pscCap=limit(psc.length,policy.pscRiskRatePercent);
 const uaeCap=limit(uae.length,policy.uaeFlagRatePercent);
 const pscSelected=psc.filter(r=>r.risk!==null&&recommended(r)).slice(0,pscCap);
 const uaeSelected=uae.filter(recommended).slice(0,uaeCap);
 const mandatory=rows.filter(r=>r.mandatory);
 const selected=new Set([...pscSelected,...uaeSelected,...mandatory].map(r=>r.imo));
 const selectedRows=rows.filter(r=>selected.has(r.imo))
  .sort((a,b)=>Number(b.mandatory)-Number(a.mandatory)||
   compareInspections(a.records[0],b.records[0])||
   a.imo.localeCompare(b.imo));
 return {
   mode:'AI_RECOMMENDATION_UNDER_PUBLISHED_POLICY_NOT_APPROVAL',
   poolMode:policy.uaePoolMode,pscPoolMode:policy.pscPoolMode,
   policyRevision:source.policyRevision,snapshotHash:source.snapshotHash,
   pscRisk:{eligibleImos:psc.length,cap:pscCap,aiSelectedImos:pscSelected.map(r=>r.imo),
     missingRisk:psc.filter(r=>r.risk===null).length},
   uaeFlag:{eligibleImos:uae.length,cap:uaeCap,aiSelectedImos:uaeSelected.map(r=>r.imo)},
   mandatoryImos:mandatory.map(r=>r.imo),
   overlappingImos:pscSelected.filter(r=>uaeSelected.some(u=>u.imo===r.imo))
     .map(r=>r.imo),
   selectedImos:selectedRows.map(r=>r.imo),
   selectedRows:selectedRows.map(r=>({imo:r.imo,
     selectionBasis:unique([
       ...(r.mandatory?['PROTECTED_SOURCE_OBLIGATION']:[]),
       ...(pscSelected.includes(r)?['PSC_RISK_AI']:[]),
       ...(uaeSelected.includes(r)?['UAE_FLAG_AI']:[])
     ]),candidateKeys:r.sourceKeys,
     evidenceRefs:unique(r.records.flatMap(c=>byKey.get(c.candidateKey)?.evidenceRefs||[])),
     aiRecommendationConfidence:score(r)<0?null:score(r)})),
   aiRecommendedButQuotaExcluded:rows.filter(r=>recommended(r)&&!selected.has(r.imo))
     .map(r=>r.imo),
   manualReviewImos:rows.filter(r=>!r.mandatory&&(!recommended(r)||
     (r.psc&&r.risk===null&&!uaeSelected.includes(r)))).map(r=>r.imo),
   sourceCandidateImos:rows.length,approved:false,
   aiSelectionValidated:true,
   configuredPolicy:policy
 };
}
