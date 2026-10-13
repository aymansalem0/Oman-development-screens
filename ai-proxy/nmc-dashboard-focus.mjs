/**
 * NMC dashboard focus using EXACT EXISTING Airia A02 risk signals and
 * A01 SITUATION_ASSESSMENT request/response shapes. No dedicated pipeline.
 *
 * The dashboard is not a VESSEL. A01/A02 still require a *real assessed vessel*
 * as subject; platform provides eight aggregate SYNTHETIC POC counts as
 * supplementary context ONLY, never as invented vessel risk evidence.
 *
 * A01 standard response has no focusMetricId property. To preserve its JSON
 * contract, model may place ONE "FOCUS_KPI:<known-id>" marker inside its
 * existing whyItMatters narrative. Missing/ambiguous marker FAILS CLOSED.
 * No KPI choice is claimed otherwise. This is a POC compatibility probe;
 * successful partner adherence must be verified before production.
 */
import {createHash} from 'node:crypto';
const METRICS=Object.freeze({
  vesselContacts:'simulated traffic contacts, not by itself risk',
  assessedVessels:'saved completed vessel assessments, coverage not urgency',
  highRiskVessels:'HIGH-only saved vessel risk; excludes CRITICAL',
  criticalRiskVessels:'CRITICAL vessel risk under current published policy',
  requiresAttention:'distinct vessels with risk, findings or active incidents; overlaps',
  activeAlerts:'active central maritime alert workflow records',
  openCases:'not-resolved central maritime case records',
  activeIncidents:'unresolved Google Sheet incident reports; not distinct vessels'
});
export const NMC_DASHBOARD_METRIC_IDS=Object.freeze(Object.keys(METRICS));
const A02_FACTORS=['inspection','certificate','dataQuality'];
const toText=(x,max=1600)=>typeof x==='string'?x.trim().slice(0,max):'';
export class DashboardFocusError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export function validateDashboardMetrics(metrics){
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||
     Object.keys(metrics).length!==NMC_DASHBOARD_METRIC_IDS.length)
    throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
  const result={};
  for(const id of NMC_DASHBOARD_METRIC_IDS){
    if(!Object.hasOwn(metrics,id))
      throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
    const n=metrics[id];
    if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>10000000))
      throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
    result[id]=n;
  }
  return result;
}
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function unwrap(raw,key){
  let value=raw;
  for(let i=0;i<9;i++){
    if(typeof value==='string'){
      try{value=JSON.parse(value);}catch{
        throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);
      }
      continue;
    }
    if(Array.isArray(value)){if(value.length!==1)break;value=value[0];continue;}
    if(!value||typeof value!=='object')break;
    if(key==='signals'&&Array.isArray(value.signals))return value;
    if(key==='situation'&&typeof value.whyItMatters==='string'&&
      typeof value.summary==='string')return value;
    const name=['result','response','output','data','finalOutput',
      'outputText','content','text','value'].find(k=>value[k]!==undefined);
    if(!name)break;
    value=value[name];
  }
  throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);
}
export function validateA02DashboardResponse(raw,knownEvidence){
  const out=unwrap(raw,'signals'),results=[];
  for(const factor of A02_FACTORS){
    const items=out.signals.filter(row=>row?.factor===factor);
    if(items.length!==1)throw new DashboardFocusError('DASHBOARD_FOCUS_A02_INVALID',502);
    const s=items[0];
    if(s.sourceAgent!=='A02'||String(s.status||'').toUpperCase()!=='AVAILABLE'||
      !Number.isFinite(s.severity)||s.severity<0||s.severity>100||
      !Number.isFinite(s.confidence)||s.confidence<0||s.confidence>1||
      !Array.isArray(s.evidenceIds)||s.evidenceIds.length===0||
      s.evidenceIds.some(id=>!knownEvidence.has(id)))
      throw new DashboardFocusError('DASHBOARD_FOCUS_A02_INVALID',502);
    results.push(s);
  }
  return results;
}
export function validateA01DashboardResponse(raw,metrics,knownEvidence){
  const out=unwrap(raw,'situation');
  if(!toText(out.summary,1200)||!toText(out.whyItMatters,1900)||
      !Array.isArray(out.proposedActions)||!out.proposedActions.length||
      !Array.isArray(out.evidence)||!out.evidence.length)
    throw new DashboardFocusError('DASHBOARD_FOCUS_A01_INVALID',502);
  const refs=[...out.evidence.flatMap(e=>Array.isArray(e?.evidenceIds)?e.evidenceIds:[]),
    ...out.proposedActions.flatMap(a=>Array.isArray(a?.evidenceIds)?a.evidenceIds:[])];
  // A01 must cite real vessel evidence. Dashboard aggregates are context, not
  // invented evidence IDs and never a confirmed safety/compliance fact.
  if(!refs.length||refs.some(id=>typeof id!=='string'||!knownEvidence.has(id)))
    throw new DashboardFocusError('DASHBOARD_FOCUS_A01_EVIDENCE_INVALID',502);
  const markers=[...out.whyItMatters.matchAll(/FOCUS_KPI\s*:\s*([A-Za-z][A-Za-z0-9]*)/g)];
  if(markers.length!==1)throw new DashboardFocusError('DASHBOARD_FOCUS_A01_MARKER_MISSING',502);
  const metricId=markers[0][1];
  if(!Object.hasOwn(METRICS,metricId)||metrics[metricId]===null)
    throw new DashboardFocusError('DASHBOARD_FOCUS_A01_MARKER_INVALID',502);
  const reason=out.whyItMatters.replace(markers[0][0],'').trim().slice(0,550);
  if(reason.length<15)
    throw new DashboardFocusError('DASHBOARD_FOCUS_A01_INVALID',502);
  const evidenceIds=[...new Set(refs)];
  return {metricId,value:metrics[metricId],reasonEn:reason,
    reasonAr:reason,confidence:Number.isFinite(out.agentConfidence)&&
      out.agentConfidence>=0&&out.agentConfidence<=1?out.agentConfidence:null,
    a01Priority:toText(out.priority,70)||'UNSPECIFIED',
    a01Summary:toText(out.summary,500),evidenceIds};
}
const metricsText=metrics=>NMC_DASHBOARD_METRIC_IDS.map(id=>
  id+'='+String(metrics[id])+' ('+METRICS[id]+')').join('; ');
