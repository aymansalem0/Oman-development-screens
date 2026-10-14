import { createServer } from 'node:http';
import {MoeiPocAuth,MoeiAuthError} from './moei-poc-auth.mjs';
import {SiChecklistLibrary,SiChecklistError} from './si-checklist-library.mjs';
import {SiChecklistField} from './si-checklist-field.mjs';
import {SiChecklistAiria} from './si-checklist-airia.mjs';
import {OracleSiChecklistLibrary,OracleSiChecklistField} from './si-checklist-oracle.mjs';
import {MoeiGoogleUsers,MoeiUsersError} from './moei-google-users.mjs';
import {MoeiGoogleSso} from './moei-google-sso.mjs';
import { getPscVessel, getPscHealth } from './psc-reader.mjs';
import { FleetAssessmentManager } from './fleet-ai.mjs';
import {airiaDemoVessels,AIRIA_DEMO_COHORT,AIRIA_DEMO_99_IMOS} from './airia-demo-cohort.mjs';
import { FleetAutoScheduler } from './fleet-scheduler.mjs';
import { DashboardWorkspace, DashboardError } from './dashboard-workspace.mjs';
import {DashboardAiFocus,DashboardFocusError,selectDashboardFocusVessel} from './nmc-dashboard-focus.mjs';
import { NmcAlertWorkspace, NmcAlertError } from './alert-workspace.mjs';
import { NmcCaseWorkspace, NmcCaseError } from './case-workspace.mjs';
import {evaluateCaseAssessment,historicalApprovalValid} from './case-source-provenance.mjs';
import {NmcIncidentFeed,IncidentTriageError} from './nmc-incident-feed.mjs';
import {createAiriaIncidentTriage} from './nmc-incident-airia.mjs';
import { normalizeA01Actions, ActionPlanError } from './nmc-action-plan.mjs';
import {catalogueSummaries,DECISION_POLICY_VERSION} from './nmc-decision-policy.mjs';
import { OperationalGuidance, GuidanceError } from './operational-guidance.mjs';
import { CentralRiskPolicy, RiskPolicyError } from './risk-policy.mjs';
import { ErpWorkforceStore, SiError } from './si-erp-workforce.mjs';
import { SiElectronicScheduler } from './si-electronic-scheduling.mjs';
import {proposeMaritimeBatchSchedule} from './si-maritime-batch-scheduling.mjs';
import {prepareS01WholePlanRequest,validateS01WholePlanResponse}
 from './si-plan-s01-advisor.mjs';
import {maritimePlanSchedulingContext,validateOperatorScheduleAgainstSource} from './si-maritime-plan-source.mjs';
import {buildPocErpSchedulingOverlay,fillPocSchedulingVisitContext,
 validatePocSchedulingDemoRequest} from './si-scheduling-poc-fixtures.mjs';
import { SiCandidateTargeting, SiTargetingError } from './si-candidate-targeting.mjs';
import {selectIntegratedPlanVessels,makeCapacityDraftPlan,
 validateIntegratedCapacityProposal,SiIntegratedPlanError}
 from './si-integrated-capacity-plan.mjs';
import { SiSourceExcelImport } from './si-source-excel-import.mjs';
import {projectVesselMasterEtd} from './si-vessel-master-etd.mjs';
import { SiPscSelection, SiSelectionError } from './si-psc-selection.mjs';
import { SiAiPrioritization, SiPriorityError } from './si-ai-prioritization.mjs';
import {SiCandidateAgent,SiCandidateAgentError} from './si-candidate-agent.mjs';
import {SiInspectionPlan} from './si-inspection-plan.mjs';
import {SiRollingPlanStore,SiRollingPlanError} from './si-rolling-plan-store.mjs';
import {SiBulkInspectionPlan,SiBulkApprovalError} from './si-bulk-inspection-plan.mjs';
import {mockSiP01,mockSiA04,mockSiC01} from './si-agent-mock.mjs';
import { SiInspectionPreparation, SiPreparationError } from './si-inspection-preparation.mjs';
import {assembleSiVesselDossier} from './si-vessel-dossier.mjs';
import {suggestCapacityExceptionActions} from './si-capacity-exception-alternatives.mjs';
import { SiInspectionLifecycle, SiLifecycleError } from './si-inspection-lifecycle.mjs';
import {SiScheduleOrders,SiWorkOrderError} from './si-schedule-orders.mjs';
import {runSiPocAdvisor,siFutureAdvisorCoverage,SiPocAdvisorError} from './si-poc-workflow-advisors.mjs';
import {runSiAiriaAdvisor} from './si-airia-workflow-advisors.mjs';
import {makeDq01Request,validateDq01Response,DqAgentError} from './nmc-airia-data-quality.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {join as joinPath} from 'node:path';
import {createHash as shaForMedia} from 'node:crypto';
import { DriveDocumentIntelligence, DocumentError } from './drive-document-intelligence.mjs';
import {buildA03MultipartUserInput,summarizeA03HttpFailure} from './airia-a03-multipart.mjs';
import { RuntimeSettings, RuntimeSettingsError } from './runtime-settings.mjs';
import {AiCredentialVault,AiSecretError} from './ai-credential-vault.mjs';

const port = Number(process.env.PORT || 3000);
const moeiAuthMode=(process.env.MOEI_AUTH_MODE||'google').toLowerCase();
const googleUsers=new MoeiGoogleUsers();
const googleSso=new MoeiGoogleSso();
const moeiAuth=new MoeiPocAuth({
  sessionValidator:user=>user.provider!=='google'||
    (moeiAuthMode==='google'&&Boolean(googleUsers.allowed(user.email,user.sub))&&
     googleUsers.allowed(user.email,user.sub).role===user.role)
});
const aiCredentialVault=new AiCredentialVault();
const getAiriaKey=()=>aiCredentialVault.get();
const runtime=new RuntimeSettings();
runtime.load();
const agentAllowed=agent=>{
  const k={a01:'NMC_A01_ENABLED',a02:'NMC_A02_ENABLED',a03:'NMC_A03_ENABLED',
    a04:'SI_A04_ENABLED',p01:'SI_P01_ENABLED',c01:'SI_C01_ENABLED',
    dq01:'NMC_DQ01_ENABLED',s01:'SI_S01_ENABLED',v01:'SI_V01_ENABLED',
    r01:'SI_R01_ENABLED',x01:'SI_X01_ENABLED'}[agent];
  return k?runtime.get(k):false;};
const airiaTimeout=()=>runtime.get('AIRIA_TIMEOUT_MS');
const maxBytes = 1024 * 1024; // Single agent call body.
// SI only: no NMC A01/A02 behavior is changed by this feature flag.
let siAiProvider=runtime.get('SI_AI_PROVIDER');
const autoEnabled = process.env.NMC_FLEET_AUTO_ENABLED === 'true';
const autoInterval = Number(process.env.NMC_FLEET_REFRESH_SECONDS || 3600) * 1000;

// Partner API guide, 08 Oct 2026, A01-A04 v3.1.
const pipelines = {
  get a01(){return runtime.get('AIRIA_A01_PIPELINE_ID');},
  get a02(){return runtime.get('AIRIA_A02_PIPELINE_ID');},
  get a03(){return runtime.get('AIRIA_A03_PIPELINE_ID');},
  get a04(){return runtime.get('AIRIA_A04_PIPELINE_ID');},
  get c01(){return runtime.get('AIRIA_SI_C01_PIPELINE_ID');},
  get p01(){return runtime.get('AIRIA_SI_P01_PIPELINE_ID');},
  get dq01(){return runtime.get('AIRIA_NMC_DQ01_PIPELINE_ID');},
  get s01(){return runtime.get('AIRIA_SI_S01_PIPELINE_ID');},
  get v01(){return runtime.get('AIRIA_SI_V01_PIPELINE_ID');},
  get r01(){return runtime.get('AIRIA_SI_R01_PIPELINE_ID');},
  get x01(){return runtime.get('AIRIA_SI_X01_PIPELINE_ID');}
};

async function fleetAgentCall(agent,input) {
  if (!getAiriaKey()) throw new Error('AIRIA_NOT_CONFIGURED');
  if(!pipelines[agent])throw new Error('AIRIA_PIPELINE_NOT_CONFIGURED');
  if (!agentAllowed(agent)) throw new Error('AIRIA_AGENT_DISABLED');
  const upstream=await fetch(runtime.get('AIRIA_BASE_URL')+'/v1/PipelineExecution/'+pipelines[agent],{
    method:'POST',
    headers:{'X-API-KEY':getAiriaKey(),'Content-Type':'application/json','User-Agent':'moei-nmc-fleet/1.0'},
    body:JSON.stringify({userInput:JSON.stringify(input),asyncOutput:false}),
    signal:AbortSignal.timeout(airiaTimeout())
  });
  if (!upstream.ok) throw new Error('AIRIA_REQUEST_FAILED_'+upstream.status);
  const raw=await upstream.text();
  try {return JSON.parse(raw);} catch {throw new Error('AIRIA_RESPONSE_INVALID_JSON');}
}
/**
 * A03 document uploads use the partner-documented multipart pipeline route.
 * Explicit opt-out AIRIA_A03_TRANSPORT=inline retains the text-only POC path.
 * Only ONE Airia call is attempted; no automatic fallback/retry.
 */
async function a03AgentCall(payload) {
  const {attachment,...input}=payload;
  if(runtime.get('AIRIA_A03_TRANSPORT')==='inline'||
     !attachment||attachment.mimeType!=='application/pdf')
    return fleetAgentCall('a03',input);
  if(!getAiriaKey())throw new Error('AIRIA_NOT_CONFIGURED');
  if(!pipelines.a03)throw new Error('AIRIA_PIPELINE_NOT_CONFIGURED');
  if(!agentAllowed('a03'))throw new Error('AIRIA_AGENT_DISABLED');
  if(!Buffer.isBuffer(attachment.bytes)||!attachment.bytes.length)
    throw new Error('A03_DOCUMENT_ATTACHMENT_MISSING');
  const form=new FormData();
  form.set('userInput',JSON.stringify(buildA03MultipartUserInput(input)));
  form.set('file',new Blob([attachment.bytes],{type:'application/pdf'}),
    attachment.fileName);
  let upstream;
  try{
    upstream=await fetch(runtime.get('AIRIA_BASE_URL')+
      '/v1/PipelineExecution/Multipart/'+pipelines.a03,{
      method:'POST',
      headers:{'X-API-KEY':getAiriaKey(),'User-Agent':'moei-nmc-adapter/1.0'},
      body:form,
      signal:AbortSignal.timeout(airiaTimeout())
    });
  }catch(error){
    // Never log credentials, request body, source PDF or upstream error messages.
    const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';
    throw new DocumentError(timeout?'AIRIA_A03_TIMEOUT':'AIRIA_A03_NETWORK_UNAVAILABLE',502);
  }
  if(!upstream.ok){
    let errorBody='';
    try{errorBody=(await upstream.text()).slice(0,16384);}catch{}
    const diagnostic=summarizeA03HttpFailure(upstream.status,errorBody,
      upstream.headers.get('content-type')||'');
    console.error('[nmc-a03] UPSTREAM_HTTP_FAILURE '+JSON.stringify(diagnostic));
    throw new DocumentError('AIRIA_A03_HTTP_'+upstream.status,502);
  }
  let raw;
  try{raw=await upstream.text();}
  catch{throw new DocumentError('AIRIA_A03_RESPONSE_READ_FAILED',502);}
  try{return JSON.parse(raw);}
  catch{throw new DocumentError('AIRIA_A03_RESPONSE_INVALID_JSON',502);}
}

const dbMode=(process.env.NMC_DB_MODE || 'json').toLowerCase();
const checklistStorage=(process.env.SI_CHECKLIST_STORAGE||
 (dbMode==='oracle'?'oracle':'json')).toLowerCase();
if(!['oracle','json'].includes(checklistStorage)||
 (checklistStorage==='oracle'&&dbMode!=='oracle'))
 throw new Error('SI_CHECKLIST_STORAGE_MODE_INVALID');
if(!['json','oracle'].includes(dbMode))throw new Error('NMC_DB_MODE_UNSUPPORTED');
const repository=dbMode==='oracle'
  ? new (await import('./oracle-store.mjs')).OracleIntelligenceStore()
  : null;
let guidance;
let riskPolicy;
const documents=new DriveDocumentIntelligence({mode:dbMode,oracleRepository:repository,
  executeA03:a03AgentCall,
  enabled:runtime.get('NMC_A03_ENABLED')&&Boolean(getAiriaKey())});
const fleet=new FleetAssessmentManager({executeAgent:fleetAgentCall,getPscVessel,repository,
  approvedDocuments:async imo=>documents.ready?documents.approvedFor(imo):[],
  documentEvidence:async imo=>documents.ready?
    documents.syncForRisk(imo,{autoEnabled:runtime.get('NMC_A03_AUTO_ENABLED')}):[],
  onAssessmentSaved:async row=>{
    try{await guidance?.materialize(row.imo);}
    catch{console.error('[nmc-guidance] RESULT_MATERIALIZATION_FAILED');}
    try{await riskPolicy?.materializeCurrent(row);}
    catch{console.error('[nmc-risk-policy] PROJECTION_MATERIALIZATION_FAILED');}
  }});
guidance=new OperationalGuidance({mode:dbMode,oracleRepository:repository,fleet});
riskPolicy=new CentralRiskPolicy({mode:dbMode,oracleRepository:repository,fleet});
const dashboards=new DashboardWorkspace({mode:dbMode,oracleRepository:repository});
/** Existing A01/A02 business contracts are reused for maritime-risk dashboard
 * prioritization. The subject remains a real, already-assessed vessel; aggregate
 * KPI values are supplementary POC context and never a new risk signal. */
const dashboardAiFocus=new DashboardAiFocus({
  executeAgent:fleetAgentCall,
  // Read the published governance toggle on every request: no container restart
  // required after an authorized settings publication. OFF by default.
  enabled:()=>Boolean(getAiriaKey())&&agentAllowed('a01')&&agentAllowed('a02')&&
    runtime.get('NMC_DASHBOARD_AI_FOCUS_ENABLED'),
  selectVessel:()=>selectDashboardFocusVessel(fleet,incidentBundleMap)
});
const alerts=new NmcAlertWorkspace({mode:dbMode,oracleRepository:repository});
const cases=new NmcCaseWorkspace({mode:dbMode,oracleRepository:repository,alerts});
// Incident POC reuses exactly the existing A02 requestedSignals and A01
// SITUATION_ASSESSMENT contracts; new business evidence is supplied inside
// already-supported context fields. No separate model/pipeline or new output.
const incidentAgentEnabled=()=>Boolean(getAiriaKey())&&agentAllowed('a01')&&agentAllowed('a02');
const incidentBundleRecords=airiaDemoVessels(JSON.parse((await import('node:fs')).readFileSync(
  new URL('./fleet-bundles.json',import.meta.url),'utf8')));
