/**
 * Independent, advisory candidate quotas for a capacity-first MOEI plan draft.
 *
 * Factor 1: PSC candidate vessels screened by SAVED NMC vessel risk, where
 * available; missing saved risk stays visible and never gets fabricated.
 * Factor 2: UAE-flagged candidate vessels, irrespective of their PSC status.
 *
 * Each percentage is applied to the size of its OWN eligible unique IMO pool;
 * the percentages are NOT priority weights and need not sum to 100.
 * This module is read-only and cannot approve, book, cancel, or change risk.
 */
export type InspectionFactorKey='PSC_RISK'|'UAE_FLAG';

export interface InspectionQuotaCandidate{
 imo:string;
 flag:string;
 sourceTypes:readonly string[];
 currentRisk:{score:number;level:string}|null;
}

export interface InspectionFactorQuota{
 key:InspectionFactorKey;
 ratePercent:number;
 eligibleVessels:number;
 targetVessels:number;
 selectedImos:string[];
 riskAvailableVessels:number;
 riskMissingVessels:number;
}

export interface InspectionFactorQuotaPreview{
 factors:InspectionFactorQuota[];
 uniqueSelectedImos:string[];
 overlappingImos:string[];
 uniqueSelectedCount:number;
 overallEligibleCandidates:number;
 computedFrom:'SAVED_CANDIDATE_SOURCE_SNAPSHOT';
 advisoryOnly:true;
}

const validPercent=(value:number):number=>{
 if(!Number.isFinite(value)||!Number.isInteger(value)||value<0||value>100)
  throw new Error('SI_PLAN_FACTOR_PERCENT_INVALID');
 return value;
};
const normalizeFlag=(raw:string):string=>String(raw||'').trim()
 .toUpperCase().replace(/[\s._-]+/g,' ').replace(/\s+/g,' ');
/** Only affirmative flag-state evidence; never infer from the port of call. */
export function isUaeFlag(raw:string):boolean{
 const flag=normalizeFlag(raw);
 return ['UAE','AE','ARE','UNITED ARAB EMIRATES',
  'الإمارات','الإمارات العربية المتحدة'].includes(flag);
}
export function calculateInspectionFactorQuotas(
 candidates:readonly InspectionQuotaCandidate[],
 pscRiskRatePercent:number,
 uaeFlagRatePercent:number
):InspectionFactorQuotaPreview{
 const pscRate=validPercent(pscRiskRatePercent);
 const uaeRate=validPercent(uaeFlagRatePercent);
 const unique=new Map<string,InspectionQuotaCandidate>();
 for(const c of candidates){
  if(!c||!/^\d{7}$/.test(c.imo))continue;
  const previous=unique.get(c.imo);
  if(!previous)unique.set(c.imo,c);
  else unique.set(c.imo,{
   ...previous,
   sourceTypes:[...new Set([...previous.sourceTypes,...c.sourceTypes])],
   flag:previous.flag||c.flag,
   currentRisk:previous.currentRisk||c.currentRisk
  });
 }
 const vessels=[...unique.values()];
 const psc=vessels.filter(x=>x.sourceTypes.includes('PSC_PORT_CALL'))
  .sort((a,b)=>{
   const ar=Number(a.currentRisk?.score),br=Number(b.currentRisk?.score);
   const av=Boolean(a.currentRisk)&&Number.isFinite(ar)&&ar>=0&&ar<=100;
   const bv=Boolean(b.currentRisk)&&Number.isFinite(br)&&br>=0&&br<=100;
   if(av!==bv)return av?-1:1;
   if(av&&bv&&br!==ar)return br-ar;
   return a.imo.localeCompare(b.imo);
  });
 // The UAE factor is independent of risk and PSC, so preserve the order of
 // the source-backed candidate pool; no hidden risk-based UAE sort.
 const uae=vessels.filter(x=>isUaeFlag(x.flag));
 const quota=(key:InspectionFactorKey,ratePercent:number,
  pool:InspectionQuotaCandidate[]):InspectionFactorQuota=>{
  const selectedCount=Math.floor(pool.length*ratePercent/100);
  const riskAvailableVessels=pool.filter(v=>
   v.currentRisk!==null&&Number.isFinite(Number(v.currentRisk?.score))&&
   Number(v.currentRisk?.score)>=0&&Number(v.currentRisk?.score)<=100).length;
  return {key,ratePercent,eligibleVessels:pool.length,
   targetVessels:selectedCount,
   selectedImos:pool.slice(0,selectedCount).map(x=>x.imo),
   riskAvailableVessels,
   riskMissingVessels:pool.length-riskAvailableVessels};
 };
 const factors=[
  quota('PSC_RISK',pscRate,psc),
  quota('UAE_FLAG',uaeRate,uae)
 ];
 const selectedPsc=new Set(factors[0].selectedImos);
 const overlappingImos=factors[1].selectedImos.filter(imo=>selectedPsc.has(imo));
 const uniqueSelectedImos=[...new Set(factors.flatMap(x=>x.selectedImos))];
 return {factors,uniqueSelectedImos,overlappingImos,
  uniqueSelectedCount:uniqueSelectedImos.length,
  overallEligibleCandidates:vessels.length,
  computedFrom:'SAVED_CANDIDATE_SOURCE_SNAPSHOT',advisoryOnly:true};
}