const safeReason=(reason,max=450)=>toText(reason,max).replace(/[\r\n]+/g,' ');
export function buildLegacyDashboardRequests(metrics,{vessel,bundle}){
  if(!vessel||vessel.status!=='COMPLETED'||!(/^[0-9]{7}$/).test(vessel.imo||'')||
      !vessel.assessmentId||!Array.isArray(vessel.signals)||
      !Array.isArray(bundle?.evidenceIds)||!bundle?.inlineContext)
    throw new DashboardFocusError('DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE',409);
  const base={requestMeta:{correlationId:'NMC-DASHFOCUS-'+vessel.imo+'-'+Date.now(),
    language:'en'},
    subject:{type:'VESSEL',imo:vessel.imo},bundleRef:'VBL-'+vessel.imo,
    contextMode:'INLINE',officialScoringRequested:false,
    inlineContext:{...bundle.inlineContext,
      // Existing INLINE context container, not a new A02 request field.
      dashboardOperationalSnapshot:{
        nature:'SYNTHETIC_POC_AGGREGATE_NOT_VESSEL_RISK_EVIDENCE',
        kpis:NMC_DASHBOARD_METRIC_IDS.map(id=>({id,value:metrics[id],meaning:METRICS[id]})),
        nonAdditive:true,notRegulatory:true,
        purpose:'Supplementary operator overview, not a request to rescore this vessel.'
      }
    }};
  const a02={...base,requestedSignals:[...A02_FACTORS]};
  const factors=['movement','inspection','certificate','dataQuality','history'];
  const supplied=factors.map(factor=>{
    const source=vessel.signals.filter(row=>row.factor===factor);
    if(source.length!==1||!Number.isFinite(source[0].severity)||
      !Array.isArray(source[0].evidenceIds)||!source[0].evidenceIds.length)
      throw new DashboardFocusError('DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE',409);
    return {factor,severity:source[0].severity,
      evidenceIds:[...source[0].evidenceIds],reason:safeReason(source[0].reason)};
  });
  // Preserve A01's documented top-level request shape and its five original
  // risk severities/evidence refs; add summary context inside one *existing*
  // string field (not a new risk factor, official score, or output property).
  const history=supplied.find(s=>s.factor==='history');
  const current=safeReason(history.reason,190);
  const values=metricsText(metrics);
  history.reason=(current+
    '\n[DASHBOARD CONTEXT: NOT A VESSEL RISK SIGNAL; POC COUNTS ONLY] '+values+
    '. Choose the ONE most operationally actionable dashboard KPI from these IDs.'+
    ' Use existing A01 SITUATION_ASSESSMENT response fields only; within'+
    ' the existing whyItMatters text include EXACTLY ONE marker'+
    ' FOCUS_KPI:<selectedId> plus a grounded explanation. This is advisory,'+
    ' never a vessel risk score change, mandatory action or compliance ruling.').slice(0,2800);
  const a01={requestMeta:{correlationId:'NMC-DASHFOCUS-A01-'+vessel.imo+'-'+Date.now(),
      language:'en'},
    subject:{type:'VESSEL',imo:vessel.imo},
    bundleRef:'VBL-'+vessel.imo,mode:'SITUATION_ASSESSMENT',
    officialRisk:{evaluationId:vessel.assessmentId,score:vessel.score,
      level:vessel.level,rulesetVersion:vessel.configVersion},
    riskSignalRunId:vessel.assessmentId,
    requestedOutputs:['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS'],
    approvedSignalEvidence:supplied,provenance:'SYNTHETIC_POC_NOT_REGULATORY'};
  return {a01,a02,knownEvidence:new Set([...bundle.evidenceIds,
    ...supplied.flatMap(s=>s.evidenceIds)])};
}
/** The public fleet snapshot deliberately strips individual risk signals.
 *  Resolve the underlying saved row by IMO for existing A01/A02 requests.
 *  Never turn the public summary into fake evidence or re-assess a vessel. */