const incidentBundleMap=new Map(incidentBundleRecords.map(row=>[row.imo,row]));
const incidentAiria=createAiriaIncidentTriage({
  executeAgent:fleetAgentCall,
  getFleetResult:imo=>fleet.getVesselResult(imo),
  getBundle:imo=>incidentBundleMap.get(imo)||null,
  enabled:incidentAgentEnabled
});
const incidentFeed=new NmcIncidentFeed({
  executeIncidentAgents:incidentAiria,
  agentEnabled:incidentAgentEnabled,
  onAssessmentReady:async incident=>{
    // Inbound event creates/links a PENDING case only; no task is created until
    // authorized Case Management human review. Never update source incident.
    if(!AIRIA_DEMO_99_IMOS.has(incident.imo))return null;
    const saved=fleet.getVesselResult(incident.imo);
    return cases.fromIncident(incident,incident.aiAssessment,saved);
  }
});
async function incidentCaseView(){
  const feed=await incidentFeed.load();
  let persisted=[];
  try{persisted=await cases.list();}
  catch{ /* case store unavailable must not hide source incident records */ }
  return {...feed,incidents:feed.incidents.filter(x=>AIRIA_DEMO_99_IMOS.has(x.imo)).map(incident=>{
    const linked=persisted.find(row=>
      (row.incidentEvents||[]).some(ev=>ev.incidentId===incident.incidentId&&
        ev.descriptionHash===incident.descriptionHash));
    return {...incident,linkedCaseId:linked?.id||null,
      linkedCaseStatus:linked?.status||null,
      caseIncidentDecisionStatus:linked?.incidentEvents?.find(ev=>
        ev.incidentId===incident.incidentId)?.decisionStatus||null};
  })};
}
// Independent POC scheduling workspace; ONLY confirmed existing NMC referrals
// are written through the established Oracle-backed case API.
const siErp=new ErpWorkforceStore();
const siScheduling=new SiElectronicScheduler({erp:siErp,cases});
// Incident severity is separate from A02 vessel-risk. Only fresh, officer-
// reviewed, still-active NMC incident assessments are eligible for SI ordering.
// Optional synthetic POC feed: no automatic AI call, and never block targeting.
let incidentPriorityCache={expires:0,items:[]};
const loadVerifiedIncidentPriorities=async()=>{
  if(!incidentFeed.configured)return [];
  if(Date.now()<incidentPriorityCache.expires)return incidentPriorityCache.items;
  try{
    const feed=await incidentFeed.load();
    const rows=feed.incidents.filter(row=>
      row.imo&&row.aiAssessment&&!row.aiAssessmentStale&&
      row.aiAssessment.assessmentStatus==='HUMAN_REVIEWED'&&
      row.nextFollowup?.approval==='OFFICER_APPROVED'&&
      !['RESOLVED','CLOSED'].includes(row.operationalStatus)&&
      Number.isFinite(row.aiAssessment.incidentRiskScore)
    ).map(row=>({
      imo:row.imo,incidentId:row.incidentId,
      severity:row.aiAssessment.incidentRiskScore,
      operationalStatus:row.operationalStatus,humanReviewed:true
    }));
    incidentPriorityCache={expires:Date.now()+60000,items:rows};
  }catch{
    // Explicitly unknown rather than incident severity 0, never fabricate.
    incidentPriorityCache={expires:Date.now()+15000,items:[]};
  }
  return incidentPriorityCache.items;
};
const siTargeting=new SiCandidateTargeting({mode:dbMode,oracleRepository:repository,
  cases,riskPolicy,bundles:incidentBundleRecords,
  loadIncidentSignals:loadVerifiedIncidentPriorities});
const siSourceImports=new SiSourceExcelImport({targeting:siTargeting});
const siPscSelection=new SiPscSelection({targeting:siTargeting,mode:dbMode,oracleRepository:repository});
siTargeting.pscSelection=siPscSelection;
const siPriority=new SiAiPrioritization({
  targeting:siTargeting,mode:dbMode,oracleRepository:repository,provider:siAiProvider,
  executeAgent:async input=>siAiProvider==='mock'?mockSiP01(input):fleetAgentCall('p01',input),
  // P01 retired, including MOCK mode and legacy settings.
  enabled:false
});
const siCandidateAgent=new SiCandidateAgent({
  targeting:siTargeting,pscPolicy:async()=>{
    const pool=await siPscSelection.pool();
    return {...pool.policy,quotaSnapshot:{
      scope:pool.scope,periodMode:pool.periodMode,
      source:'PUBLISHED_RULES_ON_PERSISTED_PSC_EXCEL',
      eligibleEvents:pool.summary.eligiblePortCalls,
      shortlistedEvents:pool.summary.selectedPortCalls,
      automaticEvents:pool.summary.automaticallyShortlistedPortCalls,
      buckets:pool.summary.buckets.map(b=>({
        bucket:b.bucket,ratePercent:b.selectionRate,
        eligibleEvents:b.eligiblePortCalls,quotaTarget:b.targetCount,
        shortlistedEvents:b.selectedCount,overQuota:b.overQuota
      })),
      modelMayOverrideQuota:false,
      officialSelectionRequiresOfficer:true
    }};
  },provider:siAiProvider,
  executeAgent:async input=>siAiProvider==='mock'?mockSiC01(input):fleetAgentCall('c01',input)
});
const siRollingPlans=new SiRollingPlanStore({mode:dbMode,oracleRepository:repository});
let siRollingPlansReady=false;
const siInspectionPlan=new SiInspectionPlan({
  targeting:siTargeting,candidateAgent:siCandidateAgent,rollingPlans:siRollingPlans
});
const siPreparation=new SiInspectionPreparation({mode:dbMode,oracleRepository:repository,
  targeting:siTargeting,riskPolicy,provider:siAiProvider,
  approvedDocuments:async imo=>documents.ready?documents.approvedFor(imo):[],
  bundles:siTargeting.bundles,
  executeA04:async input=>siAiProvider==='mock'?mockSiA04(input):fleetAgentCall('a04',input),
  enabled:siAiProvider==='mock'||(runtime.get('SI_A04_ENABLED')&&Boolean(getAiriaKey()))});
/** Only real, case-owned, inspector-reviewed image bytes can be sent to V01.
 * A checklist AI draft by itself is NOT sufficient for regulatory evidence. */
