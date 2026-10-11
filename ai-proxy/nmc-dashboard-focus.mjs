/**
 * On-demand AI selection of ONE operationally important dashboard KPI.
 *
 * Strictly an advisory UI highlight. The agent cannot alter KPI values, vessel
 * risk, case/task decisions or reported incidents. No calls on GET/poll/page load.
 * Requires a dedicated Airia pipeline with the contract documented below.
 */
import {createHash} from 'node:crypto';

const METRICS=Object.freeze({
  vesselContacts:'Simulated AIS/LRIT contacts (context volume, not risk)',
  assessedVessels:'Vessels with saved completed AI assessment',
  highRiskVessels:'Vessels at HIGH risk, excluding CRITICAL',
  criticalRiskVessels:'Vessels at CRITICAL current policy risk',
  requiresAttention:'Distinct vessels needing attention; overlaps risk and incidents',
  activeAlerts:'Active alert workflow records',
  openCases:'Open maritime cases, not the same as alerts',
  activeIncidents:'Unresolved source-reported incidents (individual reports, not distinct vessels)'
});
export const NMC_DASHBOARD_METRIC_IDS=Object.freeze(Object.keys(METRICS));
export class DashboardFocusError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export function validateDashboardMetrics(metrics){
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics)||
     Object.keys(metrics).length!==NMC_DASHBOARD_METRIC_IDS.length)
    throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
  const snapshot={};
  for(const id of NMC_DASHBOARD_METRIC_IDS){
    if(!Object.hasOwn(metrics,id))
      throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
    const value=metrics[id];
    if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>10000000))
      throw new DashboardFocusError('DASHBOARD_FOCUS_METRICS_INVALID',422);
    snapshot[id]=value;
  }
  return snapshot;
}
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const oneText=(s,max)=>typeof s==='string'&&s.trim().length>=12&&s.trim().length<=max;
function unwrap(raw){
  let v=raw;
  const keys=['result','response','output','data','finalOutput','outputText','content','text','value'];
  for(let i=0;i<8;i++){
    if(typeof v==='string'){
      try{v=JSON.parse(v);}catch{throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);}
      continue;
    }
    if(!v||typeof v!=='object'||Array.isArray(v))break;
    if(typeof v.focusMetricId==='string')return v;
    const k=keys.find(k=>v[k]!==undefined);
    if(!k)break;
    v=v[k];
  }
  throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);
}
export function validateDashboardAiChoice(raw,metrics){
  const row=unwrap(raw);
  const id=row.focusMetricId;
  if(!Object.hasOwn(METRICS,id)||metrics[id]===null||
    !oneText(row.reason,380))
    throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);
  if(row.confidence!==undefined&&(!Number.isFinite(row.confidence)||
      row.confidence<0||row.confidence>1))
    throw new DashboardFocusError('DASHBOARD_FOCUS_AI_RESPONSE_INVALID',502);
  return {metricId:id,value:metrics[id],reason:row.reason.trim(),
    confidence:row.confidence??null};
}
export function focusPrompt(metrics){
  return {
    task:'SELECT_ONE_NMC_OPERATIONAL_DASHBOARD_PRIORITY',
    dataNature:'SYNTHETIC_POC_ADVISORY_NOT_OFFICIAL',
    inputMetrics:NMC_DASHBOARD_METRIC_IDS.map(id=>({
      id,value:metrics[id],meaning:METRICS[id]
    })),
    instructions:[
      'Choose exactly ONE metric ID that a maritime NMC duty officer should examine first.',
      'Prioritize immediate actionable maritime risk/exceptions, not the largest raw number.',
      'Contact volume and assessed coverage are context, not urgent exceptions.',
      'Some metrics overlap (requiresAttention includes risk/incident vessels). Do not add them.',
      'A missing value (null) is unknown, not zero, and must NOT be selected.',
      'Do not invent ships, incidents, case outcomes, causal explanations, percentages or alerts.',
      'Never recommend enforcing action without authorized human review.',
      'Return ONLY JSON: {"focusMetricId":"one input id","reason":"12-380 chars based on provided input","confidence":0.0 to 1.0}.'
    ]
  };
}
export class DashboardAiFocus{
  constructor({executeAgent,enabled=false,now=()=>Date.now(),cacheMs=5*60*1000}={}){
    this.executeAgent=executeAgent;this.enabled=enabled;
    this.now=now;this.cacheMs=cacheMs;this.cache=null;this.inFlight=false;
  }
  status(){return {configured:this.enabled,dataNature:'SYNTHETIC_POC_ADVISORY_ONLY',
    automaticAiCalls:false,requiresExplicitOperatorConfirmation:true};}
  async run({metrics,confirmCost}={}){
    if(confirmCost!==true)throw new DashboardFocusError('DASHBOARD_FOCUS_CONFIRM_REQUIRED',400);
    if(!this.enabled||typeof this.executeAgent!=='function')
      throw new DashboardFocusError('DASHBOARD_FOCUS_PIPELINE_NOT_CONFIGURED',503);
    const source=validateDashboardMetrics(metrics);
    const hash=digest(source);
    const available=NMC_DASHBOARD_METRIC_IDS.filter(id=>source[id]!==null);
    if(available.length<5)
      throw new DashboardFocusError('DASHBOARD_FOCUS_INSUFFICIENT_DATA',422);
    if(this.cache?.hash===hash&&this.now()-this.cache.createdAt<this.cacheMs)
      return {...this.cache.data,reused:true};
    if(this.inFlight)throw new DashboardFocusError('DASHBOARD_FOCUS_IN_PROGRESS',409);
    this.inFlight=true;
    try{
      let raw;
      try{raw=await this.executeAgent(focusPrompt(source));}
      catch{throw new DashboardFocusError('DASHBOARD_FOCUS_AI_UNAVAILABLE',502);}
      const selection=validateDashboardAiChoice(raw,source);
      const data={status:'ok',provider:'AIRIA_DEDICATED_DASHBOARD_PIPELINE',
        modelBased:true,selection,snapshot:source,snapshotHash:hash,
        analyzedAt:new Date(this.now()).toISOString(),reused:false,
        dataNature:'SYNTHETIC_POC_ADVISORY_ONLY',requiresHumanReview:true};
      this.cache={hash,createdAt:this.now(),data};
      return data;
    }finally{this.inFlight=false;}
  }
}
