/**
 * SI-C01 Candidate Selection: same request/response with MOCK or future Airia.
 * The backend is the ONLY source of candidate keys, quotas, rules and risk.
 * Strictly read-only advice, NEVER approves/creates/updates inspections.
 */
import {createHash,randomUUID} from 'node:crypto';
import {mockSiC01,SI_MOCK_MARKER} from './si-agent-mock.mjs';
import {getSiRankingPolicy,inspectionRanking} from './si-inspection-ranking.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.trim()))];
const ADVICE=new Set(['SELECT_RECOMMENDED','DEFER_RECOMMENDED','MANUAL_REVIEW']);
export class SiCandidateAgentError extends Error{
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export function buildC01Source(dashboard,pscPolicy=null){
  if(!dashboard?.policy||!Array.isArray(dashboard.candidates))
    throw new SiCandidateAgentError('SI_C01_SOURCE_UNAVAILABLE',503);
  const ranking=getSiRankingPolicy(dashboard.policy.config);
  const vesselSignals=new Map((dashboard.vesselCandidates||[]).map(v=>[v.imo,v]));
  const candidates=dashboard.candidates
    .filter(c=>!c.inspectionCase&&(
      c.status==='PENDING_REVIEW'||
      (c.status==='EXTERNALLY_SCHEDULED'&&
        c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'))))
    .map(c=>{
      const vessel=vesselSignals.get(c.imo)||{};
      // Forward the saved source fields needed for a grounded recommendation.
      // No invented ETD, incident severity or alternate vessel risk is allowed.
      const departureAt=vessel.departureVerified===true?vessel.departureAt:null;
      const incidentSeverity=vessel.incidentHumanReviewed===true?vessel.incidentSeverity:null;
      const rankingDecision=inspectionRanking({
        departureAt,departureVerified:vessel.departureVerified===true,
        incidentSeverity,incidentHumanReviewed:vessel.incidentHumanReviewed===true});
      const missingData=[
        ...(!departureAt?[vessel.departureStatus==='CONFLICT'?
          'CONFLICTING_VERIFIED_ETD':'VERIFIED_ETD_UNAVAILABLE']:[]),
        ...(!Number.isFinite(incidentSeverity)?['HUMAN_REVIEWED_INCIDENT_SEVERITY_UNAVAILABLE']:[]),
        ...(!c.currentRisk?['SAVED_NMC_VESSEL_RISK_UNAVAILABLE_INFORMATIONAL_ONLY']:[])
      ];
      const operationalSourceEvents=(vessel.operationalSourceEvents||[])
        .map(e=>({
          sourceType:e.sourceType,eventKey:e.eventKey,
          sourceEventId:e.sourceEventId,sourceReference:e.sourceReference,
          provenance:e.provenance,approval:e.approval,
          port:e.port||null,eta:e.eta||null,
          departureAt:e.departureAt||null,
          departureVerified:e.departureVerified===true,
          departureAuthority:e.departureAuthority||null,
          evidenceIds:e.evidenceIds||[],
          importFile:e.importFile||null,importBatchId:e.importBatchId||null,
          importExcelRow:e.importExcelRow||null
        }));
      const allowedEvidence=unique([...c.events,...operationalSourceEvents]
        .flatMap(e=>[e.eventKey,e.sourceEventId,
          e.sourceReference,...(e.evidenceIds||[])]));
      return {candidateKey:c.key,imo:c.imo,regime:c.regime,
        vesselName:c.vesselName,eligibility:c.eligibility,
        currentRisk:c.currentRisk||null,
        sourceTypes:unique(c.events.map(e=>e.sourceType)),
        sourceEvents:c.events.map(e=>({
          sourceType:e.sourceType,eventKey:e.eventKey,
          sourceEventId:e.sourceEventId,sourceReference:e.sourceReference,
          provenance:e.provenance,approval:e.approval,
          evidenceIds:e.evidenceIds||[],
          port:e.port||null,eta:e.eta||null,
          reportedDepartureLocal:e.reportedDepartureLocal||null,
          departureAt:e.departureAt||null,
          departureVerified:e.departureVerified===true,
          departureAuthority:e.departureAuthority||null,
          contextNote:e.contextNote||null,
          importFile:e.importFile||null,importBatchId:e.importBatchId||null,
          importExcelRow:e.importExcelRow||null
        })),
        // Operational MSW records may explain an ETD without separately
        // making a PSC port call an approved inspection candidate.
        operationalSourceEvents,
        allowedEvidence,reasons:c.reasons||[],rulePriority:c.priority,
        departureAt,departureVerified:vessel.departureVerified===true,
        departureStatus:vessel.departureStatus||(!departureAt?'MISSING':'VERIFIED'),
        incidentSeverity,incidentHumanReviewed:vessel.incidentHumanReviewed===true,
        incidentEvidenceRef:vessel.incidentEvidenceRef||null,
        rankingContext:{criterion:rankingDecision.criterion,
          reason:rankingDecision.reason,
          source:'DETERMINISTIC_BUSINESS_RULE',policyOrder:ranking.criteria,
          departureEvidenceRefs:departureAt?unique(operationalSourceEvents
            .filter(e=>e.departureAt&&
              Date.parse(e.departureAt)===Date.parse(departureAt))
            .flatMap(e=>[e.eventKey,e.sourceReference,...e.evidenceIds])):[]},
        missingData,
        requiredInPlan:c.events.some(e=>e.sourceType==='SERVICE_REQUEST'||
          (e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'))};
    }).sort((a,b)=>a.candidateKey.localeCompare(b.candidateKey));
  const source={schemaVersion:'SI-C01-v1',
    ranking,
    policyRevision:dashboard.policy.version,
    riskPolicyRevision:dashboard.riskPolicyRevision,
    pscQuotaPolicyRevision:pscPolicy?.version??null,
    pscQuotaSnapshot:pscPolicy?.quotaSnapshot||null,
    fleetSnapshotId:dashboard.fleetSnapshotId,
    candidates};
  return {...source,snapshotHash:hash(source)};
}
/**
 * No-cost/read-only preflight for the EXACT current C01 source snapshot.
 * Count physical vessels, not duplicate regimes/source events. Missing ETD,
 * saved risk or reviewed incidents are DATA GAPS, never fabricated values.
 * This does not call Airia or override any candidate eligibility rule.
 */
export function summarizeC01Readiness(source){
  const candidates=Array.isArray(source?.candidates)?source.candidates:[];
  const byImo=new Map();
  for(const c of candidates){
    if(!c||typeof c.imo!=='string')continue;
    const summary=byImo.get(c.imo)||{
      hasVerifiedEtd:false,hasReviewedIncident:false,hasSavedRisk:false,
      hasEvidence:false,hasEtdConflict:false,regimes:new Set()
    };
    const rule=inspectionRanking(c);
    summary.hasVerifiedEtd ||= rule.criterion==='DEPARTURE_SOON';
    summary.hasReviewedIncident ||= c.incidentHumanReviewed===true&&
      Number.isFinite(c.incidentSeverity)&&c.incidentSeverity>=0&&
      c.incidentSeverity<=100;
    summary.hasSavedRisk ||= Number.isFinite(c.currentRisk?.score);
    summary.hasEvidence ||= Array.isArray(c.allowedEvidence)&&
      c.allowedEvidence.length>0;
    summary.hasEtdConflict ||= c.departureStatus==='CONFLICT';
    if(typeof c.regime==='string')summary.regimes.add(c.regime);
    byImo.set(c.imo,summary);
  }
  const vessels=[...byImo.values()];
  const count=fn=>vessels.filter(fn).length;
  const vesselCount=vessels.length;
  const confirmedEtdVessels=count(v=>v.hasVerifiedEtd);
  const incidentReviewedVessels=count(v=>v.hasReviewedIncident);
  const riskAssessedVessels=count(v=>v.hasSavedRisk);
  const evidenceBackedVessels=count(v=>v.hasEvidence);
  const conflictingEtdVessels=count(v=>v.hasEtdConflict);
  const withoutExecutionSignalVessels=count(v=>!v.hasVerifiedEtd&&!v.hasReviewedIncident);
  const eligibleWorkflows=candidates.length;
  const status=eligibleWorkflows===0?'NO_CANDIDATES':
    eligibleWorkflows>100?'SCOPE_LIMIT':
    conflictingEtdVessels>0||evidenceBackedVessels<vesselCount?
      'REVIEW_RECOMMENDED':
      confirmedEtdVessels<vesselCount||riskAssessedVessels<vesselCount||
      incidentReviewedVessels<vesselCount?'READY_WITH_GAPS':'READY';
  return {
    schemaVersion:'SI_C01_READINESS_V1',status,
    sourceSnapshotHash:source?.snapshotHash||null,
    currentSourceOnly:true,externalAiCalls:0,
    eligibleWorkflows,eligibleVessels:vesselCount,
    confirmedEtdVessels,missingConfirmedEtdVessels:vesselCount-confirmedEtdVessels,
    conflictingEtdVessels,incidentReviewedVessels,
    riskAssessedVessels,evidenceBackedVessels,
    withoutExecutionSignalVessels,
    selectionRequiresOfficerApproval:true,
    etDAndIncidentRankingOnly:true,
    notes:'Only actually saved, verified source data are counted. Missing ETD / incident severity remain explicit gaps; no inferred time or risk score is created.'
  };
}
/**
 * Airia PipelineExecution returns an envelope with a result property.
 * The SDK documents result as the execution output, which can be an encoded
 * JSON STRING even while the HTTP response itself is valid JSON.
 * Decode ONLY that documented envelope, never repair/model-complete missing
 * recommendations. Keep every existing regulatory/evidence gate unchanged.
 */
export function unwrapC01AiriaResult(raw){
 let body=raw;
 for(let i=0;i<3;i++){
  if(typeof body==='string'){
   if(body.length>2*1024*1024)return null;
   try{body=JSON.parse(body);}catch{return null;}
   continue;
  }
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  if(Array.isArray(body.recommendations))return body;
  if(!Object.hasOwn(body,'result'))return null;
  body=body.result;
 }
 return body&&typeof body==='object'&&
   !Array.isArray(body)&&Array.isArray(body.recommendations)?body:null;
}
/**
 * Diagnose the FIRST mismatched contract field in a provider recommendation.
 * Only hardcoded reason names escape this function. Never pass upstream text
 * or source identifiers into production logs or HTTP error details.
 *
 * A C01 response must cite existing candidate evidence for every suggestion;
 * diagnosis does NOT coerce types, invent missing fields, or downgrade checks.
 */
export function c01RecommendationContractFailure(r,c,seen=new Set()){
 if(!r||typeof r!=='object'||Array.isArray(r))return 'RECOMMENDATION_ITEM_SHAPE';
 if(!c)return 'CANDIDATE_KEY_UNKNOWN_OR_MISSING';
 if(seen.has(r.candidateKey))return 'CANDIDATE_KEY_DUPLICATE';
 if(!ADVICE.has(r.recommendation))return 'RECOMMENDATION_ENUM_INVALID';
 if(!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1)
  return 'CONFIDENCE_INVALID_NUMBER_OR_RANGE_0_TO_1';
 if(typeof r.reason!=='string'||r.reason.trim().length<10||r.reason.length>1500)
  return 'REASON_MISSING_OR_INVALID_LENGTH';
 // Priority wording is presentation, not a risk score, selection authority or
 // evidence check. The platform can explain its own deterministic ranking if
 // the provider omits prose; all other model/evidence checks remain strict.
 if(r.recommendation==='SELECT_RECOMMENDED'){
  if(!Number.isInteger(r.suggestedRank)||r.suggestedRank<1||r.suggestedRank>100)
   return 'SELECTED_SUGGESTED_RANK_INVALID';
 }else if(r.suggestedRank!==null)return 'NON_SELECTED_RANK_MUST_BE_NULL';
 if(!Array.isArray(r.evidenceRefs)||r.evidenceRefs.length>20)
  return 'EVIDENCE_REFS_MISSING_OR_TOO_MANY';
 if(r.evidenceRefs.some(e=>!c.allowedEvidence.includes(e)))
  return 'EVIDENCE_REF_NOT_IN_SOURCE';
 if(!Array.isArray(r.dataGaps)||r.dataGaps.length>20)
  return 'DATA_GAPS_MISSING_OR_TOO_MANY';
 if(r.dataGaps.some(g=>typeof g!=='string'||g.length>120))
  return 'DATA_GAP_ENTRY_INVALID';
 return null;
}
export function validateC01(raw,source){
  const body=unwrapC01AiriaResult(raw);
  if(!body||body.recommendations.length!==source.candidates.length){
    // Do NOT print upstream text, candidate identifiers or evidence to logs.
    // Record only the shape and counts needed to diagnose Airia integration.
    const shape=raw===null?'null':Array.isArray(raw)?'array':typeof raw;
    const resultShape=raw&&typeof raw==='object'&&
      !Array.isArray(raw)&&Object.hasOwn(raw,'result')?
      (Array.isArray(raw.result)?'array':typeof raw.result):'absent';
    const actual=Array.isArray(body?.recommendations)?
      body.recommendations.length:'missing';
    console.warn('[si-c01] RESPONSE_CONTRACT_MISMATCH top='+shape+
      ' result='+resultShape+' recommendations='+actual+
      ' expected='+source.candidates.length);
    throw new SiCandidateAgentError('SI_C01_RESPONSE_INVALID',502);
  }
  const known=new Map(source.candidates.map(x=>[x.candidateKey,x])),seen=new Set();
  return body.recommendations.map((r,index)=>{
    const c=known.get(r?.candidateKey);
    const failure=c01RecommendationContractFailure(r,c,seen);
    if(failure){
      // This is a STATIC enum, never content supplied by Airia. Do not log
      // candidateKey, IMO, evidence references, raw provider payload or keys.
      console.warn('[si-c01] RECOMMENDATION_CONTRACT_REJECTED field='+failure+
        ' itemIndex='+index+' total='+body.recommendations.length);
      const error=new SiCandidateAgentError('SI_C01_UNVERIFIED_RECOMMENDATION',502);
      error.diagnosticCode=failure;
      throw error;
    }
    // Business-gated recommendation: a model cannot silently select unapproved
    // PSC/service candidates or candidates with missing verified risk.
    if(r.recommendation==='SELECT_RECOMMENDED'&&
      (!r.evidenceRefs.length||!c.sourceTypes.length))
      throw new SiCandidateAgentError('SI_C01_HARD_RULE_OVERRIDE',502);
    seen.add(r.candidateKey);
    const hasAiRationale=typeof r.priorityRationale==='string'&&
      r.priorityRationale.trim().length>=12&&r.priorityRationale.length<=1500;
    const signal=inspectionRanking(c);
    const priorityRationale=hasAiRationale?r.priorityRationale.trim():
      'Platform business-rule explanation ('+signal.criterion+'): '+
      signal.reason+'. The AI did not provide usable priority wording; '+
      'official execution order remains deterministic and officer-reviewed.';
    return {candidateKey:c.candidateKey,imo:c.imo,regime:c.regime,
      recommendation:r.recommendation,confidence:r.confidence,
      suggestedRank:r.suggestedRank,priorityRationale,
      priorityRationaleSource:hasAiRationale?'AGENT_OUTPUT':'DETERMINISTIC_BUSINESS_RULE',
      reason:r.reason.trim(),evidenceRefs:unique(r.evidenceRefs),
      dataGaps:unique([...r.dataGaps,...(c.missingData||[])]),requiresHumanReview:true,
      regulatoryDecision:false};
  });
}
export class SiCandidateAgent{
 constructor({targeting,pscPolicy=null,executeAgent=null,provider='mock'}={}){
  if(!targeting||!['mock','airia'].includes(provider))
    throw new Error('SI_C01_CONFIGURATION_INVALID');
  this.targeting=targeting;this.pscPolicy=pscPolicy;
  this.executeAgent=executeAgent||mockSiC01;this.provider=provider;
  this.inProgress=false;this.latest=null;
 }
 async source(){
  const dashboard=await this.targeting.dashboard();
  const policy=this.pscPolicy?await this.pscPolicy():null;
  return buildC01Source(dashboard,policy);
 }
 async preview(){
  const s=await this.source();
  return {status:'PREVIEW_ONLY_NO_AI',provider:this.provider.toUpperCase(),
   snapshotHash:s.snapshotHash,policyRevision:s.policyRevision,
   pscQuotaPolicyRevision:s.pscQuotaPolicyRevision,
   riskPolicyRevision:s.riskPolicyRevision,eligibleCount:s.candidates.length,
   expectedBatches:Math.ceil(s.candidates.length/100),
   estimatedAiriaCalls:this.provider==='airia'?Math.ceil(s.candidates.length/100):0,
   candidates:s.candidates,externalCalls:0,
   latest:this.latest?{
     agentRunId:this.latest.agentRunId,
     isStale:this.latest.snapshotHash!==s.snapshotHash,
     provider:this.latest.provider}:null};
 }
 async run(input={}){
  if(this.inProgress)throw new SiCandidateAgentError('SI_C01_IN_PROGRESS',409);
  if(input.confirmRun!==true||(this.provider==='airia'&&input.confirmCost!==true)||typeof input.actor!=='string'||
     !input.actor.trim()||input.actor.length>120||
     !/^[a-f0-9]{64}$/i.test(input.expectedSnapshotHash||''))
    throw new SiCandidateAgentError('SI_C01_CONFIRMATION_REQUIRED',422);
  this.inProgress=true;
  try{
   const s=await this.source();
   if(s.snapshotHash!==input.expectedSnapshotHash)
    throw new SiCandidateAgentError('SI_C01_SOURCE_CHANGED_REPREVIEW',409);
   if(!s.candidates.length)
    throw new SiCandidateAgentError('SI_C01_NO_PENDING_CANDIDATES',422);
   // A full 99-vessel fleet can have >100 *regime* candidates after Excel
   // rules activate. Explicitly consent to the REAL number of Airia calls.
   // Keep bounded batches; never truncate inputs or silently run extra calls.
   const batchSize=100,batchCount=Math.ceil(s.candidates.length/batchSize);
   if(s.candidates.length>500)
    throw new SiCandidateAgentError('SI_C01_BATCH_LIMIT_500_SCOPE_REQUIRED',422);
   if(batchCount>1&&input.confirmBatchCount!==batchCount)
    throw new SiCandidateAgentError('SI_C01_BATCH_COUNT_CONFIRMATION_REQUIRED',422);
   const officerPlanChanges=Array.isArray(input.officerPlanChanges)?
     input.officerPlanChanges.filter(x=>
       /^[0-9]{7}$/.test(x?.imo||'')&&
       s.candidates.some(c=>c.imo===x.imo)&&
       typeof x.reason==='string'&&x.reason.length>=8&&
       typeof x.selected==='boolean'&&
       (x.requestedRank===null||
        (Number.isInteger(x.requestedRank)&&x.requestedRank>=1&&x.requestedRank<=100)))
       .slice(0,100):[];
   const payload={schemaVersion:'SI-C01-v1',
     requestMeta:{correlationId:'SI-C01-'+randomUUID(),actor:input.actor.trim(),
       language:'en',mode:'ADVISORY_ONLY'},
     snapshotHash:s.snapshotHash,policyRevision:s.policyRevision,
     ranking:s.ranking,
     analysisInstructions:{
       selectionIsAdvisory:true,
       officialExecutionOrder:'Verified future ETD ascending; then human-reviewed active incident severity descending; otherwise pending additional rules.',
       vesselRiskDoesNotSetExecutionRank:true,
       citeOnlyAllowedEvidence:true,
       includeReasonAndPriorityRationale:true,
       doNotInventMissingSignals:true,
       approvalAndSchedulingRequireOfficer:true
     },
     officerPlanChanges,
     riskPolicyRevision:s.riskPolicyRevision,
     pscQuotaPolicyRevision:s.pscQuotaPolicyRevision,
     // Rules constrain PSC event eligibility; AI ranks/advises only on the
     // permitted shortlist, never overrides the quota or officer approval.
     pscQuotaSnapshot:s.pscQuotaSnapshot,
     candidates:s.candidates};
   // Every batch is validated against its own permitted candidate/evidence
   // subset. No partial result is returned or persisted if ANY batch fails.
   // `suggestedRank` is local to each batch; statutory execution order is
   // independently calculated by the deterministic inspection ranking engine.
   const recommendations=[];
   for(let i=0;i<batchCount;i++){
     const subset=s.candidates.slice(i*batchSize,(i+1)*batchSize);
     const batch={...payload,
       requestMeta:{...payload.requestMeta,batchIndex:i+1,batchCount},
       candidates:subset};
     const scope={...s,candidates:subset};
     let raw;
     try{raw=await this.executeAgent(batch);}
     catch{throw new SiCandidateAgentError('SI_C01_PROVIDER_UNAVAILABLE',502);}
     recommendations.push(...validateC01(raw,scope));
   }
   const result={status:'ADVISORY_REVIEW_REQUIRED',agentCode:'SI-C01',
     agentRunId:randomUUID(),provider:this.provider.toUpperCase(),
     mock:this.provider==='mock',simulationLabel:this.provider==='mock'?SI_MOCK_MARKER:null,
     snapshotHash:s.snapshotHash,policyRevision:s.policyRevision,
     riskPolicyRevision:s.riskPolicyRevision,actor:input.actor.trim(),
     generatedAt:new Date().toISOString(),
     externalCalls:this.provider==='mock'?0:batchCount,
     batchesValidated:batchCount,candidatesAnalyzed:recommendations.length,
     humanDecisionRequired:true,mutations:false,
     warning:this.provider==='mock'?
       'STATIC TEST LOGIC ONLY: NO AIRIA CALL; NO REAL MODEL ANALYSIS OR APPROVAL.':
       'Advisory only. Supervisor decision must be separately approved.',
     recommendations};
   this.latest=result;return result;
  }finally{this.inProgress=false;}
 }
}