export function selectDashboardFocusVessel(fleet,bundleMap){
  if(!fleet||typeof fleet.getVesselResult!=='function'||
      !bundleMap||typeof bundleMap.get!=='function')return null;
  const ids=Object.keys(fleet.snapshot()?.results||{});
  const factors=['movement','inspection','certificate','dataQuality','history'];
  const eligible=ids.map(imo=>fleet.getVesselResult(imo)).filter(row=>{
    if(!row||row.status!=='COMPLETED'||
       typeof row.assessmentId!=='string'||!row.assessmentId||
       !/^[0-9]{7}$/.test(row.imo||'')||
       !Number.isFinite(row.score)||!Array.isArray(row.signals))return false;
    const bundle=bundleMap.get(row.imo);
    if(!bundle||!Array.isArray(bundle.evidenceIds)||
       !bundle.evidenceIds.length||!bundle.inlineContext)return false;
    return factors.every(factor=>{
      const matches=row.signals.filter(s=>s?.factor===factor);
      return matches.length===1&&Number.isFinite(matches[0].severity)&&
        matches[0].severity>=0&&matches[0].severity<=100&&
        Array.isArray(matches[0].evidenceIds)&&
        matches[0].evidenceIds.length>0;
    });
  }).sort((a,b)=>b.score-a.score);
  const vessel=eligible[0]||null;
  return vessel?{vessel,bundle:bundleMap.get(vessel.imo)}:null;
}

