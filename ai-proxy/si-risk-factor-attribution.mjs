/**
 * Evidence-level Smart Inspection -> five-factor NMC AI risk attribution.
 * This module NEVER guesses which factor is impacted from finding keywords,
 * severity or type. Only source-verified A01/A02 signal evidence IDs may
 * create a finding/factor link, after the existing 5-factor AI contract has
 * separately validated the source IDs, agent, severities and confidences.
 */
import {createHash} from 'node:crypto';

export const FIVE_NMC_RISK_FACTORS=Object.freeze([
 {factor:'movement',sourceAgent:'A01',description:'AIS / movement and navigation behavior; requires independent movement evidence'},
 {factor:'inspection',sourceAgent:'A02',description:'Confirmed inspection observations, safety and equipment condition'},
 {factor:'certificate',sourceAgent:'A02',description:'Certificate validity, expiry or certificate requirements only with documentary evidence'},
 {factor:'dataQuality',sourceAgent:'A02',description:'Inconsistent or missing source data supported by explicit conflicting data evidence'},
 {factor:'history',sourceAgent:'A01',description:'Previous inspections, repeated or historical events; requires corroborated history'}
]);
const FACTOR_SET=new Set(FIVE_NMC_RISK_FACTORS.map(f=>f.factor));
export class SiFindingFactorError extends Error{
 constructor(code){super(code);this.code=code;this.status=409;}
}

/** Deterministic unique reference for an ACTUAL confirmed inspector finding. */
export function approvedFindingEvidence(report,findings){
 if(report?.status!=='APPROVED'||typeof report.id!=='string'||
   !Array.isArray(findings)||findings.length>100)
  throw new SiFindingFactorError('SI_RISK_APPROVED_FINDINGS_INVALID');
 const seen=new Set();
 return findings.map((f)=>{
  if(f?.status!=='CONFIRMED_BY_INSPECTOR'||typeof f.id!=='string'||
     !f.id.trim()||seen.has(f.id)||
     !['MINOR','MAJOR','CRITICAL'].includes(f.severity)||
     typeof f.description!=='string'||!f.description.trim()||
     !Array.isArray(f.evidenceRefs)||
     (f.severity!=='MINOR'&&!f.evidenceRefs.length))
   throw new SiFindingFactorError('SI_RISK_INSPECTOR_FINDING_NOT_VERIFIED');
  seen.add(f.id);
  const evidenceId='SI-FINDING-'+createHash('sha256')
   .update(report.id+':'+f.id).digest('hex').slice(0,28);
  return {findingId:f.id,checkId:f.checkId||null,
   title:String(f.title||f.id).slice(0,160),
   severity:f.severity,finding:f.description.trim().slice(0,1200),
   status:'CONFIRMED_BY_INSPECTOR',
   evidenceRefs:f.evidenceRefs.filter(x=>typeof x==='string').slice(0,12),
   evidenceId};
 });
}

/**
 * Read the (ALREADY VERIFIED) A01/A02 factor signals. A citation proves an
 * AI-reported evidence link, NOT that this defect caused a score delta.
 * Require every approved defect to be attributed to >=1 factor by explicit
 * citation. If AI misses one, fail closed without saving any scored risk.
 */
export function verifiedFindingFactorAttribution(findings,signals){
 if(!Array.isArray(findings)||!Array.isArray(signals)||
    signals.length!==5||new Set(signals.map(x=>x.factor)).size!==5||
    signals.some(s=>!FACTOR_SET.has(s.factor)||!Array.isArray(s.evidenceIds)))
  throw new SiFindingFactorError('SI_RISK_FIVE_FACTOR_SIGNALS_INVALID');
 const attribution=findings.map(f=>{
  const factors=signals.filter(s=>s.evidenceIds.includes(f.evidenceId))
    .map(s=>({
      factor:s.factor,sourceAgent:s.sourceAgent,
      factorSeverity:s.severity,confidence:s.confidence,
      reason:String(s.reason||'').slice(0,800),
      sourceEvidenceId:f.evidenceId
    }));
  return {findingId:f.findingId,checkId:f.checkId,title:f.title,
    severity:f.severity,description:f.finding,
    findingEvidenceId:f.evidenceId,sourceEvidenceRefs:f.evidenceRefs,
    linkedFactors:factors,attributionStatus:factors.length?
      'AI_SIGNAL_CITED_VERIFIED_FINDING':'NO_VERIFIED_FACTOR_CITATION'};
 });
 if(attribution.some(x=>x.attributionStatus!=='AI_SIGNAL_CITED_VERIFIED_FINDING'))
  throw new SiFindingFactorError('SI_RISK_AI_DID_NOT_ATTRIBUTE_EVERY_DEFECT');
 return attribution;
}
