/**
 * SI POC inspection PLAN, not an inspection authorisation.
 * Single unified grid: saved C01 recommendations + auditable officer amendments.
 * One explicit POST re-runs the current C01 adapter, applies legally protected
 * ordering and atomically stores the new POC plan snapshot.
 *
 * POC storage: existing /data Docker volume (JSON), independently of the
 * Oracle-backed REGULATORY inspection case registry. It must be migrated to
 * an Oracle audit table before production/multi-instance deployment.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SiCandidateAgentError} from './si-candidate-agent.mjs';

const iso=()=>new Date().toISOString();
const empty=()=>({revision:0,overrides:{},latest:null,audit:[]});
const riskOf=x=>Number.isFinite(x?.currentRisk?.score)?x.currentRisk.score:null;
const priorityTier=x=>x.sourceTypes?.includes('NMC_CASE')&&
  x.sourceEvents?.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED')?0:1;
function safeRecord(data){
 if(!data||!Number.isInteger(data.revision)||data.revision<0||
   !data.overrides||typeof data.overrides!=='object'||Array.isArray(data.overrides)||
   !Array.isArray(data.audit))throw new SiCandidateAgentError('SI_PLAN_STORE_CORRUPT',503);
 return data;
}
function atomicSave(file,data){
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
 renameSync(tmp,file);
}
/** Build IMO-level rows; C01 advice is per inspection regime, not regulatory approval. */
export function projectInspectionPlan(dashboard,source,run,overrides={}){
 const recMap=new Map((run?.recommendations||[]).map(r=>[r.candidateKey,r]));
 const grouped=new Map();
 const all=dashboard.vesselCandidates||[];
 const availableKeys=new Set(source.candidates.map(c=>c.candidateKey));
 for(const v of all){
  const c=source.candidates.filter(x=>x.imo===v.imo&&availableKeys.has(x.candidateKey));
  const advice=c.map(x=>recMap.get(x.candidateKey)).filter(Boolean);
  const aiSelected=advice.some(x=>x.recommendation==='SELECT_RECOMMENDED');
  const note=overrides[v.imo]||null;
  const eligible=c.length>0;
  const planSelected=eligible&&run!==null?
   (typeof note?.selected==='boolean'?note.selected:aiSelected):false;
  const locked=!eligible;
  grouped.set(v.imo,{
   imo:v.imo,vesselName:v.vesselName,flag:v.flag,vesselType:v.vesselType,
   sources:v.sourceTypes,regimes:v.regimes,sourceEvents:v.sourceEvents,
   risk:v.currentRisk||null,pendingWorkflows:v.pendingWorkflows,
   approvedCases:v.createdWorkflows,externalScheduled:v.scheduledWorkflows,
   aiRecommended:run?aiSelected:null,planSelected:run?planSelected:null,
   selectionOrigin:note?'OFFICER_AMENDED':run?'AI_ADVISORY':'NOT_EVALUATED',
   officerReason:note?.reason||null,officerActor:note?.actor||null,
   requestedRank:note?.requestedRank??null,
   modelRank:advice.length?Math.min(...advice.filter(x=>Number.isInteger(x.suggestedRank))
     .map(x=>x.suggestedRank).concat([999999])):null,
   effectiveRank:null,priorityReason:null,
   selectionReason:advice.find(x=>x.recommendation==='SELECT_RECOMMENDED')?.reason||
     advice[0]?.reason||null,
   evidenceRefs:[...new Set(advice.flatMap(x=>x.evidenceRefs||[]))],
   dataGaps:[...new Set(advice.flatMap(x=>x.dataGaps||[]))],
   confidence:advice.length?Math.max(...advice.map(x=>x.confidence)):null,
   editable:eligible,locked,regimeAdvisories:advice,
   mandatoryReferral:priorityTier(v)===0
  });
 }
 if(run){
  const ranked=[...grouped.values()].filter(v=>v.planSelected);
  // The provider supplies advisory selection; the rules engine *enforces*
  // approved NMC referral tier and then adjusts operator-requested positions.
  ranked.sort((a,b)=>
   Number(b.mandatoryReferral)-Number(a.mandatoryReferral)||
   (a.requestedRank??100000)-(b.requestedRank??100000)||
   (a.modelRank??999999)-(b.modelRank??999999)||
   (riskOf({currentRisk:b.risk})??-1)-(riskOf({currentRisk:a.risk})??-1)||
   a.imo.localeCompare(b.imo));
  for(let i=0;i<ranked.length;i++){
   const row=ranked[i];
   row.effectiveRank=i+1;
   const sourceAdvice=row.regimeAdvisories.find(x=>x.recommendation==='SELECT_RECOMMENDED');
   const modelExplanation=sourceAdvice?.priorityRationale||
       'No AI ranking available for manual inclusion; requires officer review.';
   row.priorityReason=row.requestedRank!==null?
    'Officer requested position '+row.requestedRank+' with an auditable reason; C01 reran. '+
      'Approved NMC referrals retain their protected first tier. '+modelExplanation:
    (row.mandatoryReferral?'Protected NMC referral priority. ':'')+modelExplanation;
  }
 }
 return [...grouped.values()].sort((a,b)=>
   Number(Boolean(b.planSelected))-Number(Boolean(a.planSelected))||
   (a.effectiveRank??999999)-(b.effectiveRank??999999)||
   Number(b.mandatoryReferral)-Number(a.mandatoryReferral)||
   (b.risk?.score??-1)-(a.risk?.score??-1)||
   a.imo.localeCompare(b.imo));
}
export class SiInspectionPlan{
 constructor({targeting,candidateAgent,
    file=process.env.SI_INSPECTION_PLAN_PATH||'/data/si-inspection-plan.json'}={}){
  if(!targeting||!candidateAgent)throw Error('SI_PLAN_CONFIGURATION_INVALID');
  this.targeting=targeting;this.agent=candidateAgent;this.file=file;this.busy=false;
 }
 read(){return existsSync(this.file)?safeRecord(JSON.parse(readFileSync(this.file,'utf8'))):empty();}
 async snapshot(){
  const [source,dashboard]=await Promise.all([this.agent.source(),this.targeting.dashboard()]);
  const state=this.read();
  const current=state.latest?.snapshotHash===source.snapshotHash?state.latest:null;
  const rows=projectInspectionPlan(dashboard,source,current,state.overrides);
  return {status:'ok',provider:this.agent.provider.toUpperCase(),
   mock:this.agent.provider==='mock',sourceHash:source.snapshotHash,
   revision:state.revision,generatedAt:current?.generatedAt||null,
   agentRunId:current?.agentRunId||null,stale:Boolean(state.latest&&!current),
   externalCallsOnRead:0,aiRecommendedVessels:current?
    rows.filter(r=>r.aiRecommended).length:null,
   selectedForPlan:current?rows.filter(r=>r.planSelected).length:null,
   approvedCases:dashboard.summary.inspectionsCreated,
   warning:'ADVISORY INSPECTION PLAN ONLY: not regulatory approval, PSC quota selection or scheduling.',
   rows};
 }
 async rerank(input={}){
  if(this.busy)throw new SiCandidateAgentError('SI_PLAN_RECALCULATION_IN_PROGRESS',409);
  const actor=input?.actor?.trim?.();
  if(!actor||actor.length>120||input.confirmRun!==true||
     (this.agent.provider==='airia'&&input.confirmCost!==true))
   throw new SiCandidateAgentError('SI_PLAN_CONFIRMATION_REQUIRED',422);
  this.busy=true;
  try{
   const state=this.read();
   const source=await this.agent.source();
   if(input.expectedSourceHash!==source.snapshotHash||
      input.expectedRevision!==state.revision)
    throw new SiCandidateAgentError('SI_PLAN_CHANGED_REFRESH_REQUIRED',409);
   let changes={...state.overrides},change=null;
   if(input.change!==undefined&&input.change!==null){
    const x=input.change;
    const reason=x.reason?.trim?.();
    if(!/^\d{7}$/.test(x.imo||'')||typeof x.selected!=='boolean'||
       !reason||reason.length<8||reason.length>500||
       (x.requestedRank!==null&&x.requestedRank!==undefined&&
         (!Number.isInteger(x.requestedRank)||x.requestedRank<1||x.requestedRank>100)))
     throw new SiCandidateAgentError('SI_PLAN_CHANGE_INVALID',422);
    if(!source.candidates.some(c=>c.imo===x.imo))
     throw new SiCandidateAgentError('SI_PLAN_CANDIDATE_NOT_PENDING',409);
    change={imo:x.imo,selected:x.selected,requestedRank:x.selected?
      (x.requestedRank??null):null,reason,actor,at:iso()};
    changes[x.imo]=change;
   }
   // A single explicit mock/real C01 run. No provider calls from GET or page load.
   // If Airia/validation fails, NOT EVEN the officer change is committed.
   const ai=await this.agent.run({actor,confirmRun:true,confirmCost:input.confirmCost===true,
     expectedSnapshotHash:source.snapshotHash});
   const current=await this.agent.source();
   if(current.snapshotHash!==source.snapshotHash||
      this.read().revision!==state.revision)
    throw new SiCandidateAgentError('SI_PLAN_SOURCE_CHANGED_RETRY',409);
   const dashboard=await this.targeting.dashboard();
   const rows=projectInspectionPlan(dashboard,source,ai,changes);
   const next={revision:state.revision+1,overrides:changes,
    latest:{...ai,rows,generatedAt:iso()},
    audit:[...state.audit,{id:randomUUID(),at:iso(),actor,
      action:change?'OFFICER_CHANGE_AND_C01_REEVALUATION':'C01_INITIAL_EVALUATION',
      sourceHash:source.snapshotHash,runId:ai.agentRunId,change}].slice(-200)};
   atomicSave(this.file,next);
   return {status:'RECALCULATED',provider:ai.provider,mock:ai.mock,
    agentRunId:ai.agentRunId,externalCalls:ai.externalCalls,
    revision:next.revision,sourceHash:source.snapshotHash,
    aiRecommendedVessels:rows.filter(r=>r.aiRecommended).length,
    selectedForPlan:rows.filter(r=>r.planSelected).length,
    humanApprovalStillRequired:true,rows};
  }finally{this.busy=false;}
 }
}
