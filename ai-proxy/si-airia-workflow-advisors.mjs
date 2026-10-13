/**
 * MOEI Smart Inspection — Airia advisory integrations.
 * Agent JSON examples originate from the SI business/integration specification
 * v1.0 (12 Oct 2026); they are TARGET schemas until the actual MENA pipelines
 * are contract-tested. Fail closed rather than silently presenting mocks as AI.
 *
 * The validated local state owns approval/booking/findings/report/closure.
 * Only explicitly requested, authenticated POSTs invoke any provider.
 */
import {createHash,randomUUID} from 'node:crypto';
import {SiPocAdvisorError} from './si-poc-workflow-advisors.mjs';

const codes=Object.freeze({'SI-S01':'s01','SI-V01':'v01','SI-R01':'r01','SI-X01':'x01'});
const string=(s,max=1000)=>typeof s==='string'?s.slice(0,max):'';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const known=(refs)=>new Set(refs.filter(x=>typeof x==='string'&&x.length>0));
const error=(code,status=422)=>{throw new SiPocAdvisorError(code,status);};
function response(value){
  for(let i=0;i<8;i++){
    if(typeof value==='string'){
      try{value=JSON.parse(value);}catch{error('SI_AIRIA_RESPONSE_NOT_JSON',502);}
      continue;
    }
    if(Array.isArray(value)&&value.length===1){value=value[0];continue;}
    if(!value||typeof value!=='object'||Array.isArray(value))break;
    if(value.rankedOptions||value.candidateFinding||value.correctiveActionDrafts||value.flags)return value;
    const child=['result','response','output','data','finalOutput','outputText','content','text']
      .find(k=>value[k]!==undefined);
    if(!child)break;value=value[child];
  }
  error('SI_AIRIA_RESPONSE_CONTRACT_UNVERIFIED',502);
}
function refsFrom(view){
  const record=view?.record;
  return known([...(record?.checks||[]).flatMap(x=>x.evidenceRefs||[]),
    ...(record?.findings||[]).flatMap(x=>x.evidenceRefs||[])]);
}
function checkRefs(items,allowed){
  if(!Array.isArray(items)||items.some(e=>!allowed.has(e)))
    error('SI_AIRIA_EVIDENCE_NOT_IN_CASE',502);
}
function advice(code,title,explanation,evidenceRefs=[],severity='REVIEW_REQUIRED'){
  return {code,severity,title:string(title,220),explanation:string(explanation,1800),
    evidenceRefs,requiresHumanReview:true};
}
function base(agentCode,view){
  const c=view?.inspectionCase;
  if(!c||!c.id||!/^[0-9]{7}$/.test(c.imo||''))
    error('SI_AIRIA_APPROVED_INSPECTION_REQUIRED',409);
  return {agentCode,caseId:c.id,imo:c.imo,
    caseVersion:view.record?.version||0,stage:view.record?.stage||'NOT_STARTED',
    recordedEvidenceRefs:[...refsFrom(view)],
    sourceReferences:(c.inspectionReasons||[]).map(x=>x.sourceReference).filter(Boolean)};
}
export function buildSiAiriaRequest(agentCode,view,{proposal=null,history=[],media=null,actor='MOEI_OPERATOR'}={}){
  if(!codes[agentCode])error('SI_AIRIA_AGENT_UNKNOWN');
  const state=base(agentCode,view),r=view.record;
  const requestMeta={correlationId:agentCode+'-'+randomUUID(),actor:string(actor,120),
    language:'en',mode:'ADVISORY_ONLY'};
  if(agentCode==='SI-S01'){
    if(!proposal||proposal.status!=='PROPOSED'||!Array.isArray(proposal.options)||
       proposal.options.length===0||!proposal.erpSnapshotId||
       proposal.referral?.id!==view.inspectionCase.nmcReferralId||
       proposal.referral?.imo!==state.imo||
       Date.parse(proposal.expiresAt)<=Date.now())
      error('SI_S01_FRESH_FEASIBLE_PROPOSAL_REQUIRED',409);
    const feasibleSlots=proposal.options.map(o=>({
      optionId:o.optionId,inspectorId:o.inspectorId,startUtc:o.startUtc,
      endUtc:o.endUtc,startLocal:o.startLocal,portId:o.portId,
      score:o.score,travelMinutes:o.travelMinutes,approval:o.approval}));
    if(feasibleSlots.some(o=>!o.optionId||!o.inspectorId||!o.startUtc||!o.endUtc))
      error('SI_S01_FEASIBLE_SLOTS_INVALID',409);
    const slotSetHash=hash({erpSnapshotId:proposal.erpSnapshotId,
      policyRevision:proposal.policyRevision,feasibleSlots});
    return {state,agent:'s01',request:{
      requestMeta,
      referral:{referralId:proposal.referral.id,imo:state.imo,
        riskLevel:proposal.input?.sourceLevel||null,
        portId:proposal.input?.portId||null,regime:proposal.input?.regime||null},
      vesselNeeds:{vesselType:proposal.input?.vesselType||null,
        earliestLocal:proposal.input?.earliestLocal||null,
        deadlineLocal:proposal.input?.deadlineLocal||null,
        durationMinutes:proposal.input?.durationMinutes||null},
      currentSnapshot:{erpSnapshotId:proposal.erpSnapshotId,
        policyRevision:proposal.policyRevision,slotSetHash},
      feasibleSlots},allowedEvidence:known([proposal.erpSnapshotId,
        proposal.referral.id]),proposal};
  }
  if(agentCode==='SI-V01'){
    if(!media||media.caseId!==state.caseId||!media.bytes||!media.evidenceId||
       !media.checklistItemId||!media.sha256||!media.mimeType)
      error('SI_V01_CASE_OWNED_MEDIA_REQUIRED',409);
    return {state,agent:'v01',request:{requestMeta,
      inspectionCaseId:state.caseId,caseVersion:state.caseVersion,imo:state.imo,
      checklistItemId:media.checklistItemId,checklistVersion:media.checklistVersion||null,
      evidence:{evidenceId:media.evidenceId,mimeType:media.mimeType,sha256:media.sha256,
        scanStatus:'CHECKLIST_VERIFIED_LOCAL_POC',
        captureTimeUtc:media.captureTimeUtc||null},
      inspectorObservation:string(media.observation||'',500),
      context:{baseCheckMandatory:Boolean(media.baseCheckMandatory)}},
      media,allowedEvidence:known([media.evidenceId])};
  }
  if(agentCode==='SI-R01'){
    const confirmed=(r?.findings||[]).filter(f=>f.status==='CONFIRMED_BY_INSPECTOR');
    if(!confirmed.length||confirmed.some(f=>!f.id||!f.checkId||
       (f.severity!=='MINOR'&&!(f.evidenceRefs||[]).length)))
      error('SI_R01_CONFIRMED_FINDINGS_REQUIRED',409);
    const confirmedChecks=confirmed.map(f=>({
      checkId:f.checkId,status:'DEFICIENCY',severity:f.severity,
      note:string(f.description,1200),findingId:f.id,
      evidenceRefs:(f.evidenceRefs||[]).slice(0,12),inspectorConfirmed:true}));
    return {state,agent:'r01',request:{requestMeta,inspectionCaseId:state.caseId,
      caseVersion:state.caseVersion,imo:state.imo,
      confirmedChecks,casePolicyRef:view.preparation?.provenance||null,
      requestedOutputs:['REPORT_SUMMARY','CORRECTIVE_ACTION_DRAFT','NMC_RETURN_SUMMARY']},
      allowedEvidence:refsFrom(view),confirmedFindings:known(confirmed.map(f=>f.id))};
  }
  // X01: current and historical findings must be real saved, DISTINCT cases.
  // Missing certificate/conflict evidence is passed as UNKNOWN/[] (never invented).
  const current=(r?.findings||[]).filter(f=>f.status==='CONFIRMED_BY_INSPECTOR');
  const verifiedHistory=history.filter(h=>h.caseId&&h.caseId!==state.caseId&&
    h.imo===state.imo&&h.status==='CONFIRMED_BY_INSPECTOR')
    .slice(0,40);
  const allRefs=known([...refsFrom(view),...verifiedHistory.flatMap(h=>h.evidenceRefs||[])]);
  return {state,agent:'x01',request:{requestMeta,imo:state.imo,
    inspectionCaseId:state.caseId,
    currentFindings:current.map(f=>({checkId:f.checkId,
      status:f.status,evidenceRefs:f.evidenceRefs||[]})),
    historicalFindings:verifiedHistory.map(h=>({inspectionCaseId:h.caseId,
      checkId:h.checkId,status:'CONFIRMED_BY_INSPECTOR',
      evidenceRefs:h.evidenceRefs||[]})),
    certificateEvidence:[],evidenceConflicts:[],
    publishedRules:{certificateWarningDays:null},
    missingSources:['CERTIFICATE_EVIDENCE_UNAVAILABLE','VERIFIED_CONFLICT_EVIDENCE_UNAVAILABLE']},
    allowedEvidence:allRefs,verifiedHistory,current};
}
export function validateSiAiriaReply(agentCode,raw,ctx){
  const o=response(raw),state=ctx.state,refs=ctx.allowedEvidence;
  if(agentCode==='SI-S01'){
    const src=ctx.proposal,slots=new Set(src.options.map(o=>o.optionId));
    if(o.bookingConfirmed!==false||o.slotSetHash!==ctx.request.currentSnapshot.slotSetHash||
       !Array.isArray(o.rankedOptions)||o.rankedOptions.length>3)
      error('SI_S01_AIRIA_CONTRACT_INVALID',502);
    const ranked=o.rankedOptions,ids=new Set(),ranks=new Set();
    for(const row of ranked){
      if(!slots.has(row.optionId)||ids.has(row.optionId)||
         !Number.isInteger(row.rank)||row.rank<1||row.rank>src.options.length||
         ranks.has(row.rank)||!Number.isFinite(row.confidence)||
         row.confidence<0||row.confidence>1||!string(row.rationale,1400).trim())
        error('SI_S01_AIRIA_CONTRACT_INVALID',502);
      ids.add(row.optionId);ranks.add(row.rank);
      checkRefs(row.evidenceRefs||[],refs);
    }
    return {advice:ranked.map(row=>advice('SLOT_RANK_'+row.rank,
      'Eligible option: '+row.optionId,row.rationale,row.evidenceRefs||[])),
      draft:null};
  }
  if(agentCode==='SI-V01'){
    if(o.officialFindingCreated!==false||o.requiresInspectorConfirmation!==true||
       o.inspectionCaseId!==state.caseId||
       o.evidenceId!==ctx.media.evidenceId||
       o.checklistItemId!==ctx.media.checklistItemId||
       !Number.isFinite(o.confidence)||o.confidence<0||o.confidence>1||
       !o.candidateFinding||typeof o.candidateFinding!=='object')
      error('SI_V01_AIRIA_CONTRACT_INVALID',502);
    const finding=o.candidateFinding;
    return {advice:[advice('FIELD_IMAGE_'+string(o.suggestion,70),
      'Candidate visual observation — inspector must verify',
      [string(finding.reason,650),...(finding.visibleFacts||[]),
        ...(finding.limitations||[])].map(x=>string(x,320)).join(' | '),
      [ctx.media.evidenceId])],draft:null};
  }
  if(agentCode==='SI-R01'){
    if(o.inspectionCaseId!==state.caseId||
       o.sourceCaseVersion!==state.caseVersion||
       o.requiresSupervisorApproval!==true||
       o.officialRiskScore!=null||
       !string(o.summary,1700)||!Array.isArray(o.findings)||
       !Array.isArray(o.correctiveActionDrafts))
      error('SI_R01_AIRIA_CONTRACT_INVALID',502);
    const all=[...o.findings,...o.correctiveActionDrafts];
    for(const row of all){
      if(!ctx.confirmedFindings.has(row.findingId))error('SI_R01_UNCONFIRMED_FINDING_IN_OUTPUT',502);
      checkRefs(row.evidenceRefs||[],refs);
    }
    const draft={status:'DRAFT_FOR_INSPECTOR_REVIEW',
      title:'Airia report and corrective-action proposal',summary:string(o.summary,1700),
      findingRefs:o.findings.map(f=>({findingId:f.findingId,
        description:string(f.summary,1000),evidenceRefs:f.evidenceRefs||[]})),
      correctiveActionDrafts:o.correctiveActionDrafts.map(x=>({
        findingId:x.findingId,text:string(x.text,1100),
        evidenceRefs:x.evidenceRefs||[],requiresSupervisorInput:true})),
      evidenceRefs:[...refs],aiGenerated:true,autoIssued:false};
    return {advice:[advice('REPORT_DRAFT_FOR_HUMAN_REVIEW',
       'Review generated report and CAPA against confirmed findings',
       string(o.nmcReturnSummary,800),[...refs])],draft};
  }
  if(agentCode==='SI-X01'){
    if(o.requiresHumanReview!==true||o.conflictAutomaticallyResolved!==false||
      !Array.isArray(o.flags)||!Array.isArray(o.recommendedVerification))
      error('SI_X01_AIRIA_CONTRACT_INVALID',502);
    const repeated=ctx.verifiedHistory.some(h=>ctx.current.some(c=>c.checkId===h.checkId));
    const safeFlags=[];
    for(const flag of o.flags){
      if(typeof flag.code!=='string'||!Array.isArray(flag.evidenceRefs))
        error('SI_X01_AIRIA_CONTRACT_INVALID',502);
      checkRefs(flag.evidenceRefs,refs);
      if(flag.code==='RECURRING_DEFICIENCY'&&!repeated||
        flag.code==='CERTIFICATE_NEAR_EXPIRY'||
        flag.code==='SOURCE_CONFLICT_UNRESOLVED')
        error('SI_X01_UNVERIFIED_FLAG_REJECTED',502);
      safeFlags.push(advice(string(flag.code,90),
        'Review supported inspection exception',
        string(flag.reason,900)||'Verify matched saved inspection evidence.',
        flag.evidenceRefs,string(flag.severity,40)||'REVIEW_REQUIRED'));
    }
    if(!safeFlags.length)safeFlags.push(advice('NO_VERIFIED_EXCEPTION',
      'No evidence-backed exception identified',
      'Missing certificate and conflict sources remain unknown; human review required.'));
    return {advice:safeFlags,draft:null};
  }
  error('SI_AIRIA_AGENT_UNKNOWN');
}
export async function runSiAiriaAdvisor({agentCode,caseId,scenario=null},view,{
  executeAgent,executeVision=null,proposal=null,history=[],media=null,actor='MOEI_OPERATOR'}={}){
  if(!codes[agentCode]||caseId!==view?.inspectionCase?.id)
    error('SI_AIRIA_ADVISOR_INPUT_INVALID');
  if(scenario!==null)error('SI_AIRIA_SYNTHETIC_SCENARIO_NOT_ALLOWED',422);
  const ctx=buildSiAiriaRequest(agentCode,view,{proposal,history,media,actor});
  let result;
  try{
    result=agentCode==='SI-V01'
      ?await executeVision(ctx.request,ctx.media)
      :await executeAgent(ctx.agent,ctx.request);
  }catch{
    error('SI_AIRIA_PROVIDER_UNAVAILABLE',502);
  }
  const sanitized=validateSiAiriaReply(agentCode,result,ctx);
  return {status:'AIRIA_ADVISORY_REVIEW_REQUIRED',
    schemaVersion:'MOEI-SI-AIRIA-v1-CONTRACT-PILOT',
    agentCode,provider:'AIRIA',simulationLabel:null,scenario:null,
    snapshot:ctx.state,advice:sanitized.advice,draft:sanitized.draft,
    externalCalls:1,caseMutations:0,regulatoryDecision:false,
    humanApprovalRequired:true,
    warning:'Airia advisory only. No case, scheduling, report or statutory decision was written. Validate actual provider JSON contract before deployment.'};
}