async function verifiedSiVisionMedia(caseId,view){
  let preview;
  try{preview=await siChecklistField.preview(caseId);}catch{
    throw new SiPocAdvisorError('SI_V01_REVIEWED_CHECKLIST_EVIDENCE_REQUIRED',409);
  }
  const saved=preview.saved;
  if(!saved||!Array.isArray(saved.proposals)||!Array.isArray(saved.templates))
    throw new SiPocAdvisorError('SI_V01_REVIEWED_CHECKLIST_EVIDENCE_REQUIRED',409);
  const items=saved.templates.flatMap(t=>(t.groups||[]).flatMap(g=>(g.items||[])
    .map(item=>({item,revision:t.revision}))));
  for(const proposal of [...saved.proposals].reverse()){
    const e=proposal.imageEvidenceRef;
    if(!e||!/^[a-f0-9-]{36}$/i.test(e.id||'')||
       !(proposal.reviews||[]).some(r=>['ACCEPT','EDIT'].includes(r.decision)))continue;
    const linked=items.find(x=>(x.item.evidenceRefs||[]).includes('SI-IMG:'+e.id));
    if(!linked)continue;
    const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[e.mimeType];
    if(!ext)continue;
    const path=joinPath(process.env.SI_CHECKLIST_EVIDENCE_PATH||'/data/si-checklist-evidence',caseId,e.id+ext);
    if(!existsSync(path))continue;
    const bytes=readFileSync(path);
    if(!bytes.length||bytes.length>2*1024*1024||
      shaForMedia('sha256').update(bytes).digest('hex')!==e.sha256)continue;
    return {caseId,bytes,evidenceId:e.id,checklistItemId:linked.item.id,
      checklistVersion:String(linked.revision||''),sha256:e.sha256,mimeType:e.mimeType,
      observation:linked.item.note||'',baseCheckMandatory:linked.item.mandatory||false};
  }
  throw new SiPocAdvisorError('SI_V01_REVIEWED_CASE_IMAGE_REQUIRED',409);
}
async function callSiVisionAiria(request,media){
  if(!getAiriaKey()||!agentAllowed('v01')||!pipelines.v01)
    throw new Error('AIRIA_V01_NOT_CONFIGURED');
  const form=new FormData();form.set('userInput',JSON.stringify(request));
  form.set('file',new Blob([media.bytes],{type:media.mimeType}),media.evidenceId+({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[media.mimeType]||'.bin'));
  const upstream=await fetch(runtime.get('AIRIA_BASE_URL')+'/v1/PipelineExecution/Multipart/'+pipelines.v01,{
    method:'POST',headers:{'X-API-KEY':getAiriaKey(),'User-Agent':'moei-si-v01/1.0'},
    body:form,signal:AbortSignal.timeout(airiaTimeout())
  });
  if(!upstream.ok)throw new Error('AIRIA_V01_HTTP_'+upstream.status);
  return upstream.json();
}

const siBulkPlan=new SiBulkInspectionPlan({
  inspectionPlan:siInspectionPlan,targeting:siTargeting,
  preparation:siPreparation,priority:siPriority
});
const siChecklistLibrary=checklistStorage==='oracle'?
 new OracleSiChecklistLibrary({oracle:repository}):new SiChecklistLibrary();
const siChecklistAiria=new SiChecklistAiria({
  getSetting:key=>runtime.get(key),
  getApiKey:getAiriaKey
});
const siChecklistField=new (checklistStorage==='oracle'?
 OracleSiChecklistField:SiChecklistField)({
  ...(checklistStorage==='oracle'?{oracle:repository}:{}) ,
  library:siChecklistLibrary,targeting:siTargeting,
  airiaSuggest:input=>siChecklistAiria.call('vision',input),
  getSetting:key=>runtime.get(key)
});
const siLifecycle=new SiInspectionLifecycle({mode:dbMode,oracleRepository:repository,
  targeting:siTargeting,preparation:siPreparation,cases,checklists:siChecklistField,
  onClosed:(caseId,actor)=>siRollingPlans.completeIfAllClosed(caseId,actor,siLifecycle)});
const siScheduleOrders=new SiScheduleOrders({
 mode:dbMode,oracleRepository:repository,rolling:siRollingPlans,
 targeting:siTargeting,preparation:siPreparation,
 checklists:siChecklistField,lifecycle:siLifecycle,cases
});
const actionPlanRuns=new Set(); // process-local duplicate A01 invocation guard; version-lock remains authoritative
let alertScanTimer=null;
function rescheduleAlertScan(){
  if(alertScanTimer){clearInterval(alertScanTimer);alertScanTimer=null;}
  if(!runtime.get('NMC_ALERT_SCAN_ENABLED'))return;
  alertScanTimer=setInterval(()=>void scanExistingFleetForAlerts(),runtime.get('NMC_ALERT_SCAN_SECONDS')*1000);
  alertScanTimer.unref?.();
  void scanExistingFleetForAlerts();
}
async function scanExistingFleetForAlerts(){
  try{
    // Only saved A01/A02 signals; central published risk policy is authoritative
    // for current notification eligibility. Prior cases/assessment rows are immutable.
    const original=fleet.snapshot();
    let effective=original;
    if(riskPolicy.ready){
      const projected=await riskPolicy.projectCurrent();
      const byImo=new Map(projected.projections.map(p=>[p.imo,p]));
      effective={...original,results:Object.fromEntries(Object.entries(original.results).map(([imo,row])=>{
        const p=byImo.get(imo);
        return [imo,p&&p.sourceAssessmentId===row.assessmentId?{
          ...row,score:p.riskScore,level:p.riskLevel,
          operationalPriority:p.operationalPriority,criticalOpenFinding:p.criticalOpenFinding,
          configVersion:projected.policyRef,riskPolicyRevision:projected.policyRevision,
          sourceAiScore:row.score,sourceAiLevel:row.level,aiRulesetVersion:row.configVersion
        }:{...row,policyProjectionUnavailable:true}];
      }))};
    }
    const result=await alerts.scanFleet(effective);
    if(result?.created||result?.escalated)
      console.info('[nmc-alerts] detected='+result.created+' escalated='+result.escalated);
  }catch(error){
    const code=error instanceof NmcAlertError?error.code:'ALERT_SCAN_FAILED';
    console.error('[nmc-alerts] '+code);
  }
}
/** Overlay CURRENT central policy on a saved immutable assessment snapshot.
 * Original A01/A02 result and ruleset remain referenced for audit/history.
 * No DB writes, no AI, no source assessment mutation. */
async function effectiveFleetSnapshot(snapshot){
  if(!riskPolicy.ready)return {...snapshot,riskPolicyStatus:'NOT_READY'};
  const active=await riskPolicy.projectCurrent();
  const byImo=new Map(active.projections.map(p=>[p.imo,p]));
  const results={};
  const counts={...snapshot.counts,normal:0,watch:0,high:0,critical:0,priorityReview:0};
  for(const [imo,row] of Object.entries(snapshot.results)){
    const p=byImo.get(imo);
    if(p&&p.sourceAssessmentId===row.assessmentId&&row.status==='COMPLETED'){
      results[imo]={...row,
        sourceAiScore:row.score,sourceAiLevel:row.level,
        sourceAiConfigVersion:row.configVersion,
        score:p.riskScore,level:p.riskLevel,
        operationalPriority:p.operationalPriority,
        configVersion:active.policyRef,
        activePolicyRevision:active.policyRevision,
        scoringSource:'CURRENT_CENTRAL_RISK_POLICY'};
    }else results[imo]={...row,
      scoringSource:row.status==='COMPLETED'?'ORIGINAL_AI_ASSESSMENT_UNPROJECTED':null};
    const current=results[imo];
    if(current.status==='COMPLETED'){
      const band=current.level?.toLowerCase();
      if(['normal','watch','high','critical'].includes(band))counts[band]++;
      if(current.operationalPriority==='Priority Review')counts.priorityReview++;
    }
  }
  return {...snapshot,results,counts,activePolicyRevision:active.policyRevision,
    activePolicyRef:active.policyRef,riskPolicyStatus:'ACTIVE'};
}
const scheduler=new FleetAutoScheduler({fleet,getPscVessel,
  getRiskConfig:async()=>{
    if(!riskPolicy.ready)throw new Error('RISK_POLICY_NOT_READY');
    const published=await riskPolicy.active();
    return {...published.config,version:published.config.version||published.policyRef};
  },
  getDocumentFingerprint:async imo=>documents.ready?
    documents.fingerprint(imo):'A03_NOT_READY',
  enabled:runtime.get('NMC_FLEET_AUTO_ENABLED')&&Boolean(getAiriaKey()),
  intervalMs:runtime.get('NMC_FLEET_REFRESH_SECONDS')*1000,
  maxVessels:runtime.get('NMC_FLEET_AUTO_MAX_VESSELS'),
  retryFailed:runtime.get('NMC_FLEET_AUTO_RETRY_FAILED')});
function applyRuntimeSettings(){
  siAiProvider=runtime.get('SI_AI_PROVIDER');
  siPriority.provider=siAiProvider;
  siCandidateAgent.provider=siAiProvider;
  siPreparation.provider=siAiProvider;
  scheduler.stop();
  scheduler.enabled=runtime.get('NMC_FLEET_AUTO_ENABLED')&&
    runtime.get('NMC_A01_ENABLED')&&runtime.get('NMC_A02_ENABLED')&&Boolean(getAiriaKey());
  scheduler.intervalMs=runtime.get('NMC_FLEET_REFRESH_SECONDS')*1000;
  scheduler.maxVessels=runtime.get('NMC_FLEET_AUTO_MAX_VESSELS');
  scheduler.retryFailed=runtime.get('NMC_FLEET_AUTO_RETRY_FAILED');
  alerts.escalationMinutes=runtime.get('NMC_ALERT_ESCALATE_MINUTES');
  documents.enabled=runtime.get('NMC_A03_ENABLED')&&Boolean(getAiriaKey());
  siPreparation.enabled=siAiProvider==='mock'||(runtime.get('SI_A04_ENABLED')&&Boolean(getAiriaKey()));
  siPriority.enabled=false; // C01 before plan approval; S01 for feasible slots
  if(server.listening){scheduler.start();rescheduleAlertScan();}
}
runtime.onChange=applyRuntimeSettings;

function respond(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function requestJson(req, limit = maxBytes) {
  let received = 0;
  const chunks = [];
  for await (const chunk of req) {
    received += chunk.length;
    if (received > limit) {
      const error = new Error('JSON request exceeds permitted limit');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request must be valid JSON');
    error.status = 400;
    throw error;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('Request must contain a JSON object');
    error.status = 400;
    throw error;
  }
  return parsed;
}


// Read-only preview using the exact saved case assessment; no Airia calls.
// A newer vessel assessment may exist, but it is NEVER substituted for the
// immutable source of this case or its recorded risk score.
async function caseA01SourcePreview(item){
  const current=fleet.getVesselResult(item.imo);
  const needHistory=Boolean(item.sourceAssessmentId)&&
    item.sourceAssessmentId!==current?.assessmentId;
  const historical=needHistory&&repository?.loadAssessmentById
    ?await repository.loadAssessmentById(item.sourceAssessmentId):null;
  return evaluateCaseAssessment(item,current,historical);
}

// Only an explicit operator creation or retry calls Airia A01: never GET,
// dashboard display, alert scanning or page refresh.
async function prepareCaseA01Actions(caseId,version,approval={}){
          const existing=await cases.get(caseId);
          if(!existing)throw new NmcCaseError('CASE_NOT_FOUND',404);
          if(existing.version!==version)throw new NmcCaseError('CASE_VERSION_CONFLICT',409);
          if(existing.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
          if(existing.actionPlan)throw new NmcCaseError('CASE_ACTION_PLAN_EXISTS',409);
          if(actionPlanRuns.has(caseId))throw new NmcCaseError('CASE_ACTION_PLAN_IN_PROGRESS',409);
          if(!getAiriaKey())throw new NmcCaseError('AIRIA_NOT_CONFIGURED',503);
          // Strong provenance check: use ONLY the exact saved A01/A02 assessment
          // that initiated this case. Never silently use the synthetic fixture or
          // a newer scored assessment that superseded the event.
          const preview=await caseA01SourcePreview(existing);
          const approvalResult=historicalApprovalValid(preview,approval);
          if(!approvalResult.ok)throw new NmcCaseError(approvalResult.error,409);
          const source=preview.source;
          // Older PR42 alerts omitted the assessment ID from the snapshot.
          // Reconcile ONLY when the persisted alert timestamp/ruleset and current
          // saved AI source prove it was already assessed before that alert.
          let legacyReconciled=false;
          if(source.assessmentId!==existing.sourceAssessmentId){
            const alert=existing.sourceAssessmentId===null&&existing.alertIds?.length
              ?await alerts.get(existing.alertIds[0]):null;
            const assessedAt=Date.parse(source.assessedAt||'');
            const alertedAt=Date.parse(alert?.createdAt||'');
            if(!alert||alert.imo!==existing.imo||
              alert.sourceAssessmentId!==null||
              alert.sourceScore!==source.score||alert.sourceLevel!==source.level||
              !alert.sourceRulesetVersion||
              alert.sourceRulesetVersion!==source.configVersion||
              !source.assessmentId||!Number.isFinite(assessedAt)||
              !Number.isFinite(alertedAt)||assessedAt>alertedAt)
              throw new NmcCaseError('CASE_SOURCE_ASSESSMENT_UNAVAILABLE',409);
            legacyReconciled=true;
          }
          actionPlanRuns.add(caseId);
          try {
            const input={
              requestMeta:{correlationId:'CASE-'+caseId+'-'+existing.version,language:'en'},
              subject:{type:'VESSEL',imo:existing.imo},bundleRef:'VBL-'+existing.imo,
              mode:'SITUATION_ASSESSMENT',
              officialRisk:{
                evaluationId:existing.sourceAssessmentId,score:existing.sourceScore,
                level:existing.sourceLevel,rulesetVersion:source.configVersion
              },
              riskSignalRunId:existing.sourceAssessmentId,
              requestedOutputs:['SUMMARY','WHY_IT_MATTERS','EVIDENCE','ACTIONS'],
              approvedSignalEvidence:source.signals.map(s=>({
                factor:s.factor,severity:s.severity,evidenceIds:s.evidenceIds,
                reason:s.reason
              })),
              provenance:'SYNTHETIC_POC_NOT_REGULATORY'
            };
            const raw=await fleetAgentCall('a01',input);
            const plan=normalizeA01Actions(raw,{
              imo:existing.imo,assessmentId:existing.sourceAssessmentId,
              score:existing.sourceScore,level:existing.sourceLevel,
              configVersion:source.configVersion,signals:source.signals
            },{allowUnknownAsInspection:true});
            // Provenance of the evidence actually supplied to A01, distinct from
            // the immutable legacy case field that may have been null.
            plan.evidenceAssessmentId=source.assessmentId;
            plan.legacySourceReconciled=legacyReconciled;
            // Immutable historical input may differ from the vessel's newest
            // score; the operator explicitly acknowledged this before A01.
            // This does NOT constitute human approval of A01 actions.
            plan.sourceCurrency={
              historicalSource:preview.isHistorical,
              originalAssessmentId:source.assessmentId,
              latestAssessmentId:preview.latestAssessmentId,
              latestRiskScore:preview.latestScore,
              latestRiskLevel:preview.latestLevel,
              latestAssessedAt:preview.latestAssessedAt,
              explicitlyAcknowledged:preview.isHistorical,
              acknowledgedAt:preview.isHistorical?new Date().toISOString():null
            };
            return await cases.saveActionPlan(caseId,version,plan);
          }finally{actionPlanRuns.delete(caseId);}
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  // Google SSO is the default. Local password login is an explicitly opt-in
  // migration/debug mode, never a bypass when Google SSO is enabled.
  if(path==='/api/moei/auth/providers'&&req.method==='GET')
    return respond(res,200,{mode:moeiAuthMode,googleConfigured:googleSso.configured,
      googleStart:'/api/moei/auth/google/start'});
  if(path==='/api/moei/auth/google/start'&&req.method==='GET'){
    try{
      if(moeiAuthMode!=='google')throw new MoeiAuthError('MOEI_GOOGLE_SSO_DISABLED',403);
      const result=googleSso.start(req);
      res.setHeader('Set-Cookie',result.cookie);
      res.writeHead(302,{Location:result.url,'Cache-Control':'no-store'});return res.end();
    }catch(error){return respond(res,error.status||503,{error:error.code||'MOEI_GOOGLE_SSO_UNAVAILABLE'});}
  }
  if(path==='/api/moei/auth/google/callback'&&req.method==='GET'){
    const url=new URL(req.url||'/', 'http://localhost');
    let reason='MOEI_GOOGLE_LOGIN_FAILED';
    try{
      if(moeiAuthMode!=='google')throw new MoeiAuthError('MOEI_GOOGLE_SSO_DISABLED',403);
      if(url.searchParams.get('error'))throw new MoeiAuthError('MOEI_GOOGLE_AUTH_CANCELLED',401);
      const identity=await googleSso.callback(req,{
        state:url.searchParams.get('state'),code:url.searchParams.get('code')});
      const user=googleUsers.bind(identity.email,identity.sub); // verified Gmail only
      const issued=moeiAuth.issueSession(user);
      res.setHeader('Set-Cookie',[googleSso.cookie(req,'',0),moeiAuth.cookie(req,issued.token)]);
      res.writeHead(302,{Location:'/#/moei/nmc','Cache-Control':'no-store'});return res.end();
    }catch(error){
      reason=error.code||reason;
      res.setHeader('Set-Cookie',googleSso.cookie(req,'',0));
      res.writeHead(302,{Location:'/#/moei/login?error='+encodeURIComponent(reason),
        'Cache-Control':'no-store'});return res.end();
    }
  }
  if(path==='/api/moei/auth/login'&&req.method==='POST'){
    if(moeiAuthMode!=='local')
      return respond(res,403,{error:'MOEI_GOOGLE_SIGN_IN_REQUIRED'});
    try{
      const data=await requestJson(req,2048);
      const result=moeiAuth.authenticate(data?.username,data?.password,
        String(req.socket?.remoteAddress||'local'));
      res.setHeader('Set-Cookie',moeiAuth.cookie(req,result.token));
      return respond(res,200,{status:'ok',user:result.user,expiresAt:result.expiresAt});
    }catch(e){return respond(res,e.status||400,{error:e.code||'MOEI_LOGIN_INVALID'});}
  }
  if(path==='/api/moei/auth/session'&&req.method==='GET'){
    const user=moeiAuth.session(req);
    return respond(res,user?200:401,user?
      {status:'ok',user:{username:user.username,email:user.email,role:user.role,provider:user.provider},
       expiresAt:user.expiresAt}:
      {error:'MOEI_LOGIN_REQUIRED'});
  }
  if(path==='/api/moei/auth/logout'&&req.method==='POST'){
    try{
      moeiAuth.require(req);
      if(req.headers['x-moei-csrf']!=='1')throw new MoeiAuthError('MOEI_CSRF_REQUIRED',403);
      moeiAuth.logout(req);
      res.setHeader('Set-Cookie',moeiAuth.cookie(req,'',0));
      return respond(res,200,{status:'ok'});
    }catch(e){return respond(res,e.status||401,{error:e.code||'MOEI_LOGIN_REQUIRED'});}
  }
  // Deliberately not under /api/ai: these paths also need session, ADMIN,
  // CSRF and persisted, audited allowlist changes.
  if(path==='/api/moei/admin/users'&&(req.method==='GET'||req.method==='POST')){
    try{
      const actor=moeiAuth.require(req,{mutate:req.method==='POST'});
      if(actor.role!=='ADMIN')throw new MoeiAuthError('MOEI_ADMIN_REQUIRED',403);
      if(req.method==='GET')return respond(res,200,{users:googleUsers.list()});
      const data=await requestJson(req,2048);
      return respond(res,201,{user:googleUsers.add(data,actor.email||actor.username)});
    }catch(e){return respond(res,e.status||400,{error:e.code||'MOEI_USERS_REQUEST_FAILED'});}
  }
  if(path.startsWith('/api/moei/admin/users/')&&req.method==='PATCH'){
    try{
      const actor=moeiAuth.require(req,{mutate:true});
      if(actor.role!=='ADMIN')throw new MoeiAuthError('MOEI_ADMIN_REQUIRED',403);
      const email=decodeURIComponent(path.slice('/api/moei/admin/users/'.length));
      const data=await requestJson(req,2048);
      return respond(res,200,{user:googleUsers.update(email,data,actor.email||actor.username)});
    }catch(e){return respond(res,e.status||400,{error:e.code||'MOEI_USERS_REQUEST_FAILED'});}
  }
  if(path.startsWith('/api/ai/')||path.startsWith('/api/si/')||
     path==='/api/ai'||path==='/api/si'){
    const publicHealth=['/api/ai/health','/api/ai/psc/health',
      '/api/ai/nmc/incidents/health'];
    if(!publicHealth.includes(path)){
      try{moeiAuth.require(req,{mutate:!['GET','HEAD','OPTIONS'].includes(req.method)});}
      catch(e){return respond(res,e.status||401,{error:e.code||'MOEI_LOGIN_REQUIRED'});}
    }
  }

  // Unified AI Settings & Governance owns all live Airia configuration.
  // Key rotation is WRITE-ONLY and requires a server-managed AES master key.
  if(path==='/api/ai/admin/governance/credentials'){
    try{
      const user=moeiAuth.require(req,{mutate:req.method!=='GET'});
      if(user.role!=='ADMIN')return respond(res,403,{error:'AI_GOVERNANCE_ADMIN_REQUIRED'});
      if(req.method==='GET')return respond(res,200,aiCredentialVault.status());
      if(req.method==='POST'){
        const payload=await requestJson(req,4096);
        return respond(res,200,aiCredentialVault.rotate({
          ...payload,actor:user.email||user.username
        }));
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof AiSecretError||error instanceof MoeiAuthError)
       return respond(res,error.status||403,{error:error.code});
      return respond(res,503,{error:'AI_GOVERNANCE_VAULT_UNAVAILABLE'});
    }
  }
  if(path==='/api/ai/admin/runtime-settings'){
    if(req.method==='GET')return respond(res,200,runtime.publicView());
    if(req.method==='PUT'){
      try{
        dashboards.assertRole(req,'PUBLISHER');
        const input=await requestJson(req,12288);
        const identity=moeiAuth.require(req,{mutate:true});
        return respond(res,200,await runtime.publish({...input,
          actor:identity.email||identity.username}));
      }catch(error){
        if(error instanceof RuntimeSettingsError||error instanceof DashboardError)
          return respond(res,error.status,{error:error.code});
        return respond(res,400,{error:'RUNTIME_SETTINGS_BAD_REQUEST'});
      }
    }
    return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
  }
  // Registered with Airia MENA, but published pipeline IDs alone do not
  // prove partner contract compatibility or end-to-end deployment readiness.
  if(path==='/api/ai/admin/agents/coverage'&&req.method==='GET'){
    const specs=[
      ['A01','a01','Maritime intelligence','WIRED'],
      ['A02','a02','Vessel compliance','WIRED'],
      ['A03','a03','Document intelligence','WIRED_MULTIPART'],
      ['A04','a04','Inspection dossier','WIRED'],
      ['DQ-01','dq01','Data-quality factors','CONTRACT_PILOT'],
      ['SI-C01','c01','Candidate selection','WIRED_CONTRACT_CHECK'],
      ['SI-P01','p01','Approved execution priority','PIPELINE_NOT_SUPPLIED'],
      ['SI-S01','s01','Scheduling slot advice','CONTRACT_PILOT'],
      ['SI-V01','v01','Vision evidence review','CONTRACT_PILOT_MEDIA_REQUIRED'],
      ['SI-R01','r01','Inspection report drafting','CONTRACT_PILOT'],
      ['SI-X01','x01','Recurring deficiency advice','CONTRACT_PILOT_HISTORY_REQUIRED']
    ];
    return respond(res,200,{status:'ok',provider:'AIRIA',
      keyConfigured:Boolean(getAiriaKey()),providerContractTestsCompleted:false,
      siProvider:siAiProvider,agents:specs.map(([code,id,role,integration])=>({
        code,role,integration,configured:Boolean(pipelines[id]),
        enabled:agentAllowed(id),pipelineId:pipelines[id]||null,
        currentlySelectedForSi:code.startsWith('SI-')?siAiProvider==='airia':null,
        verifiedLiveInUserEnvironment:false})),
      conversationalCatalog:[
        {code:'NMC-DESK',pipelineId:runtime.get('AIRIA_NMC_DESK_PIPELINE_ID'),responseType:'PROSE',structuredAdapter:false},
        {code:'CONVERSATIONAL-SI',pipelineId:runtime.get('AIRIA_CONVERSATIONAL_SI_PIPELINE_ID'),responseType:'PROSE',structuredAdapter:false},
        {code:'SDB-JOURNEY',pipelineId:runtime.get('AIRIA_SDB_JOURNEY_PIPELINE_ID'),responseType:'PROSE',structuredAdapter:false}
      ],notes:['Airia provider catalogue is documented; live HTTP/JSON contracts not independently exercised by a GitHub commit.',
        'No upstream AI invocation occurs when opening this coverage URL.',
        'NMC risk, data-quality score, inspections, bookings and official findings remain owned by platform workflows.']});
  }
  if(path==='/api/ai/data-quality/assessments'){
    if(req.method!=='POST')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try{
      dashboards.assertRole(req,'EDITOR');
      if(!agentAllowed('dq01'))return respond(res,403,{error:'DQ01_DISABLED'});
      const body=await requestJson(req,2048);
      if(body?.confirmRun!==true)return respond(res,422,{error:'DQ01_EXPLICIT_RUN_REQUIRED'});
      const imo=body.imo;
      if(typeof imo!=='string'||!/^\\d{7}$/.test(imo))
        return respond(res,422,{error:'DQ01_IMO_INVALID'});
      const ctx=makeDq01Request(imo,fleet.getVesselResult(imo),incidentBundleMap.get(imo));
      let raw;
      try{raw=await fleetAgentCall('dq01',ctx.request);}
      catch{return respond(res,502,{error:'DQ01_PROVIDER_UNAVAILABLE'});}
      return respond(res,200,{...validateDq01Response(raw,ctx.known),imo,
        sourceAssessmentId:fleet.getVesselResult(imo)?.assessmentId});
    }catch(error){
      if(error instanceof DqAgentError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'DQ01_UNAVAILABLE'});
    }
  }

  if (req.method === 'GET' && path === '/api/ai/health') {
    const db=repository?await repository.health():{mode:'json',ready:true};
    return respond(res, db.ready?200:503, {
      status:db.ready?'ok':'degraded',aiConfigured:Boolean(getAiriaKey()),
      adapter:'nmc-airia-proxy',fleetAutoEnabled:scheduler.enabled,
      persistence:db,persistenceHealthy:fleet.persistenceHealthy
    });
  }


  // Incident-specific POC feed: read-only GET requests never invoke any model.
  // Keep this BEFORE the generic Airia route's NOT_FOUND fallback.
  if(path==='/api/ai/nmc/incidents/health'&&req.method==='GET')
    return respond(res,200,{status:'ok',...incidentFeed.health()});
  if(path==='/api/ai/nmc/incidents'&&req.method==='GET'){
    try{return respond(res,200,await incidentCaseView());}
    catch(error){
      if(error instanceof IncidentTriageError)
        return respond(res,error.status,{error:error.code,source:'GOOGLE_SHEETS'});
      console.error('[nmc-incidents] INCIDENT_FEED_FAILED');
      return respond(res,503,{error:'INCIDENT_SOURCE_UNAVAILABLE'});
    }
  }
  const triageMatch=/^\/api\/ai\/nmc\/incidents\/(INC-[A-Za-z0-9-]{3,70})\/analyze$/.exec(path);
  if(triageMatch&&req.method==='POST'){
    try{
      dashboards.assertRole(req,'EDITOR');
      const body=await requestJson(req,4096);
      return respond(res,200,await incidentFeed.analyze(triageMatch[1],{
        confirmCost:body.confirmCost===true,force:body.force===true
      }));
    }catch(error){
      if(error instanceof IncidentTriageError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'INCIDENT_AI_TRIAGE_UNAVAILABLE'});
    }
  }
  // No parallel incident approval workflow. All incident task decisions belong
  // exclusively inside Case Management, with central audit and ownership.
  const incidentReviewMatch=/^\/api\/ai\/nmc\/incidents\/(INC-[A-Za-z0-9-]{3,70})\/review$/.exec(path);
  if(incidentReviewMatch&&req.method==='POST')
    return respond(res,409,{error:'INCIDENT_ACTIONS_ONLY_IN_CASE_MANAGEMENT'});

  if (req.method === 'GET' && path === '/api/ai/psc/health') {
    return respond(res, 200, getPscHealth());
  }
  if (req.method === 'GET' && path === '/api/ai/fleet/status') {
    try{
      const current=await effectiveFleetSnapshot(fleet.snapshot());
      return respond(res,200,{...current,storageMode:dbMode,
        persistenceHealthy:fleet.persistenceHealthy,scheduler:scheduler.status()});
    }catch{return respond(res,503,{error:'RISK_POLICY_PROJECTION_UNAVAILABLE'});}
  }
  // Fetch Again: fresh direct Oracle read, no dashboard-triggered AI.
  if(req.method==='GET'&&path==='/api/ai/fleet/saved-status'){
    try{
      const saved=await fleet.savedSnapshot();
      const current=await effectiveFleetSnapshot(saved);
      return respond(res,200,{...current,storageMode:dbMode,
        persistenceHealthy:fleet.persistenceHealthy,scheduler:scheduler.status(),
        fetchedFrom:dbMode==='oracle'?'ORACLE':'PERSISTED_JSON',
        fetchedAt:new Date().toISOString()});
    }catch(error){
      console.error('[nmc-fleet] SAVED_STATUS_READ_FAILED');
      return respond(res,503,{error:'FLEET_SAVED_READ_FAILED'});
    }
  }
  if (req.method === 'GET' && path === '/api/ai/fleet/analytics') {
    return respond(res, 200, fleet.analytics());
  }
  const fleetResultMatch = /^\/api\/ai\/fleet\/results\/(\d{7})$/.exec(path);
  if (req.method === 'GET' && fleetResultMatch) {
    const record=fleet.getVesselResult(fleetResultMatch[1]);
    return respond(res,record?200:404,record||{error:'FLEET_ASSESSMENT_NOT_FOUND'});
  }
  const intelligenceMatch = /^\/api\/ai\/fleet\/intelligence\/(\d{7})$/.exec(path);
  if(req.method==='GET' && intelligenceMatch){
    try {
      const data=await fleet.intelligence(intelligenceMatch[1]);
      return respond(res,data?200:404,data||{error:'FLEET_INTELLIGENCE_NOT_FOUND'});
    }catch{return respond(res,503,{error:'FLEET_INTELLIGENCE_UNAVAILABLE'});}
  }
  const historyMatch = /^\/api\/ai\/fleet\/history\/(\d{7})$/.exec(path);
  if(req.method==='GET' && historyMatch){
    try{
      const data=await fleet.history(historyMatch[1]);
      return respond(res,data?200:404,data||{error:'UNKNOWN_VESSEL'});
    }catch{return respond(res,503,{error:'FLEET_HISTORY_UNAVAILABLE'});}
  }
  // Centrally published NMC Risk Settings — immutable version history.
  // No AI calls, no source assessment rewrites or browser-managed versions.
  if(path==='/api/ai/risk-policy'||path.startsWith('/api/ai/risk-policy/')){
    try{
      if(req.method==='GET'&&path==='/api/ai/risk-policy')
        return respond(res,200,{status:'ok',active:await riskPolicy.active()});
      if(req.method==='GET'&&path==='/api/ai/risk-policy/draft')
        return respond(res,200,{status:'ok',draft:await riskPolicy.draft()});
      if(req.method==='POST'&&path==='/api/ai/risk-policy/draft'){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,16384);
        const draft=await riskPolicy.saveDraft(body);
        return respond(res,200,{status:'ok',draft});
      }
      if(req.method==='GET'&&path==='/api/ai/risk-policy/history')
        return respond(res,200,{status:'ok',history:await riskPolicy.history()});
      if(req.method==='GET'&&path==='/api/ai/risk-policy/projections')
        return respond(res,200,await riskPolicy.projectCurrent());
      const vesselPolicyMatch=/^\/api\/ai\/risk-policy\/vessels\/(\d{7})(?:\/(history))?$/.exec(path);
      if(req.method==='GET'&&vesselPolicyMatch){
        if(vesselPolicyMatch[2])
          return respond(res,200,{status:'ok',history:await riskPolicy.projectionHistory(vesselPolicyMatch[1])});
        const projection=await riskPolicy.vessel(vesselPolicyMatch[1]);
        return respond(res,projection?200:404,{status:projection?'ok':'missing',projection});
      }
      if(req.method==='POST'&&path==='/api/ai/risk-policy/publish'){
        dashboards.assertRole(req,'PUBLISHER');
        const body=await requestJson(req,16384);
        const published=await riskPolicy.publish(body);
        // No external AI; the published risk policy is authoritative.
        // Scanner now SUPERSEDES outdated alerts, creates new events for a new
        // High/Critical classification, and retains old case/audit history.
        if(alertScanEnabled)await scanExistingFleetForAlerts();
        return respond(res,201,{status:'ok',published});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof RiskPolicyError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      console.error('[nmc-risk-policy] API_FAILURE');
      return respond(res,503,{error:'RISK_POLICY_UNAVAILABLE'});
    }
  }

  // Platform guidance is NOT an AI agent. GET is strictly read-only and never calls Airia.
  if(path==='/api/ai/guidance/rules'||path.startsWith('/api/ai/guidance/')){
    try{
      if(path==='/api/ai/guidance/rules'&&req.method==='GET')
        return respond(res,200,{status:'ok',rules:await guidance.list()});
      if(path==='/api/ai/guidance/rules'&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,16384);
        return respond(res,201,{status:'ok',rule:await guidance.create(body.rule)});
      }
      const ruleMatch=/^\/api\/ai\/guidance\/rules\/(NMC-GUIDE-[0-9]{3,5})(?:\/(history|publish))?$/.exec(path);
      if(ruleMatch){
        const [,id,action]=ruleMatch;
        if(req.method==='GET'&&action==='history')
          return respond(res,200,{status:'ok',history:await guidance.history(id)});
        if(req.method==='PUT'&&!action){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,16384);
          return respond(res,200,{status:'ok',rule:await guidance.change(id,body.revision,'EDIT',body.rule)});
        }
        if(req.method==='POST'&&action==='publish'){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          return respond(res,200,{status:'ok',rule:await guidance.change(id,body.revision,'PUBLISH')});
        }
      }
      const vesselMatch=/^\/api\/ai\/guidance\/vessels\/(\d{7})(?:\/(materialize))?$/.exec(path);
      if(vesselMatch){
        const [,imo,action]=vesselMatch;
        if(req.method==='GET'&&!action)return respond(res,200,await guidance.evaluate(imo));
        if(req.method==='POST'&&action==='materialize'){
          dashboards.assertRole(req,'PUBLISHER');
          return respond(res,200,await guidance.materialize(imo));
        }
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof GuidanceError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      console.error('[nmc-guidance] API_FAILURE');
      return respond(res,503,{error:'GUIDANCE_UNAVAILABLE'});
    }
  }

  // IMPORTANT: this specific checklist router MUST precede the generic
  // /api/si/v1/* catch-all. Otherwise GET /checklists and POST create/publish
  // are intercepted and incorrectly return METHOD_NOT_ALLOWED (405).
  // Configurable maritime inspection checklists; permissions are checked
  // before every operation. GET never invokes Airia or writes data.
  if(path==='/api/si/v1/checklists'||path.startsWith('/api/si/v1/checklists/')){
    try{
      const mutation=req.method!=='GET';
      const actor=moeiAuth.require(req,{mutate:mutation});
      const user=actor.email||actor.username;
      const root='/api/si/v1/checklists';
      const rest=path.slice(root.length);
      if(!rest&&req.method==='GET')
        return respond(res,200,{templates:await siChecklistLibrary.list()});
      if(!rest&&req.method==='POST'){
        if(actor.role!=='ADMIN')throw new SiChecklistError('SI_CHECKLIST_ADMIN_REQUIRED',403);
        return respond(res,201,await siChecklistLibrary.create(await requestJson(req,100000),user));
      }
      if(rest==='/storage/status'&&req.method==='GET')
        return respond(res,200,{status:'ok',storage:checklistStorage.toUpperCase(),
          oracleAuthoritative:checklistStorage==='oracle',
          oracleMigration:'017',
          legacyJsonImportAutomatic:false,
          caseRevisionPinned:true,
          humanApprovalRequired:true});
      if(rest==='/ai/status'&&req.method==='GET')
        return respond(res,200,siChecklistAiria.status());
      if(rest==='/ai/builder'&&req.method==='POST'){
        if(actor.role!=='ADMIN')throw new SiChecklistError('SI_CHECKLIST_ADMIN_REQUIRED',403);
        const payload=await requestJson(req,12000);
        // Suggestions are draft-only. They are NEVER published by a model.
        return respond(res,200,await siChecklistAiria.suggestSettings(payload));
      }
      const editor=/^\/([a-f0-9-]{36})(?:\/(publish))?$/.exec(rest);
      if(editor){
        if(req.method==='GET'&&!editor[2])
          return respond(res,200,await siChecklistLibrary.get(editor[1]));
        if(actor.role!=='ADMIN')throw new SiChecklistError('SI_CHECKLIST_ADMIN_REQUIRED',403);
        if(req.method==='PUT'&&!editor[2])
          return respond(res,200,await siChecklistLibrary.edit(editor[1],
            await requestJson(req,100000),user));
        if(req.method==='POST'&&editor[2]==='publish'){
          const payload=await requestJson(req,2048);
          return respond(res,200,await siChecklistLibrary.publish(editor[1],user,
            payload.expectedUpdatedAt));
        }
      }
      const single=/^\/cases\/([a-f0-9-]{36})(?:\/(start|answers|ai\/suggest|ai\/review|submit))?$/.exec(rest);
      if(single){
        const id=single[1],operation=single[2];
        if(req.method==='GET'&&!operation)
          return respond(res,200,await siChecklistField.preview(id));
        if(actor.role!=='ADMIN')throw new SiChecklistError('SI_CHECKLIST_INSPECTOR_REQUIRED',403);
        if(req.method==='POST'&&operation==='start')
          return respond(res,201,await siChecklistField.start(id,user));
        const payload=await requestJson(req,3300000);
        if(operation==='answers'&&req.method==='POST')
          return respond(res,200,await siChecklistField.saveAnswers(id,{...payload,actor:user}));
        if(operation==='ai/suggest'&&req.method==='POST')
          return respond(res,200,await siChecklistField.suggest(id,{...payload,actor:user}));
        if(operation==='ai/review'&&req.method==='POST')
          return respond(res,200,await siChecklistField.review(id,{...payload,actor:user}));
        if(operation==='submit'&&req.method==='POST')
          return respond(res,200,await siChecklistField.complete(id,{...payload,actor:user}));
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(e){
      if(e instanceof SiChecklistError||e instanceof MoeiAuthError)
        return respond(res,e.status||400,{error:e.code||'SI_CHECKLIST_FAILED'});
      console.error('[si-checklist] REQUEST_FAILED',String(e?.code||e?.message||'UNKNOWN').slice(0,80));
      return respond(res,503,{error:'SI_CHECKLIST_BACKEND_UNAVAILABLE'});
    }
  }

  // Phase-1 Smart Inspection: no Airia invocations; read all active IMOs and
  // NMC human-approved referrals dynamically. Only publisher may approve a new case.
  if(path==='/api/si/v1'||path.startsWith('/api/si/v1/')){
    try{
      // The first Smart Inspection screen: one read-only candidate/AI plan grid.
      // Operator plan changes require Editor authorisation, one confirmed C01
      // re-evaluation and backend validation; no official inspection approval.
      if((path==='/api/si/v1/inspection-plans'||
           path.startsWith('/api/si/v1/inspection-plans/'))&&!siRollingPlansReady)
        return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
      // Dynamic operational Vessel Master: IMO/name from master, current ETD
      // joined from saved MSW source events. No AI calls or DB writes.
      if(path==='/api/si/v1/vessel-master'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        const query=new URL(req.url||'/', 'http://localhost').searchParams;
        const imo=query.get('imo');
        if(imo!==null&&!/^[0-9]{7}$/.test(imo))
          return respond(res,422,{error:'SI_VESSEL_MASTER_IMO_INVALID'});
        const source=await siTargeting._state();
        const master=projectVesselMasterEtd({sourceEvents:source.events});
        return respond(res,200,imo?{...master,rows:master.rows.filter(x=>x.imo===imo)}:master);
      }
      // Rolling plans are independent, numbered and versioned. Creating a plan
      // never calls C01, approves inspections, or touches legacy JSON.
      if(path==='/api/si/v1/inspection-plans'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,{plans:await siRollingPlans.list()});
      }
      if(path==='/api/si/v1/inspection-plans'&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const identity=moeiAuth.session(req);
        const input=await requestJson(req,4096);
        // Snapshot ONLY genuine, backend-eligible source events. New plans
        // immediately show those vessels without generating an AI response.
        const source=await siCandidateAgent.source();
        return respond(res,201,await siRollingPlans.create(input,
          identity?.email||identity?.username||'ADMIN',
          {candidates:source.candidates,sourceHash:source.snapshotHash}));
      }
      const rollingPath=/^\/api\/si\/v1\/inspection-plans\/([a-f0-9-]{36})(?:\/(cancel|selection|selection-bulk))?$/.exec(path);
      if(rollingPath){
        if(req.method==='GET'&&!rollingPath[2]){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,await siRollingPlans.get(rollingPath[1]));
        }
        if(req.method==='POST'&&rollingPath[2]==='selection'){
          dashboards.assertRole(req,'EDITOR');
          const input=await requestJson(req,4096);
          const identity=moeiAuth.session(req);
          return respond(res,200,await siInspectionPlan.select({
            ...input,planId:rollingPath[1],
            actor:identity?.email||identity?.username||'ADMIN'
          }));
        }
        if(req.method==='POST'&&rollingPath[2]==='selection-bulk'){
          dashboards.assertRole(req,'EDITOR');
          const input=await requestJson(req,8192);
          const identity=moeiAuth.session(req);
          return respond(res,200,await siInspectionPlan.selectBulk({
            ...input,planId:rollingPath[1],
            actor:identity?.email||identity?.username||'ADMIN'
          }));
        }
        if(req.method==='POST'&&rollingPath[2]==='cancel'){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          const identity=moeiAuth.session(req);
          return respond(res,200,await siRollingPlans.cancel(
            rollingPath[1],body.expectedRevision,
            identity?.email||identity?.username||'ADMIN',body.reason));
        }
      }
      if(path==='/api/si/v1/inspection-plan'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        const planId=new URL(req.url||'/', 'http://localhost').searchParams.get('planId');
        if(planId&&!siRollingPlansReady)return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        return respond(res,200,await siInspectionPlan.snapshot(planId));
      }
      if(path==='/api/si/v1/inspection-plan/rerank'&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const input=await requestJson(req,4096);
        if(input.planId&&!siRollingPlansReady)
          return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        return respond(res,200,await siInspectionPlan.rerank(input));
      }
      // One supervisor action for all plan-selected vessels. GET is read-only;
      // POST asynchronously creates per-regime cases and deterministic dossiers,
      // with explicitly authorized optional A04/P01 paid calls.

      // Capacity-FIRST: source evidence + workforce constraints precede the
      // ONE supervisor approval. The existing Airia SI-S01 input/output
      // schema is unchanged; drafts are advisory until Oracle commits both
      // approved plan and its work orders in one locked transaction.
      const integratedRoute=/^\/api\/si\/v1\/inspection-plans\/([a-f0-9-]{36})\/capacity-(context|preview|ai-recommend|approve)$/.exec(path);
      if(integratedRoute){
        const planId=integratedRoute[1],action=integratedRoute[2];
        if((action==='context'&&req.method!=='GET')||
           (action!=='context'&&req.method!=='POST'))
          return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
        dashboards.assertRole(req,action==='approve'?'PUBLISHER':'EDITOR');
        if(!siRollingPlansReady)
          return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        const identity=moeiAuth.require(req,{mutate:req.method==='POST'});
        const actor=identity.email||identity.username;
        if(!actor)return respond(res,403,{error:'SI_INTEGRATED_OPERATOR_REQUIRED'});
        const query=new URL(req.url||'/','http://localhost').searchParams;
        const body=action==='context'?{
          pscRiskRatePercent:Number(query.get('psc')),
          uaeFlagRatePercent:Number(query.get('uae')),
          demoMode:query.get('demo')==='1'
        }:await requestJson(req,1024*1024);
        if(body.demoMode!==true&&body.demoMode!==false)
          return respond(res,422,{error:'SI_INTEGRATED_DEMO_FLAG_REQUIRED'});
        if(body.demoMode&&process.env.SI_SCHEDULING_DEMO_MODE!=='true')
          return respond(res,403,{error:'SI_POC_DEMO_MODE_NOT_ENABLED'});
        if(action==='approve'&&(!siScheduleOrders.ready||
           siRollingPlans.mode!=='oracle'||siScheduleOrders.mode!=='oracle'))
          return respond(res,503,{error:'SI_INTEGRATED_ATOMIC_ORACLE_REQUIRED'});
        const plan=await siRollingPlans.get(planId);
        const [inspectionPlan,dashboard]=await Promise.all([
          siInspectionPlan.snapshot(planId),siTargeting.dashboard()
        ]);
        const selection=selectIntegratedPlanVessels({
          plan,inspectionPlan,dashboard,
          pscRiskRatePercent:body.pscRiskRatePercent,
          uaeFlagRatePercent:body.uaeFlagRatePercent
        });
        if(!selection.roster.length)
          return respond(res,409,{error:'SI_INTEGRATED_NO_ELIGIBLE_VESSELS'});
        if(selection.roster.length>40)
          return respond(res,409,{error:'SI_INTEGRATED_SCHEDULING_BATCH_LIMIT_40'});
        const original=siErp.requireSnapshot();
        const workforce=body.demoMode?
          buildPocErpSchedulingOverlay(original):original;
        const planDraft=makeCapacityDraftPlan(plan,selection);
        const source=maritimePlanSchedulingContext(planDraft,dashboard,original);
        const context=body.demoMode?
          fillPocSchedulingVisitContext(source,workforce):source;
        if(action==='context')return respond(res,200,{
          ...context,selection,sourceHash:selection.sourceHash,
          planRevision:selection.planRevision,
          note:'DRAFT_CAPACITY_ASSESSMENT_ONLY_NOT_YET_APPROVED'
        });
        if(!Array.isArray(body.requests)||
           body.requests.length!==selection.roster.length||
           body.requests.length>40||
           typeof body.expectedSourceHash!=='string'||
           !Number.isInteger(body.expectedPlanRevision)||
           body.expectedSourceHash!==selection.sourceHash||
           body.expectedPlanRevision!==selection.planRevision||
           body.expectedSelectionHash!==selection.selectionHash||
           new Set(body.requests.map(x=>x.imo)).size!==selection.roster.length||
           body.requests.some(x=>!selection.roster.some(v=>v.imo===x.imo)))
          return respond(res,409,{error:'SI_INTEGRATED_SOURCE_OR_SELECTED_IMOS_CHANGED'});
        validateOperatorScheduleAgainstSource(source,body.requests,{
          demo:body.demoMode,context
        });
        if(body.demoMode)validatePocSchedulingDemoRequest(context,body.requests);
        const referrals=await cases.listInspectionRequests();
        const bookings=body.demoMode?[]:
          [...siScheduling.state.confirmed,
           ...await siScheduling.centralBookings(workforce)];
        const proposal=proposeMaritimeBatchSchedule({
          plan:planDraft,erpSnapshot:workforce,
          policy:siScheduling.getPolicy(),
          requests:body.demoMode?
            body.requests.map(x=>({...x,pocDemo:true})):body.requests,
          nmcReferrals:referrals,existingBookings:bookings,
          scheduler:siScheduling
        });
        const review={...selection,
          capacity:{
            exceptionActions:suggestCapacityExceptionActions({
              proposal,selection,erpSnapshot:workforce,
              policy:siScheduling.getPolicy()
            }),
            inspectedImos:selection.roster.length,
            feasibleImos:proposal.summary.proposed,
            unscheduledImos:proposal.rows.filter(x=>x.status==='UNSCHEDULED')
             .map(x=>({imo:x.imo,blocker:x.blocker,
               diagnostics:x.diagnostics})),
            mandatoryUnscheduled:selection.mandatoryImos.filter(imo=>
              proposal.rows.some(r=>r.imo===imo&&r.status==='UNSCHEDULED'))
          }
        };
        if(action==='preview')return respond(res,200,{
          status:'DRAFT_CAPACITY_PREVIEW',proposal,selection:review,
          airiaCalls:0,officiallyApproved:false
        });
        if(body.expectedProposalHash!==proposal.proposalHash)
          return respond(res,409,{error:'SI_INTEGRATED_PROPOSAL_STALE_REPREVIEW'});
        if(action==='ai-recommend'){
          if(body.confirmRun!==true||body.confirmCost!==true)
            return respond(res,422,{error:'SI_S01_EXPLICIT_COST_CONFIRMATION_REQUIRED'});
          const mockDemo=body.demoMode&&siAiProvider==='mock';
          if(!mockDemo&&(siAiProvider!=='airia'||!agentAllowed('s01')))
            return respond(res,409,{error:'SI_S01_AIRIA_NOT_ENABLED'});
          if(!proposal.variants?.length)
            return respond(res,409,{error:'SI_S01_NO_FEASIBLE_ALTERNATIVES'});
          // No new Airia fields: same payload and same strict response validator
          // as the previously integrated SI-S01 whole-plan advisor.
          const payload=prepareS01WholePlanRequest(proposal);
          let raw;
          if(mockDemo){
            raw={bookingConfirmed:false,
              slotSetHash:payload.currentSnapshot.slotSetHash,
              rankedOptions:proposal.variants.map((v,index)=>({
                optionId:v.optionId,rank:index+1,confidence:1,
                rationale:'POC MOCK: deterministic ranking of already constraint-checked capacity plan options; no real AI judgement.',
                evidenceRefs:[payload.currentSnapshot.erpSnapshotId]
              }))};
          }else{
            try{raw=await fleetAgentCall('s01',payload);}
            catch{return respond(res,502,{
              error:'SI_S01_PROVIDER_UNAVAILABLE',planUnchanged:true});}
          }
          const evaluated=validateS01WholePlanResponse(raw,proposal,payload);
          if(mockDemo){
            evaluated.provider='POC_MOCK';evaluated.externalCalls=0;
          }
          return respond(res,200,{status:'ok',...evaluated,
            selection:review,officiallyApproved:false});
        }
        // APPROVAL: re-evaluate the precise candidate/source/capacity hash
        // against current ERP; no stale browser-supplied inspector allocation.
        if(body.confirmApproval!==true||typeof body.reason!=='string'||
           body.reason.trim().length<8||!body.selectedOptionId)
          return respond(res,422,{error:'SI_INTEGRATED_APPROVAL_FIELDS_REQUIRED'});
        const decision=validateIntegratedCapacityProposal(
          selection,proposal,body.selectedOptionId);
        const optimized=decision.variant;
        const approvedProposal={
          ...proposal,planRevision:plan.revision+1,
          summary:{...proposal.summary,total:decision.selected.length,
           proposed:decision.selected.length,unscheduled:0},
          variants:[{...optimized,allocatedVessels:decision.selected.length,
           rows:optimized.rows.filter(x=>x.status==='PROPOSED')}]
        };
        let savedSchedule=null;
        const approvedPlan=await siRollingPlans.approveForScheduling(planId,{
          expectedRevision:plan.revision,
          expectedSourceHash:selection.sourceHash,
          actor,reason:body.reason,vessels:decision.selected,
          integratedSourceRows:inspectionPlan.rows,
          integratedDecision:{
            sourceHash:selection.sourceHash,
            planRevision:selection.planRevision,
            selectionHash:selection.selectionHash,
            proposalHash:proposal.proposalHash,
            erpSnapshotId:proposal.erpSnapshotId,
            pscRiskRatePercent:body.pscRiskRatePercent,
            uaeFlagRatePercent:body.uaeFlagRatePercent,
            quotas:selection.quotas,rejected:decision.rejected,
            selectionSummary:decision.disposition,
            demoMode:body.demoMode
          },
          withinTransaction:async(con,nextPlan)=>{
            savedSchedule=await siScheduleOrders.approve({
              plan:nextPlan,proposal:approvedProposal,
              selectedOptionId:optimized.optionId,
              expectedHash:proposal.proposalHash,
              expectedPlanRevision:nextPlan.revision,
              actor,reason:body.reason,confirmApproval:true,
              confirmCrossPort:body.confirmCrossPort===true,
              demoMode:body.demoMode,connection:con
            });
          }
        });
        return respond(res,201,{
          status:'CAPACITY_VERIFIED_PLAN_AND_WORK_ORDERS_APPROVED',
          planId:approvedPlan.id,revision:approvedPlan.revision,
          approvedVesselCount:decision.selected.length,
          capacityExcludedImos:decision.rejected,
          schedule:savedSchedule,
          createdInspectionCases:0,createdDossiers:0,
          officialErpBookingCreated:false,
          aiDossierNextAction:'ACTIVATE_WORK_ORDER_THEN_GENERATE_A04_WITH_CONSENT'
        });
      }
      // Smart Inspection V2: approve roster only; NO SI_INSPECTION_CASE rows,
      // dossiers, Airia/AI calls, ERP bookings or NMC case mutations.
      const v2Approval=/^\/api\/si\/v1\/inspection-plans\/([a-f0-9-]{36})\/approve-for-scheduling$/.exec(path);
      if(v2Approval&&req.method==='POST'){
        dashboards.assertRole(req,'PUBLISHER');
        if(!siRollingPlansReady)return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        const input=await requestJson(req,4096);
        const approved=await siBulkPlan.preview(v2Approval[1]);
        if(approved.stale||(!approved.manualSelection&&!approved.agentRunId)||
           approved.sourceHash!==input.expectedSourceHash||
           approved.planRevision!==input.expectedRevision||
           approved.vessels.length===0||approved.vessels.some(x=>x.missingSource)||
           input.confirmApproval!==true)
          return respond(res,409,{error:'SI_V2_PLAN_SOURCE_CHANGED_OR_MISSING'});
        const actor=moeiAuth.session(req)?.email||'MOEI_SUPERVISOR';
        const roster=approved.vessels.map(v=>({
          imo:v.imo,planRank:v.rank,regimes:v.inspectionRegimes,
          inspectionReasons:v.reasons
        }));
        const result=await siRollingPlans.approveForScheduling(v2Approval[1],{
          expectedRevision:input.expectedRevision,
          expectedSourceHash:input.expectedSourceHash,
          reason:input.reason,actor,vessels:roster
        });
        return respond(res,201,{status:'APPROVED_AWAITING_SCHEDULING',
          planId:result.id,revision:result.revision,
          approvedVesselCount:result.approvedVessels.length,
          createdInspectionCases:0,createdDossiers:0,
          schedulingRoute:'/api/si/v1/maritime-scheduling/plans/'+result.id+'/preview'});
      }
      // Whole-plan scheduling read-only preview. The user may provide berth,
      // availability and duration input as operator scheduling facts.
      // Dates are final at source import; there is NO separate ETD review.
      const v2Context=/^\/api\/si\/v1\/maritime-scheduling\/plans\/([a-f0-9-]{36})\/context$/.exec(path);
      if(v2Context&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        const plan=await siRollingPlans.get(v2Context[1]);
        const originalErp=siErp.requireSnapshot();
        const dashboard=await siTargeting.dashboard();
        const query=new URL(req.url||'/', 'http://localhost').searchParams;
        const demo=query.get('demo')==='1';
        if(demo&&process.env.SI_SCHEDULING_DEMO_MODE!=='true')
          return respond(res,403,{error:'SI_POC_DEMO_MODE_NOT_ENABLED'});
        const erp=demo?buildPocErpSchedulingOverlay(originalErp):originalErp;
        const source=maritimePlanSchedulingContext(plan,dashboard,originalErp);
        return respond(res,200,demo?
          fillPocSchedulingVisitContext(source,erp):source);
      }
      // A plan's approved vessel roster is the scheduling source for both
      // the free ERP-constrained preview and a separately confirmed paid S01
      // analysis. Do not permit the browser to supply feasible AI slot IDs.
      const v2Schedule=/^\/api\/si\/v1\/maritime-scheduling\/plans\/([a-f0-9-]{36})\/(preview|ai-recommend)$/.exec(path);
      if(v2Schedule&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const paid=v2Schedule[2]==='ai-recommend';
        const body=await requestJson(req,1024*1024);
        if(!Array.isArray(body.requests)||!body.requests.length||
           body.requests.length>500||
           Object.keys(body).some(key=>![
             'requests','demoMode',...(paid?['confirmRun','confirmCost','expectedProposalHash']:[])
           ].includes(key)))
          return respond(res,422,{error:'SI_V2_SCHEDULING_REQUESTS_INVALID'});
        if(paid){
          // MOCK is a separately-labelled demo-only S01 suggestion; never
          // silently substitute a fabricated AI response for real Airia.
          const mockDemo=body.demoMode===true&&siAiProvider==='mock'&&
            process.env.SI_SCHEDULING_DEMO_MODE==='true';
          if(!mockDemo&&(siAiProvider!=='airia'||!agentAllowed('s01')))
            return respond(res,409,{error:'SI_S01_AIRIA_NOT_ENABLED'});
          if(body.confirmRun!==true||body.confirmCost!==true||
             !/^[a-f0-9]{64}$/.test(body.expectedProposalHash||''))
            return respond(res,422,{error:'SI_S01_EXPLICIT_COST_CONFIRMATION_REQUIRED'});
        }
        const demo=body.demoMode===true;
        if(body.demoMode!==undefined&&typeof body.demoMode!=='boolean')
          return respond(res,422,{error:'SI_POC_DEMO_FLAG_INVALID'});
        if(demo&&process.env.SI_SCHEDULING_DEMO_MODE!=='true')
          return respond(res,403,{error:'SI_POC_DEMO_MODE_NOT_ENABLED'});
        if(!demo&&body.requests.some(x=>x.windowSource==='POC_DEMO'))
          return respond(res,422,{error:'SI_POC_DEMO_SOURCE_REQUIRES_DEMO_MODE'});
        const plan=await siRollingPlans.get(v2Schedule[1]);
        const originalSnapshot=siErp.requireSnapshot();
        const snapshot=demo?buildPocErpSchedulingOverlay(originalSnapshot):originalSnapshot;
        const dashboard=await siTargeting.dashboard();
        const sourceContext=maritimePlanSchedulingContext(plan,dashboard,originalSnapshot);
        const context=demo?
          fillPocSchedulingVisitContext(sourceContext,snapshot):sourceContext;
        validateOperatorScheduleAgainstSource(sourceContext,body.requests,{demo,context});
        if(demo)validatePocSchedulingDemoRequest(context,body.requests);
        const referrals=await cases.listInspectionRequests();
        const confirmed=demo?[]:await siScheduling.centralBookings(snapshot);
        const result=proposeMaritimeBatchSchedule({
          plan,erpSnapshot:snapshot,policy:siScheduling.getPolicy(),
          requests:demo?body.requests.map(x=>({...x,pocDemo:true})):body.requests,
          nmcReferrals:referrals,
          existingBookings:demo?[]:[...siScheduling.state.confirmed,...confirmed],
          scheduler:siScheduling
        });
        if(demo){
          result.demoMode=true;
          result.demoNotice='SYNTHETIC_POC_VISITS_AND_WORKFORCE_NO_REAL_ERP_AVAILABILITY_OR_BOOKING';
          result.originalErpSnapshotId=originalSnapshot.snapshotId;
        }
        if(!paid)return respond(res,200,{status:'ok',proposal:result,
          airiaCalls:0});
        if(result.proposalHash!==body.expectedProposalHash)
          return respond(res,409,{error:'SI_S01_SOURCE_OR_ERP_CHANGED_REPREVIEW'});
        if(!result.variants?.length||!result.summary.proposed)
          return respond(res,409,{error:'SI_S01_NO_FEASIBLE_ALTERNATIVES'});
        const payload=prepareS01WholePlanRequest(result);
        if(demo){
          payload.demoMode=true;
          payload.demoNotice='All source scheduling additions and engineer slots are synthetic POC data. No operational booking or regulatory approval is permitted.';
          payload.businessGuardrails.mockDataCannotAuthorizeInspection=true;
        }
        const mockDemo=demo&&siAiProvider==='mock';
        let raw;
        if(mockDemo){
          // Deterministic presentation fixture, not a model judgement.
          // Only source-generated feasible optionIds and evidence are echoed.
          raw={bookingConfirmed:false,
            slotSetHash:payload.currentSnapshot.slotSetHash,
            rankedOptions:result.variants.map((v,index)=>({
              optionId:v.optionId,rank:index+1,confidence:1,
              rationale:'POC MOCK: deterministic ranking of ERP-synthetic, already feasible whole-plan alternatives. No live AI assessment or approved booking.',
              evidenceRefs:[payload.currentSnapshot.slotSetHash]
            }))};
          // slotSetHash is a structural binding, not evidence. Give the
          // validator source provenance IDs instead.
          for(const row of raw.rankedOptions)
            row.evidenceRefs=[payload.currentSnapshot.erpSnapshotId];
        }else{
          try{raw=await fleetAgentCall('s01',payload);}
          catch{
            return respond(res,502,{error:'SI_S01_PROVIDER_UNAVAILABLE',
              planUnchanged:true});
          }
        }
        const validated=validateS01WholePlanResponse(raw,result,payload);
        if(mockDemo){
          validated.provider='POC_MOCK';
          validated.externalCalls=0;
          validated.proposal.demoMode=true;
          validated.proposal.demoNotice='SIMULATED_S01_RANKING_NO_LIVE_AI_CALL_OR_OFFICIAL_APPROVAL';
        }
        return respond(res,200,{status:'ok',...validated});
      }
      // Signed-in inspector work orders, projected only from canonical Oracle 019.
      if(path==='/api/si/v1/maritime-scheduling/my-work-orders'&&req.method==='GET'){
        if(!siScheduleOrders.ready)
          return respond(res,503,{error:'SI_SCHED_MIGRATION_019_REQUIRED'});
        dashboards.assertRole(req,'EDITOR');
        const identity=moeiAuth.require(req);
        const actor=identity.email||identity.username;
        return respond(res,200,{status:'ok',orders:await siScheduleOrders.mine(actor)});
      }
      // SI-S02: supervisor schedule approval -> traceable per-vessel engineer
      // work orders -> mandatory checklist initialization -> separately
      // reviewed A04 additions -> explicit inspector start. Oracle migration
      // 019 required; existing NMC/PSC source decisions remain independent.
      const workRoute=/^\/api\/si\/v1\/maritime-scheduling\/plans\/([a-f0-9-]{36})\/(approve|work-orders)(?:\/([a-f0-9-]{36})\/(activate|scope|start))?$/.exec(path);
      if(workRoute){
        if(!siScheduleOrders.ready)
          return respond(res,503,{error:'SI_SCHED_MIGRATION_019_REQUIRED'});
        const planId=workRoute[1],operation=workRoute[2],
          orderId=workRoute[3],orderAction=workRoute[4];
        const supervisor=operation==='approve'||orderAction==='scope';
        dashboards.assertRole(req,supervisor?'PUBLISHER':'EDITOR');
        const identity=moeiAuth.require(req,{mutate:req.method==='POST'});
        const actor=identity.email||identity.username;
        if(!actor)return respond(res,403,{error:'SI_WORK_ORDER_AUTHENTICATED_OPERATOR_REQUIRED'});
        if(req.method==='GET'&&operation==='work-orders'&&!orderId){
          const value=await siScheduleOrders.byPlan(planId);
          return respond(res,200,{status:'ok',schedule:value});
        }
        if(req.method==='POST'&&operation==='approve'&&!orderId){
          const body=await requestJson(req,1024*1024);
          if(!Array.isArray(body.requests)||!body.requests.length||
             body.requests.length>500||
             typeof body.demoMode!=='boolean'||
             body.confirmApproval!==true)
            return respond(res,422,{error:'SI_SCHED_APPROVAL_INPUT_INVALID'});
          if(body.demoMode&&process.env.SI_SCHEDULING_DEMO_MODE!=='true')
            return respond(res,403,{error:'SI_POC_DEMO_MODE_NOT_ENABLED'});
          const plan=await siRollingPlans.get(planId);
          const original=siErp.requireSnapshot(),dashboard=await siTargeting.dashboard();
          const snapshot=body.demoMode?buildPocErpSchedulingOverlay(original):original;
          const sourceContext=maritimePlanSchedulingContext(plan,dashboard,original);
          const context=body.demoMode?
            fillPocSchedulingVisitContext(sourceContext,snapshot):sourceContext;
          validateOperatorScheduleAgainstSource(sourceContext,body.requests,{
            demo:body.demoMode,context});
          if(body.demoMode)validatePocSchedulingDemoRequest(context,body.requests);
          const refs=await cases.listInspectionRequests();
          const bookings=body.demoMode?[]:
            await siScheduling.centralBookings(snapshot);
          const proposal=proposeMaritimeBatchSchedule({
            plan,erpSnapshot:snapshot,policy:siScheduling.getPolicy(),
            requests:body.demoMode?body.requests.map(x=>({...x,pocDemo:true})):
             body.requests,nmcReferrals:refs,
            existingBookings:body.demoMode?[]:
             [...siScheduling.state.confirmed,...bookings],
            scheduler:siScheduling
          });
          const saved=await siScheduleOrders.approve({
            plan,proposal,selectedOptionId:body.selectedOptionId,
            expectedHash:body.expectedProposalHash,
            expectedPlanRevision:body.expectedPlanRevision,
            actor,reason:body.reason,confirmApproval:true,
            confirmCrossPort:body.confirmCrossPort===true,
            demoMode:body.demoMode
          });
          return respond(res,201,{status:'WORK_ORDERS_ISSUED',schedule:saved,
            officialErpBookingCreated:false,
            inspectionCasesCreated:0});
        }
        if(req.method==='POST'&&operation==='work-orders'&&orderId){
          const data=await requestJson(req,4096);
          let result;
          if(orderAction==='activate')
            result=await siScheduleOrders.activate({
              planId,orderId,actor,generateAi:data.generateAi===true,
              confirmAiCost:data.confirmAiCost===true});
          else if(orderAction==='scope')
            result=await siScheduleOrders.approveScope({
              planId,orderId,actor,reason:data.reason,
              includeAiSuggestions:data.includeAiSuggestions===true});
          else if(orderAction==='start'){
            // POC mock delegation is an explicit publisher-supervisor action.
            if(data.confirmPocDelegation===true)dashboards.assertRole(req,'PUBLISHER');
            result=await siScheduleOrders.startField({
              planId,orderId,actor,
              confirmPocDelegation:data.confirmPocDelegation===true});
          }
          else return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
          return respond(res,200,{status:'ok',order:result,
            fieldRoute:result.caseId?
             '/moei/smart-inspection/lifecycle/'+result.caseId:null});
        }
        return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
      }
      if(path==='/api/si/v1/inspection-batches/preview'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        const planId=new URL(req.url||'/', 'http://localhost').searchParams.get('planId');
        if(planId&&!siRollingPlansReady)return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        return respond(res,200,await siBulkPlan.preview(planId));
      }
      if(path==='/api/si/v1/inspection-batches'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,{batches:siBulkPlan.latest()});
      }
      if(path==='/api/si/v1/inspection-batches'&&req.method==='POST'){
        dashboards.assertRole(req,'PUBLISHER');
        const identity=moeiAuth.session(req);
        const input=await requestJson(req,8192);
        if(input.planId&&!siRollingPlansReady)
          return respond(res,503,{error:'SI_ROLLING_MIGRATION_018_REQUIRED'});
        return respond(res,202,await siBulkPlan.approve({
          ...input,actor:identity?.email||identity?.username||input.actor
        }));
      }
      const batchPath=/^\/api\/si\/v1\/inspection-batches\/([a-f0-9-]{36})$/.exec(path);
      if(batchPath&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,siBulkPlan.get(batchPath[1]));
      }
      // New SI-C01 advisory is NEVER an approval and NEVER changes persisted cases.
      // MOCK branch has zero Airia usage; Airia mode reuses exact payload shape.
      if(path==='/api/si/v1/agents/configuration'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,{status:'ok',provider:siAiProvider.toUpperCase(),
          mock:siAiProvider==='mock',externalCallsInMock:0,
          agents:['SI-C01','SI-P01','SI-A04'],
          caveat:'MOCK responses are templates, not real maritime AI decisions.'});
      }
      if(path==='/api/si/v1/agents/candidate-selection/preview'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siCandidateAgent.preview());
      }
      if(path==='/api/si/v1/agents/candidate-selection/run'&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siCandidateAgent.run(await requestJson(req,4096)));
      }
      // SI-09: source-backed manager view, GET only, Editor role required.
      if(path==='/api/si/v1/management'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siLifecycle.managementSnapshot());
      }
      // Unified inspection cycle: read-only timeline, explicit human-gated state changes.
      // GET never initiates an AI call or writes a case.
      if(path==='/api/si/v1/lifecycle'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siLifecycle.list());
      }
      if(path==='/api/si/v1/advisors/coverage'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,{status:'ok',...siFutureAdvisorCoverage(),
          liveAgentOptions:Object.fromEntries(['s01','v01','r01','x01'].map(id=>[
            'SI-'+id.toUpperCase(),{enabled:agentAllowed(id),pipelineRegistered:Boolean(pipelines[id]),
              provider:siAiProvider==='airia'&&agentAllowed(id)?'AIRIA':'MOCK',
              contractStatus:'PARTNER_LIVE_RESPONSE_VALIDATION_REQUIRED'}]))});
      }
      const advisorPath=/^\/api\/si\/v1\/lifecycle\/([a-f0-9-]{36})\/advisors\/(SI-(?:S01|V01|R01|X01))\/run$/.exec(path);
      if(advisorPath&&req.method==='POST'){
        dashboards.assertRole(req,'EDITOR');
        const input=await requestJson(req,4096);
        const view=await siLifecycle.snapshot(advisorPath[1]);
        const agentCode=advisorPath[2],agentKey=agentCode.slice(3).toLowerCase();
        if(siAiProvider!=='airia'||!agentAllowed(agentKey))
          return respond(res,200,runSiPocAdvisor({agentCode,caseId:advisorPath[1],
            scenario:input.scenario||null},view));
        if(input.confirmRun!==true)
          throw new SiPocAdvisorError('SI_AIRIA_EXPLICIT_INVOCATION_REQUIRED',422);
        let proposal=null,history=[],media=null;
        if(agentCode==='SI-S01')proposal=siScheduling.list().find(p=>
          p.referral?.id===view.inspectionCase.nmcReferralId&&p.status==='PROPOSED')||null;
        if(agentCode==='SI-V01')media=await verifiedSiVisionMedia(advisorPath[1],view);
        if(agentCode==='SI-X01'){
          const all=await siLifecycle.list();
          const old=all.cases.filter(c=>c.imo===view.inspectionCase.imo&&
            c.id!==advisorPath[1]).slice(0,8);
          for(const c of old){
            const earlier=await siLifecycle.snapshot(c.id);
            history.push(...(earlier.record?.findings||[]).map(f=>({
              ...f,caseId:c.id,imo:c.imo})));
          }
        }
        return respond(res,200,await runSiAiriaAdvisor({
          agentCode,caseId:advisorPath[1],scenario:input.scenario||null
        },view,{executeAgent:fleetAgentCall,executeVision:callSiVisionAiria,
          proposal,history,media,actor:req.moeiUser?.email||req.moeiUser?.username||'MOEI_OPERATOR'}));
      }
      const lifecyclePath=/^\/api\/si\/v1\/lifecycle\/([0-9a-f-]{36})(?:\/(actions|history))?$/.exec(path);
      if(lifecyclePath){
        const id=lifecyclePath[1],suffix=lifecyclePath[2];
        if(req.method==='GET'&&!suffix){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,await siLifecycle.snapshot(id));
        }
        if(req.method==='GET'&&suffix==='history'){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,await siLifecycle.history(id));
        }
        if(req.method==='POST'&&suffix==='actions'){
          const body=await requestJson(req,32768);
          const controlled=new Set(['APPROVE_SCOPE','APPROVE_REPORT','RETURN_REPORT',
            'ISSUE_ACTIONS','VERIFY_ACTION','RECORD_FOLLOW_UP','CLOSE']);
          dashboards.assertRole(req,controlled.has(body.action)?'PUBLISHER':'EDITOR');
          return respond(res,200,await siLifecycle.apply(id,body));
        }
        return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
      }
      // SI-02 Preparation Queue: a read-only APPROVED case ledger, independent
      // of live targeting projections or migration 013, never calls AI.
      if(path==='/api/si/v1/preparations'&&req.method==='GET'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siPreparation.list());
      }
      // Full source-grounded dossier is assembled from the same saved SI case
      // and optional A04 overlay; GET must never call Airia or create cases.
      const vesselDossierRoute=/^\/api\/si\/v1\/preparations\/([a-f0-9-]{36})\/dossier$/.exec(path);
      if(vesselDossierRoute){
        dashboards.assertRole(req,'EDITOR');
        moeiAuth.require(req);
        if(req.method!=='GET')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
        const caseId=vesselDossierRoute[1];
        const view=await siPreparation.get(caseId);
        const schedules=siScheduleOrders.ready?await siScheduleOrders.all():[];
        const linked=schedules.flatMap(schedule=>schedule.orders.map(order=>({
          schedule,order
        }))).find(x=>x.order.caseId===caseId)||null;
        let checklist=null;
        try{checklist=await siChecklistField.preview(caseId);}
        catch{/* Unavailable checklist is an explicit dossier evidence gap. */}
        return respond(res,200,assembleSiVesselDossier({
          view,schedule:linked?.schedule,order:linked?.order,checklist
        }));
      }
      const prepPath=/^\/api\/si\/v1\/preparations\/([a-f0-9-]{36})(?:\/(prepare|generate|review))?$/.exec(path);
      if(prepPath){
        const caseId=prepPath[1],step=prepPath[2]||null;
        dashboards.assertRole(req,step==='review'?'PUBLISHER':'EDITOR');
        if(req.method==='GET'&&!step)
          return respond(res,200,await siPreparation.get(caseId));
        if(req.method==='POST'&&step==='prepare')
          return respond(res,201,await siPreparation.prepare(caseId,await requestJson(req,2048)));
        if(req.method==='POST'&&step==='generate')
          return respond(res,201,await siPreparation.generate(caseId,await requestJson(req,2048)));
        if(req.method==='POST'&&step==='review')
          return respond(res,200,await siPreparation.review(caseId,await requestJson(req,2048)));
        return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
      }
      const templateRoute=/^\/api\/si\/v1\/candidate-sources\/template\/(SERVICE_REQUEST|PSC_PORT_CALL)$/.exec(path);
      if(req.method==='GET'&&templateRoute){
        const bytes=await siSourceImports.template(templateRoute[1]);
        res.writeHead(200,{
          'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':'attachment; filename="SI_'+templateRoute[1]+'_POC_Template.xlsx"',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
        });
        return res.end(bytes);
      }
      if(req.method==='GET'&&path==='/api/si/v1/candidate-sources'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siSourceImports.status());
      }
      if(req.method==='POST'&&path==='/api/si/v1/candidate-sources/preview'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,await siSourceImports.preview(await requestJson(req,3*1024*1024)));
      }
      if(req.method==='POST'&&path==='/api/si/v1/candidate-sources/commit'){
        dashboards.assertRole(req,'EDITOR');
        const saved=await siSourceImports.commit(await requestJson(req,2048));
        // The imported source is already committed. Calculate PSC selection
        // read-only; never turn a later view failure into a misleading import
        // failure or make a second paid Airia request.
        let pscQuota=null;
        if(saved.sourceType==='PSC_PORT_CALL'){
          try{
            const pool=await siPscSelection.pool();
            pscQuota={policyVersion:pool.policy.version,
              ratePercent:pool.policy.config.ratePercent,
              scope:pool.scope,
              eligibleEvents:pool.summary.eligiblePortCalls,
              selectedEvents:pool.summary.selectedPortCalls,
              automaticEvents:pool.summary.automaticallyShortlistedPortCalls,
              buckets:pool.summary.buckets};
          }catch{
            pscQuota={status:'READINESS_RECALCULATION_PENDING'};
          }
        }
        return respond(res,201,{...saved,pscQuota,
          autoRuleShortlisting:true,aiCalls:0,
          requiresOfficialInspectionApproval:true});
      }
      // Read-only P01 status/preview/history retained for historical audit only.
      if(path==='/api/si/v1/prioritization'||path.startsWith('/api/si/v1/prioritization/')){
        if(req.method==='GET'&&path==='/api/si/v1/prioritization'){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,await siPriority.status());
        }
        if(req.method==='GET'&&path==='/api/si/v1/prioritization/history'){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,{status:'ok',runs:await siPriority.history(15)});
        }
        if(req.method==='POST'&&path==='/api/si/v1/prioritization/preview'){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,200,await siPriority.preview());
        }
        if(req.method==='POST'&&path==='/api/si/v1/prioritization/run'){
          dashboards.assertRole(req,'EDITOR');
          return respond(res,409,{error:'SI_P01_OUT_OF_CURRENT_POC_SCOPE',
            message:'Use SI-C01 before approval and SI-S01 for feasible slots.'});
        }
      }
      if(req.method==='GET'&&path==='/api/si/v1/psc-selection/pool'){
        dashboards.assertRole(req,'EDITOR');
        const params=new URL(req.url||'/', 'http://localhost').searchParams;
        const selectedPeriod=params.get('period');
        const selectedPort=params.get('port');
        return respond(res,200,await siPscSelection.pool({
          period:selectedPeriod||null,port:selectedPort||null}));
      }
      if(req.method==='GET'&&path==='/api/si/v1/psc-selection/policy'){
        // Published business settings are read-only and visible to platform
        // users (like NMC risk policy). Preview still needs EDITOR;
        // publishing, quotas and event decisions remain role-protected.
        return respond(res,200,{status:'ok',policy:await siPscSelection.policy()});
      }
      if(req.method==='POST'&&path==='/api/si/v1/psc-selection/policy/preview'){
        dashboards.assertRole(req,'EDITOR');
        const input=await requestJson(req,8192);
        return respond(res,200,await siPscSelection.previewPolicy(input.config));
      }
      if(req.method==='POST'&&path==='/api/si/v1/psc-selection/policy/publish'){
        dashboards.assertRole(req,'PUBLISHER');
        return respond(res,201,{status:'ok',policy:await siPscSelection.publish(await requestJson(req,8192))});
      }
      if(req.method==='POST'&&path==='/api/si/v1/psc-selection/decision'){
        dashboards.assertRole(req,'PUBLISHER');
        return respond(res,201,{status:'ok',decision:await siPscSelection.decide(await requestJson(req,4096))});
      }
      if(req.method==='GET'&&path==='/api/si/v1/candidates/dashboard')
        return respond(res,200,await siTargeting.dashboard());
      if(req.method==='GET'&&path==='/api/si/v1/rules')
        return respond(res,200,{status:'ok',policy:await siTargeting.policy()});
      if(req.method==='POST'&&path==='/api/si/v1/candidates/source-events'){
        dashboards.assertRole(req,'EDITOR');
        // POC2: external candidates come through validated source Excel,
        // and approved NMC referrals remain read-only.
        return respond(res,410,{error:'SI_SOURCE_EXCEL_IMPORT_REQUIRED'});
      }
      if(req.method==='POST'&&path==='/api/si/v1/candidates/decision'){
        const payload=await requestJson(req,4096);
        // A single source event must never be approved while other vessel
        // reasons are silently ignored. The complete-plan wizard is mandatory.
        if(payload.action==='APPROVE'){
          dashboards.assertRole(req,'PUBLISHER');
          return respond(res,409,{error:'SI_APPROVAL_REQUIRES_COMPLETE_PLAN',
            next:'/moei/smart-inspection/plan/create'});
        }
        dashboards.assertRole(req,'EDITOR');
        return respond(res,201,await siTargeting.decide(payload));
      }
      if(req.method==='POST'&&path==='/api/si/v1/rules/impact-preview'){
        dashboards.assertRole(req,'EDITOR');
        const payload=await requestJson(req,2048);
        return respond(res,200,await siTargeting.previewRules(payload.config));
      }
      if(req.method==='POST'&&path==='/api/si/v1/rules/publish'){
        dashboards.assertRole(req,'PUBLISHER');
        return respond(res,201,{status:'ok',
          policy:await siTargeting.publishRules(await requestJson(req,4096))});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(e){
      if(e instanceof SiCandidateAgentError)
        return respond(res,e.status,{error:e.code,
          ...(e.diagnosticCode?{reasonCode:e.diagnosticCode}:{}),
          ...(e.failureCounts?{failureCounts:e.failureCounts}:{}),
          ...(Number.isInteger(e.expectedCount)?{expectedCount:e.expectedCount}:{}),
          ...(Number.isInteger(e.returnedCount)?{returnedCount:e.returnedCount}:{}),
          ...(Number.isInteger(e.batchIndex)?{batchIndex:e.batchIndex}:{}),
          ...(Number.isInteger(e.batchCount)?{batchCount:e.batchCount}:{})});
      if(e instanceof SiError||e instanceof SiPocAdvisorError||e instanceof SiRollingPlanError||e instanceof SiIntegratedPlanError||
       e instanceof SiBulkApprovalError||e instanceof SiCandidateAgentError||e instanceof SiLifecycleError||e instanceof SiSelectionError||e instanceof SiPriorityError||e instanceof SiPreparationError||e instanceof SiWorkOrderError||e instanceof SiTargetingError||e instanceof MoeiAuthError||e instanceof DashboardError)
        return respond(res,e.status,{error:e.code});
      if(Number.isInteger(e?.status)&&e.status>=400&&e.status<500)
        return respond(res,e.status,{error:'SI_REQUEST_INVALID'});
      const rollingRoute=path==='/api/si/v1/inspection-plans'||
        path.startsWith('/api/si/v1/inspection-plans/');
      // These two modules share the SI router but have different Oracle
      // repositories. Don't report a rolling-catalog failure as targeting.
      const module=rollingRoute?'si-rolling':'si-targeting';
      console.error('['+module+'] REQUEST_FAILED '+
        String(e?.code||'UNAVAILABLE').replace(/[^A-Z0-9_-]/gi,'').slice(0,40));
      return respond(res,503,{error:rollingRoute?
        'SI_ROLLING_STORE_UNAVAILABLE':'SI_TARGETING_UNAVAILABLE'});
    }
  }

  // Smart Inspection ERP Excel Simulator + Electronic Scheduling (Phase 1).
  // GET operations never trigger Airia/AI, and only explicit confirmed bookings
  // update an existing, human-approved NMC referral.
  if(path==='/api/si/erp'||path.startsWith('/api/si/erp/')||
     path==='/api/si/scheduling'||path.startsWith('/api/si/scheduling/')){
    try{
      if(req.method==='GET'&&path==='/api/si/erp/status')
        return respond(res,200,{status:'ok',...siErp.status()});
      if(req.method==='POST'&&path==='/api/si/erp/import/preview'){
        dashboards.assertRole(req,'EDITOR');
        const payload=await requestJson(req,4*1024*1024+4096);
        return respond(res,200,await siErp.previewBase64(payload.workbookBase64));
      }
      if(req.method==='POST'&&path==='/api/si/erp/import/commit'){
        dashboards.assertRole(req,'EDITOR');
        const payload=await requestJson(req,4096);
        return respond(res,200,{status:'ok',workforce:siErp.commit(payload.snapshotId)});
      }
      if(req.method==='GET'&&path==='/api/si/erp/inspectors'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,200,{status:'ok',inspectors:siErp.requireSnapshot().data.Inspectors});
      }
      if(req.method==='GET'&&path==='/api/si/erp/ports')
        return respond(res,200,{status:'ok',ports:siErp.requireSnapshot().data.Ports});
      if(req.method==='GET'&&path==='/api/si/scheduling/policy')
        return respond(res,200,{status:'ok',policy:siScheduling.getPolicy()});
      if(req.method==='GET'&&path==='/api/si/scheduling/policy/history')
        return respond(res,200,{status:'ok',history:siScheduling.history()});
      if(req.method==='POST'&&path==='/api/si/scheduling/policy/publish'){
        dashboards.assertRole(req,'PUBLISHER');
        return respond(res,200,{status:'ok',policy:siScheduling.publishPolicy(
          await requestJson(req,16384))});
      }
      if(req.method==='GET'&&path==='/api/si/scheduling/referrals')
        return respond(res,200,{status:'ok',referrals:await siScheduling.referrals()});
      if(req.method==='GET'&&path==='/api/si/scheduling/proposals')
        return respond(res,200,{status:'ok',proposals:siScheduling.list()});
      if(req.method==='POST'&&path==='/api/si/scheduling/proposals'){
        dashboards.assertRole(req,'EDITOR');
        const proposal=await siScheduling.propose(await requestJson(req,8192));
        // Fully electronic: a published policy may automatically confirm an
        // eligible NMC referral without any additional browser approval click.
        // The engine rechecks constraints immediately before writing the case.
        const auto=proposal.options[0]?.approval==='AUTO_ELIGIBLE';
        if(auto){
          const confirmed=await siScheduling.confirm({proposalId:proposal.id,
            optionId:proposal.options[0].optionId,allowManual:false});
          return respond(res,201,{status:'ok',
            proposal:{...proposal,status:'CONFIRMED',confirmed:confirmed.booking},
            autoConfirmed:true});
        }
        return respond(res,201,{status:'ok',proposal,autoConfirmed:false});
      }
      const confirmation=/^\/api\/si\/scheduling\/proposals\/([a-f0-9-]{36})\/confirm$/.exec(path);
      if(req.method==='POST'&&confirmation){
        const body=await requestJson(req,4096);
        const proposal=siScheduling.state.proposals.find(x=>x.id===confirmation[1]);
        const option=proposal?.options?.find(x=>x.optionId===body.optionId);
        // IMPORTANT: manual approval requires the separate publisher/supervisor key.
        const manual=option?.approval==='MANUAL_APPROVAL_REQUIRED';
        dashboards.assertRole(req,manual?'PUBLISHER':'EDITOR');
        return respond(res,200,await siScheduling.confirm({
          proposalId:confirmation[1],optionId:body.optionId,allowManual:manual
        }));
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof SiError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'SI_REQUEST_INVALID'});
      console.error('[si-scheduling] REQUEST_FAILED code='+
        (/^ORA-\d{5}$/.test(String(error?.code))?error.code:'UNAVAILABLE'));
      return respond(res,503,{error:'SI_SCHEDULING_UNAVAILABLE'});
    }
  }

  // Read-only cross-domain Smart Inspection scheduling queue from centrally saved cases.
  // Legacy synthetic targeting candidates remain a separate information source.
  if(path==='/api/ai/inspection-referrals'){
    if(req.method!=='GET')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try{return respond(res,200,{status:'ok',requests:(await cases.listInspectionRequests()).filter(r=>AIRIA_DEMO_99_IMOS.has(r.imo))});}
    catch{return respond(res,503,{error:'CASE_STORE_UNAVAILABLE'});}
  }

  // A case is opened only after a human acknowledges a saved alert.
  // Audit and task changes are server-side, never browser-local session state.
  if(path==='/api/ai/cases'||path.startsWith('/api/ai/cases/')){
    const segments=path.split('/').filter(Boolean);
    const [, , resource, first, action, second, third]=segments;
    if(resource!=='cases')return respond(res,404,{error:'CASE_NOT_FOUND'});
    try{
      if(req.method==='GET'){
        if(first==='decision-catalogue'&&!action)return respond(res,200,{
          status:'ok',policyVersion:DECISION_POLICY_VERSION,
          pocOnly:true,decisions:catalogueSummaries()
        });
        if(!first)return respond(res,200,{status:'ok',cases:(await cases.list()).filter(c=>AIRIA_DEMO_99_IMOS.has(c.imo))});
        if(first==='by-imo'&&/^\d{7}$/.test(action)&&!second){
          const item=await cases.byImo(action);
          return respond(res,200,{status:'ok',case:item});
        }
        if(/^[a-f\d-]{36}$/i.test(first)&&!second){
          if(action==='action-plan-source'){
            const item=await cases.get(first);
            if(!item)throw new NmcCaseError('CASE_NOT_FOUND',404);
            const preview=await caseA01SourcePreview(item);
            const {source,...safe}=preview;
            return respond(res,200,{status:'ok',caseId:item.id,
              caseVersion:item.version,...safe});
          }
          if(action==='history')
            return respond(res,200,{status:'ok',history:await cases.history(first)});
          if(!action){
            const item=await cases.get(first);
            return respond(res,item?200:404,item?{status:'ok',case:item}:{error:'CASE_NOT_FOUND'});
          }
        }
        return respond(res,404,{error:'CASE_NOT_FOUND'});
      }
      if(req.method==='POST'){
        if(first==='from-alert'&&!action){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          if(body.withAiActionPlan!==true)
            throw new NmcCaseError('CASE_CREATION_AI_REQUIRED',400);
          if(!getAiriaKey())throw new NmcCaseError('AIRIA_NOT_CONFIGURED',503);
          const item=await cases.fromAlert(body.alertId);
          if(item.actionPlan)
            return respond(res,200,{status:'ok',case:item,aiActionPlanStatus:'READY'});
          try{
            // Exactly one requested A01 call as part of Create Maritime Case.
            // The case is persisted before A01, so retries never duplicate it.
            const planned=await prepareCaseA01Actions(item.id,item.version);
            return respond(res,200,{status:'ok',case:planned,aiActionPlanStatus:'READY'});
          }catch(error){
            // Fail closed: preserve the case and prior audit, but never pretend
            // AI proposals exist if the agent failed or returned invalid data.
            if(!(error instanceof NmcCaseError||error instanceof ActionPlanError||
                 String(error?.message||'').startsWith('AIRIA_')))throw error;
            const code=error instanceof NmcCaseError||error instanceof ActionPlanError
              ?error.code:'A01_ACTION_PLAN_UNAVAILABLE';
            const stored=await cases.get(item.id);
            return respond(res,200,{status:'ok',case:stored,
              aiActionPlanStatus:'FAILED',aiActionPlanError:{
                code,details:error instanceof ActionPlanError?error.details:{}
              }});
          }
        }
        if(!/^[a-f\d-]{36}$/i.test(first))return respond(res,404,{error:'CASE_NOT_FOUND'});
        if(action==='operational-decision'&&second==='initialize'&&!third){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.initializeOperational(first,body.version,'OPERATOR');
          return respond(res,200,{status:'ok',case:item,aiCallCount:0});
        }
        if(action==='incidents'&&second&&third==='decision'){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.decideIncident(first,body.version,second,body,'OPERATOR');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='operational-decision'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.decideOperational(first,body.version,body,'OPERATOR');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='restriction'&&second==='authorize'&&!third){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          const item=await cases.authorizeRestriction(first,body.version,body,'POC_SUPERVISOR');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='restriction'&&second==='release'&&!third){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          const item=await cases.releaseRestriction(first,body.version,body,'POC_SUPERVISOR');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='action-plan'&&second==='generate'&&!third){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await prepareCaseA01Actions(first,body.version,{
            acknowledgeHistoricalAssessment:body.acknowledgeHistoricalAssessment===true,
            reviewedLatestAssessmentId:body.reviewedLatestAssessmentId
          });
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='actions'&&second&&third==='decision'){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.decideAction(first,body.version,second,
            body.decision,body.note||'','OPERATOR',body.replacementActionType||null);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='inspections'&&second&&third==='schedule'){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.scheduleInspection(first,body.version,second,body);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='task'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,4096);
          const item=await cases.task(first,body.version,body.taskId,
            body.action,body.note||'');
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='decision'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,16384);
          const item=await cases.decision(first,body.version,body);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='inspection'&&!second){
          dashboards.assertRole(req,'EDITOR');
          const body=await requestJson(req,8192);
          const item=await cases.inspection(first,body.version,body.outcome);
          return respond(res,200,{status:'ok',case:item});
        }
        if(action==='resolve'&&!second){
          dashboards.assertRole(req,'PUBLISHER');
          const body=await requestJson(req,4096);
          const item=await cases.resolve(first,body.version,body.note);
          return respond(res,200,{status:'ok',case:item});
        }
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof ActionPlanError)
        return respond(res,error.status,{error:error.code,details:error.details});
      if(error instanceof NmcCaseError||error instanceof NmcAlertError||
         error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      // Upstream AI faults must never be mistaken for case-store failures.
      const upstreamCode=String(error?.message||'');
      if(upstreamCode==='AIRIA_NOT_CONFIGURED')
        return respond(res,503,{error:'AIRIA_NOT_CONFIGURED'});
      if(upstreamCode.startsWith('AIRIA_'))
        return respond(res,502,{error:'A01_ACTION_PLAN_UNAVAILABLE'});
      console.error('[nmc-cases] API_FAILURE');
      return respond(res,503,{error:'CASE_STORE_UNAVAILABLE'});
    }
  }

  // In-app notifications and business alert workflow. Risk source is SAVED AI.
  // Shared POC editor/publisher secrets stand in for operator/supervisor
  // authorization until an authenticated IAM solution is installed.
  if(path==='/api/ai/alerts'||path.startsWith('/api/ai/alerts/')){
    const match=/^\/api\/ai\/alerts(?:\/([a-fA-F0-9-]{36})(?:\/(history|acknowledge|follow-up|escalate|resolve|dismiss))?)?$/.exec(path);
    if(!match)return respond(res,404,{error:'ALERT_NOT_FOUND'});
    const [,id,action]=match;
    try{
      if(req.method==='GET'){
        if(!id){
          const projection=riskPolicy.ready?await riskPolicy.projectCurrent():null;
          return respond(res,200,await alerts.overview(projection,AIRIA_DEMO_99_IMOS));
        }
        if(action==='history')return respond(res,200,{status:'ok',history:await alerts.history(id)});
        if(action)return respond(res,404,{error:'ALERT_NOT_FOUND'});
        const item=await alerts.get(id);
        return respond(res,item?200:404,item?{status:'ok',alert:item}:{error:'ALERT_NOT_FOUND'});
      }
      if(req.method==='POST'&&id&&action){
        const operations={
          acknowledge:'ACKNOWLEDGE','follow-up':'START_FOLLOW_UP',
          escalate:'ESCALATE',resolve:'RESOLVE',dismiss:'DISMISS'
        };
        if(!operations[action])return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
        const supervisor=action==='resolve';
        dashboards.assertRole(req,supervisor?'PUBLISHER':'EDITOR');
        const body=await requestJson(req,4096);
        const updated=await alerts.transition(id,operations[action],
          body.version,action==='dismiss'?
            'Dismissed superseded notification from operational inbox.':
            body.note||'',supervisor?'SUPERVISOR':'OPERATOR');
        return respond(res,200,{status:'ok',alert:updated});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof NmcAlertError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      console.error('[nmc-alerts] API_FAILURE');
      return respond(res,503,{error:'ALERT_STORE_UNAVAILABLE'});
    }
  }

  // Executive dashboard AI focus is ON-DEMAND ONLY, with an editor key and
  // explicit possible-cost confirmation. No fleet/Oracle/incident mutations.
  if(path==='/api/ai/nmc/dashboard-focus/status'){
    if(req.method!=='GET')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    return respond(res,200,{status:'ok',...dashboardAiFocus.status()});
  }
  if(path==='/api/ai/nmc/dashboard-focus/run'){
    if(req.method!=='POST')return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try{
      dashboards.assertRole(req,'EDITOR');
      const input=await requestJson(req,4096);
      return respond(res,200,await dashboardAiFocus.run(input));
    }catch(error){
      if(error instanceof DashboardFocusError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      console.error('[nmc-kpi-focus] AI_REQUEST_FAILED');
      return respond(res,503,{error:'DASHBOARD_FOCUS_AI_UNAVAILABLE'});
    }
  }

  // Read-only, published-only sidebar navigation: never return drafts or templates.
  if(path==='/api/ai/dashboards/published'&&req.method==='GET'){
    try{return respond(res,200,{status:'ok',dashboards:await dashboards.publishedMenu()});}
    catch(error){
      if(error instanceof DashboardError)return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }
  // Published dashboard sharing is read-only and intentionally excludes drafts.
  const publishedMatch = /^\/api\/ai\/dashboards\/published\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (publishedMatch) {
    if (req.method !== 'GET') return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    try {
      const board = await dashboards.get(publishedMatch[1]);
      if (!board || board.status !== 'PUBLISHED') {
        return respond(res,404,{error:'PUBLISHED_DASHBOARD_NOT_FOUND'});
      }
      return respond(res,200,{status:'ok',dashboard:board});
    } catch (error) {
      if (error instanceof DashboardError) return respond(res,error.status,{error:error.code});
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }

  // Dashboard read operations remain independent of Airia and Fleet scheduler.
  // Writes require a server-managed access key. Role labels are shared-key
  // permissions, not end-user identity. Integrate real IAM before production.
  if (path === '/api/ai/dashboards' || path.startsWith('/api/ai/dashboards/')) {
    const match=/^\/api\/ai\/dashboards(?:\/([a-zA-Z0-9_-]{1,100})(?:\/(publish|revisions|placement|edit))?)?$/.exec(path);
    if(!match)return respond(res,404,{error:'NOT_FOUND'});
    const [,id,action]=match;
    try{
      if(req.method==='GET'){
        if(!id)return respond(res,200,{status:'ok',dashboards:await dashboards.list()});
        if(action==='revisions')return respond(res,200,{status:'ok',revisions:await dashboards.revisions(id)});
        if(action)return respond(res,404,{error:'NOT_FOUND'});
        const item=await dashboards.get(id);
        return respond(res,item?200:404,item?{status:'ok',dashboard:item}:{error:'DASHBOARD_NOT_FOUND'});
      }
      if(req.method==='POST'&&!id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*128);
        return respond(res,201,{status:'ok',dashboard:await dashboards.create(body.dashboard)});
      }
      if(req.method==='PUT'&&id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*128);
        return respond(res,200,{status:'ok',dashboard:await dashboards.save(id,body.dashboard)});
      }
      if(req.method==='POST'&&id&&action==='edit'){
        dashboards.assertRole(req,'EDITOR');
        return respond(res,201,{
          status:'ok',dashboard:await dashboards.startPublishedEdit(id)
        });
      }
      if(req.method==='POST'&&id&&action==='publish'){
        dashboards.assertRole(req,'PUBLISHER');
        const body=await requestJson(req,1024*16);
        return respond(res,200,{status:'ok',dashboard:await dashboards.publish(id,body.version)});
      }
      if(req.method==='PATCH'&&id&&action==='placement'){
        dashboards.assertRole(req,'PUBLISHER');
        const body=await requestJson(req,1024*8);
        return respond(res,200,{status:'ok',
          dashboard:await dashboards.movePublished(id,body.menuPlacement,body.version)});
      }
      if(req.method==='DELETE'&&id&&!action){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,1024*16);
        await dashboards.archive(id,body.version);
        return respond(res,200,{status:'ok'});
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof DashboardError)return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      console.error('[nmc-dashboard] request failure');
      return respond(res,503,{error:'DASHBOARD_STORE_UNAVAILABLE'});
    }
  }

  // Fleet mutation is internal to the Node scheduler; the dashboard is read-only.
  if (path === '/api/ai/fleet/start' || path === '/api/ai/fleet/cancel') {
    return respond(res,405,{error:'AUTONOMOUS_FLEET_ONLY'});
  }

  const pscMatch = /^\/api\/ai\/psc\/vessels\/(\d{7})$/.exec(path);
  if (req.method === 'GET' && pscMatch) {
    try { return respond(res, 200, await getPscVessel(pscMatch[1])); }
    catch (error) {
      const reason = error?.message || 'PSC_BACKEND_ERROR';
      const safeReason = /^[A-Z][A-Z0-9_]{1,90}$/.test(reason) ? reason : 'PSC_BACKEND_ERROR';
      console.error('[psc-reader] '+safeReason); // No Google credentials, records or stack traces logged.
      return respond(res, error?.status === 404 ? 404 : 503, {
        error: error?.status === 404 ? 'PSC_VESSEL_NOT_FOUND' : 'PSC_DATA_UNAVAILABLE',
        reasonCode: safeReason, sourceMode:getPscHealth().sourceMode
      });
    }
  }

  // Read-only Google Drive folder per vessel; no Airia calls on GET.
  // A03 is only executed by an explicit Editor action with cost confirmation.
  const docRoute=/^\/api\/ai\/vessels\/(\d{7})\/documents(?:\/([A-Za-z0-9_-]{8,130})(?:\/(analyze|review))?)?$/.exec(path);
  if(docRoute){
    const [,imo,fileId,operation]=docRoute;
    try{
      if(req.method==='GET'&&!fileId)return respond(res,200,await documents.list(imo));
      if(req.method==='GET'&&fileId&&!operation){
        const record=await documents.read(imo,fileId);
        return respond(res,record?200:404,record?{status:'ok',analysis:record}:{error:'DOCUMENT_NOT_FOUND'});
      }
      if(req.method==='POST'&&fileId&&operation){
        dashboards.assertRole(req,'EDITOR');
        const body=await requestJson(req,8192);
        if(operation==='analyze'){
          const result=await documents.analyze(imo,fileId,{
            actor:body.actor,confirmCost:body.confirmCost});
          return respond(res,201,{status:'ok',analysis:result});
        }
        if(operation==='review'){
          const result=await documents.review(imo,fileId,{
            actor:body.actor,decision:body.decision,
            reason:body.reason,expectedVersion:body.expectedVersion});
          return respond(res,200,{status:'ok',analysis:result});
        }
      }
      return respond(res,405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){
      if(error instanceof DocumentError||error instanceof DashboardError)
        return respond(res,error.status,{error:error.code});
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500)
        return respond(res,error.status,{error:'INVALID_REQUEST'});
      // Never log Drive file content, credentials, JWT, agent body or private links.
      console.error('[nmc-a03] DOCUMENT_REQUEST_FAILED');
      return respond(res,503,{error:'DOCUMENT_SERVICE_UNAVAILABLE'});
    }
  }

  const match = /^\/api\/ai\/execute\/(a01|a02|a03|a04)$/i.exec(path);
  if (!match) return respond(res, 404, { error: 'NOT_FOUND' });
  if (req.method !== 'POST') return respond(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!getAiriaKey()) return respond(res, 503, { error: 'AIRIA_NOT_CONFIGURED', message: 'Configure the Airia API key in AI Settings & Governance, or provision a server bootstrap credential.' });

  const agent = match[1].toLowerCase();
  if(!agentAllowed(agent))return respond(res,403,{error:'AIRIA_AGENT_DISABLED',agent});
  let input;
  try {
    const parsed = await requestJson(req);
    input = Object.hasOwn(parsed, 'payload') ? parsed.payload : parsed;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return respond(res, 400, { error: 'INVALID_PAYLOAD', message: 'payload must be a JSON object.' });
    }
  } catch (error) {
    return respond(res, error.status || 400, { error: 'INVALID_REQUEST', message: error.message });
  }

  try {
    // Airia requires userInput to be a JSON-serialized STRING, not a nested object.
    const upstream = await fetch(`${runtime.get('AIRIA_BASE_URL')}/v1/PipelineExecution/${pipelines[agent]}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': getAiriaKey(),
        'Content-Type': 'application/json',
        'User-Agent': 'moei-nmc-adapter/1.0'
      },
      body: JSON.stringify({ userInput: JSON.stringify(input), asyncOutput: false }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      // Do not reflect upstream error bodies or secrets to the browser.
      return respond(res, 502, { error: 'AIRIA_REQUEST_FAILED', upstreamStatus: upstream.status, agent });
    }

    let result;
    try { result = JSON.parse(raw); } catch { result = raw; }
    return respond(res, 200, { agent, result });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    // Report an allowlisted transport code only: never log headers, API key,
    // request body or the upstream error message (which may contain secrets).
    const rawCode = String(error?.cause?.code || error?.code || 'UNKNOWN');
    const reasonCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : 'UNKNOWN';
    const errorName = String(error?.name || 'Error');
    console.error(`[airia-proxy] agent=${agent} errorName=${errorName} reasonCode=${reasonCode}`);
    return respond(res, timeout ? 504 : 502, {
      error: timeout ? 'AIRIA_TIMEOUT' : 'AIRIA_UNAVAILABLE',
      reasonCode,
      agent
    });
  }
});

try{
  await fleet.initialize(scheduler.bundles);
  try{
    await riskPolicy.initialize();
    // Backfill only the new projection table for pre-existing saved assessments,
    // without altering source assessments, cases or the alert audit.
    for(const row of Object.values(fleet.results).filter(r=>AIRIA_DEMO_99_IMOS.has(r.imo))){
      if(row.status==='COMPLETED'&&row.assessmentId)
        await riskPolicy.materializeCurrent(row);
    }
  }catch(error){
    // Surface only an Oracle error CODE for DBA diagnostics; do not log SQL,
    // connection strings, credentials, policy config or saved assessment data.
    const causeCode=String(error?.cause?.code||'UNKNOWN');
    const safeCode=/^(?:ORA-[0-9]{5}|NJS-[0-9]{3,5}|DPI-[0-9]{4}|UNKNOWN)$/.test(causeCode)
      ?causeCode:'UNKNOWN';
    const stage=riskPolicy.ready?'PROJECTION_BACKFILL':'POLICY_INITIALIZATION';
    console.error('[nmc-risk-policy] RISK_POLICY_SCHEMA_NOT_READY stage='+stage+
      ' reason='+String(error?.code||'UNKNOWN')+' oracleCode='+safeCode);
  }
  try{await documents.initialize();}
  catch(error){console.error('[nmc-a03] MIGRATION_015_REQUIRED - Google Drive document analysis disabled');}
  // Checklist Oracle storage is fail-closed. A local JSON store with any
  // data absent from Oracle blocks startup until explicit audited import.
  // Never silently switch from /data JSON to an empty Oracle repository.
  if(checklistStorage==='oracle'){
    await siChecklistLibrary.initialize();
    await siChecklistField.initialize();
    console.log('[si-checklist] STORAGE_ORACLE_READY schema=017');
  }else console.log('[si-checklist] STORAGE_JSON_POC');
  // Migration 018 may not yet exist on existing deployments. Keep NMC,
  // Checklist and SI lifecycle operational, but explicitly reject requests
  // to the new Rolling Plan API until its schema has been reviewed/applied.
  try{
    await siRollingPlans.initialize();siRollingPlansReady=true;
    console.log('[si-rolling] STORAGE_'+dbMode.toUpperCase()+'_READY schema=018');
  }catch(e){
    siRollingPlansReady=false;
    console.error('[si-rolling] SI_ROLLING_MIGRATION_018_REQUIRED - new planning API disabled');
  }
  try{await siTargeting.initialize();}
  catch(error){console.error('[si-targeting] SI_MIGRATION_009_REQUIRED - candidate API disabled');}
  try{await siPscSelection.initialize();}
  catch(error){console.error('[si-selection] SI_MIGRATION_012_REQUIRED - PSC targeting/candidate API disabled');}
  try{await siPriority.initialize();}
  catch(error){console.error('[si-prioritization] SI_MIGRATION_011_REQUIRED - SI-P01 advisory disabled');}
  try{await siPreparation.initialize();}
  catch(error){console.error('[si-preparation] SI_MIGRATION_010_REQUIRED - A04 dossier disabled');}
  try{await siLifecycle.initialize();}
  catch(error){console.error('[si-lifecycle] SI_MIGRATION_013_REQUIRED - end-to-end cycle disabled');}
  try{await siScheduleOrders.initialize();
    console.log('[si-work-orders] STORAGE_'+dbMode.toUpperCase()+'_READY schema=019');
  }catch(error){
    console.error('[si-work-orders] SI_SCHED_MIGRATION_019_REQUIRED - schedule approvals disabled');
  }
  try{await guidance.initialize();}
  catch(error){
    // Guidance requires migration 006, but an optional UI module must never
    // take down the live risk scheduler, existing cases, or saved Oracle scores.
    console.error('[nmc-guidance] GUIDANCE_SCHEMA_NOT_READY');
  }
  server.listen(port,'0.0.0.0',()=>{
    console.log(`NMC AI proxy listening on ${port}; mode=${dbMode}; fleet-auto=${scheduler.enabled}`);
    applyRuntimeSettings();
    // Optional incident triage worker. Off unless explicitly enabled; rows
    // must each opt in, and no request is triggered by loading dashboards.
    if(incidentFeed.autoEnabled&&incidentFeed.aiConfigured){
      const intervalMinutes=Math.min(1440,Math.max(5,Number(
        process.env.NMC_INCIDENT_AUTO_INTERVAL_MINUTES||15)||15));
      // Start once on boot: a newly delivered Sheet incident should not wait
      // for a user to open a page or click Analyze. Periodic scan is fallback.
      void incidentFeed.autoTick().then(result=>{
        console.log('[nmc-incidents] STARTUP_TRIAGE '+JSON.stringify(result));
      }).catch(()=>console.error('[nmc-incidents] STARTUP_TRIAGE_FAILED'));
      const timer=setInterval(()=>{
        void incidentFeed.autoTick().then(result=>{
          console.log('[nmc-incidents] TRIAGE_TICK '+JSON.stringify(result));
        }).catch(()=>{
          console.error('[nmc-incidents] TRIAGE_TICK_FAILED');
        });
      },intervalMinutes*60000);
      timer.unref();
      console.log('[nmc-incidents] AUTO_TRIAGE_ENABLED minutes='+intervalMinutes+
        ' maxPerCycle='+incidentFeed.autoMaxPerCycle);
    }
  });
}catch(error){
  // Fail closed: no AI requests if Oracle schema / credentials are not ready.
  const code=/^[A-Z][A-Z0-9_]{1,95}$/.test(String(error?.message||''))
    ?error.message:'ORACLE_STARTUP_FAILED';
  console.error('[nmc-db] '+code);
  process.exitCode=1;
}