export class DashboardAiFocus{
  constructor({executeAgent,selectVessel,enabled=false,now=()=>Date.now(),cacheMs=5*60*1000}={}){
    this.executeAgent=executeAgent;this.selectVessel=selectVessel;
    this.enabled=enabled;this.now=now;this.cacheMs=cacheMs;
    this.cache=null;this.inFlight=false;
  }
  isEnabled(){
    return typeof this.enabled==='function'?this.enabled()===true:this.enabled===true;
  }
  /** Status is a free read-only eligibility check, NOT an AI request.
   * Source evidence readiness must be visible even if the paid feature is OFF. */
  status(){
    const candidate=typeof this.selectVessel==='function'?this.selectVessel():null;
    return {configured:this.isEnabled(),
      assessmentContextReady:Boolean(candidate?.vessel&&candidate?.bundle),
      sourceImo:candidate?.vessel?.imo||null,
      agentIds:['A02','A01'],requestContracts:'EXISTING_A02_SIGNALS_AND_A01_SITUATION_ASSESSMENT',
      dataNature:'SYNTHETIC_POC_ADVISORY_ONLY',automaticAiCalls:false,
      requiresExplicitOperatorConfirmation:true,potentialAgentCalls:2};
  }
  async run({metrics,confirmCost}={}){
    if(confirmCost!==true)throw new DashboardFocusError('DASHBOARD_FOCUS_CONFIRM_REQUIRED',400);
    if(!this.isEnabled()||typeof this.executeAgent!=='function'||
      typeof this.selectVessel!=='function')
      throw new DashboardFocusError('DASHBOARD_FOCUS_A01_A02_NOT_ENABLED',503);
    const source=validateDashboardMetrics(metrics);
    if(NMC_DASHBOARD_METRIC_IDS.filter(id=>source[id]!==null).length<5)
      throw new DashboardFocusError('DASHBOARD_FOCUS_INSUFFICIENT_DATA',422);
    const candidate=this.selectVessel();
    if(!candidate?.vessel||!candidate?.bundle)
      throw new DashboardFocusError('DASHBOARD_FOCUS_VESSEL_EVIDENCE_UNAVAILABLE',409);
    const {a01,a02,knownEvidence}=buildLegacyDashboardRequests(source,candidate);
    const hash=digest({source,vesselAssessmentId:candidate.vessel.assessmentId});
    if(this.cache?.hash===hash&&this.now()-this.cache.createdAt<this.cacheMs)
      return {...this.cache.data,reused:true};
    if(this.inFlight)throw new DashboardFocusError('DASHBOARD_FOCUS_IN_PROGRESS',409);
    this.inFlight=true;
    try{
      let rawA02,rawA01;
      try{rawA02=await this.executeAgent('a02',a02);}
      catch{throw new DashboardFocusError('DASHBOARD_FOCUS_A02_UNAVAILABLE',502);}
      const verifiedA02=validateA02DashboardResponse(rawA02,knownEvidence);
      // Same five A01 approved risk factors, original severities and evidence IDs.
      // A02's response is separately checked, not passed off as an A01 KPI ID.
      try{rawA01=await this.executeAgent('a01',a01);}
      catch{throw new DashboardFocusError('DASHBOARD_FOCUS_A01_UNAVAILABLE',502);}
      const selection=validateA01DashboardResponse(rawA01,source,knownEvidence);
      const data={status:'ok',provider:'AIRIA_EXISTING_A01_A02',
        modelBased:true,selection,snapshot:source,snapshotHash:hash,
        analyzedAt:new Date(this.now()).toISOString(),reused:false,
        sourceAssessmentId:candidate.vessel.assessmentId,sourceImo:candidate.vessel.imo,
        a02VerifiedFactors:verifiedA02.map(s=>s.factor),
        dataNature:'SYNTHETIC_POC_ADVISORY_ONLY',requiresHumanReview:true};
      this.cache={hash,createdAt:this.now(),data};
      return data;
    }finally{this.inFlight=false;}
  }
}
