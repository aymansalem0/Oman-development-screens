/**
 * NMC DQ-01 factor-only advisory. Never calculates a final quality score:
 * the platform data-quality/risk engines retain that deterministic authority.
 * Live partner response shapes require tenant contract acceptance.
 */
export class DqAgentError extends Error{
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
const fail=(code,status=422)=>{throw new DqAgentError(code,status);};
const safe=(v,n=1000)=>typeof v==='string'?v.slice(0,n):'';
export function makeDq01Request(imo,vessel,bundle){
  if(!/^[0-9]{7}$/.test(imo||'')||vessel?.imo!==imo||
     vessel?.status!=='COMPLETED'||!vessel.assessmentId||
     !Array.isArray(vessel.signals)||vessel.signals.length<5||
     !Array.isArray(bundle?.evidenceIds)||bundle.evidenceIds.length===0)
    fail('DQ01_SAVED_VESSEL_EVIDENCE_REQUIRED',409);
  const known=new Set([...bundle.evidenceIds,
    ...vessel.signals.flatMap(x=>x.evidenceIds||[])]);
  return {known,request:{
    requestMeta:{correlationId:'NMC-DQ01-'+imo+'-'+Date.now(),
      language:'en',mode:'FACTOR_SIGNALS_ONLY'},
    subject:{type:'VESSEL',imo},bundleRef:'VBL-'+imo,
    savedAssessmentId:vessel.assessmentId,officialScoringRequested:false,
    sourceEvidenceIds:[...known].slice(0,100),
    existingFactorSignals:vessel.signals.map(x=>({factor:x.factor,
      severity:x.severity,evidenceIds:x.evidenceIds||[]})),
    requestedOutputs:['QUALITY_FACTOR_SIGNALS','EVIDENCE_GAPS'],
    provenance:'SYNTHETIC_POC_ADVISORY_ONLY'
  }};
}
function unwrap(raw){
  for(let i=0;i<8;i++){
    if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{fail('DQ01_NON_JSON_RESPONSE',502);}continue;}
    if(Array.isArray(raw)&&raw.length===1){raw=raw[0];continue;}
    if(!raw||typeof raw!=='object'||Array.isArray(raw))break;
    if(Array.isArray(raw.factorSignals)||Array.isArray(raw.signals))return raw;
    const k=['response','result','data','output','finalOutput','outputText','content','text']
      .find(k=>raw[k]!==undefined);
    if(!k)break;raw=raw[k];
  }
  fail('DQ01_PROVIDER_CONTRACT_UNVERIFIED',502);
}
export function validateDq01Response(raw,known){
  const out=unwrap(raw);
  // Block accidental promotion of a model-generated figure to official DQ score.
  if(out.finalQualityScore!=null||out.officialQualityScore!=null||
     out.overallQualityScore!=null||out.officialScoringRequested===true)
    fail('DQ01_FINAL_QUALITY_SCORE_FORBIDDEN',502);
  const factors=out.factorSignals||out.signals;
  if(!factors.length||factors.length>30)fail('DQ01_FACTOR_SIGNALS_INVALID',502);
  const signals=factors.map(f=>{
    const refs=f.evidenceRefs||f.evidenceIds||[];
    if(!safe(f.factor,80)||!Array.isArray(refs)||refs.some(x=>!known.has(x))||
       (f.confidence!==undefined&&(!Number.isFinite(f.confidence)||
        f.confidence<0||f.confidence>1)))
      fail('DQ01_FACTOR_EVIDENCE_INVALID',502);
    return {factor:safe(f.factor,80),status:safe(f.status,70)||'REVIEW_REQUIRED',
      reason:safe(f.reason||f.explanation,1200),confidence:f.confidence??null,
      evidenceRefs:refs,requiresHumanReview:true};
  });
  return {status:'ADVISORY_REVIEW_REQUIRED',agentCode:'DQ-01',provider:'AIRIA',
    factorSignals:signals,finalQualityScore:null,officialScoreChanged:false,
    evidenceGrounded:true,humanReviewRequired:true,caseMutations:0,
    warning:'No authoritative data-quality score or vessel risk was recalculated.'};
}
