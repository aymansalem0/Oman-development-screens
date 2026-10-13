/**
 * SI-C01 Candidate Selection: same request/response with MOCK or future Airia.
 * The backend is the ONLY source of candidate keys, quotas, rules and risk.
 * Strictly read-only advice, NEVER approves/creates/updates inspections.
 */
import {createHash,randomUUID} from 'node:crypto';
import {mockSiC01,SI_MOCK_MARKER} from './si-agent-mock.mjs';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.trim()))];
const ADVICE=new Set(['SELECT_RECOMMENDED','DEFER_RECOMMENDED','MANUAL_REVIEW']);
export class SiCandidateAgentError extends Error{
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export function buildC01Source(dashboard,pscPolicy=null){
  if(!dashboard?.policy||!Array.isArray(dashboard.candidates))
    throw new SiCandidateAgentError('SI_C01_SOURCE_UNAVAILABLE',503);
  const candidates=dashboard.candidates
    .filter(c=>!c.inspectionCase&&(
      c.status==='PENDING_REVIEW'||
      (c.status==='EXTERNALLY_SCHEDULED'&&
        c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'))))
    .map(c=>{
      const allowedEvidence=unique(c.events.flatMap(e=>[
        e.eventKey,e.sourceEventId,e.sourceReference,...(e.evidenceIds||[])]));
      return {candidateKey:c.key,imo:c.imo,regime:c.regime,
        vesselName:c.vesselName,eligibility:c.eligibility,
        currentRisk:c.currentRisk||null,
        sourceTypes:unique(c.events.map(e=>e.sourceType)),
        sourceEvents:c.events.map(e=>({
          sourceType:e.sourceType,eventKey:e.eventKey,
          sourceReference:e.sourceReference,approval:e.approval,
          evidenceIds:e.evidenceIds||[]
        })),
        allowedEvidence,reasons:c.reasons||[],rulePriority:c.priority};
    }).sort((a,b)=>a.candidateKey.localeCompare(b.candidateKey));
  const source={schemaVersion:'SI-C01-v1',
    selectionRiskThreshold:Number.isInteger(dashboard.policy.config?.riskPriorityThreshold)?
      dashboard.policy.config.riskPriorityThreshold:65,
    policyRevision:dashboard.policy.version,
    riskPolicyRevision:dashboard.riskPolicyRevision,
    pscQuotaPolicyRevision:pscPolicy?.version??null,
    fleetSnapshotId:dashboard.fleetSnapshotId,
    candidates};
  return {...source,snapshotHash:hash(source)};
}
export function validateC01(raw,source){
  const body=raw?.recommendations?raw:raw?.result?.recommendations?raw.result:null;
  if(!body||!Array.isArray(body.recommendations)||
    body.recommendations.length!==source.candidates.length)
    throw new SiCandidateAgentError('SI_C01_RESPONSE_INVALID',502);
  const known=new Map(source.candidates.map(x=>[x.candidateKey,x])),seen=new Set();
  return body.recommendations.map(r=>{
    const c=known.get(r?.candidateKey);
    if(!c||seen.has(r.candidateKey)||!ADVICE.has(r.recommendation)||
       !Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1||
       typeof r.reason!=='string'||r.reason.trim().length<10||r.reason.length>1500||
       typeof r.priorityRationale!=='string'||r.priorityRationale.length<12||
       r.priorityRationale.length>1500||
       (r.recommendation==='SELECT_RECOMMENDED'?
         (!Number.isInteger(r.suggestedRank)||r.suggestedRank<1||r.suggestedRank>100):
         r.suggestedRank!==null)||
       !Array.isArray(r.evidenceRefs)||r.evidenceRefs.length>20||
       r.evidenceRefs.some(e=>!c.allowedEvidence.includes(e))||
       !Array.isArray(r.dataGaps)||r.dataGaps.length>20||
       r.dataGaps.some(g=>typeof g!=='string'||g.length>120))
       throw new SiCandidateAgentError('SI_C01_UNVERIFIED_RECOMMENDATION',502);
    // Business-gated recommendation: a model cannot silently select unapproved
    // PSC/service candidates or candidates with missing verified risk.
    if(r.recommendation==='SELECT_RECOMMENDED'&&
      (!c.currentRisk||!Number.isFinite(c.currentRisk.score)||
       !r.evidenceRefs.length||!c.sourceTypes.length))
      throw new SiCandidateAgentError('SI_C01_HARD_RULE_OVERRIDE',502);
    seen.add(r.candidateKey);
    return {candidateKey:c.candidateKey,imo:c.imo,regime:c.regime,
      recommendation:r.recommendation,confidence:r.confidence,
      suggestedRank:r.suggestedRank,priorityRationale:r.priorityRationale,
      reason:r.reason.trim(),evidenceRefs:unique(r.evidenceRefs),
      dataGaps:unique(r.dataGaps),requiresHumanReview:true,
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
   if(s.candidates.length>100)
    throw new SiCandidateAgentError('SI_C01_LIMIT_100_SCOPE_REQUIRED',422);
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
     selectionRiskThreshold:s.selectionRiskThreshold,
     officerPlanChanges,
     riskPolicyRevision:s.riskPolicyRevision,
     pscQuotaPolicyRevision:s.pscQuotaPolicyRevision,
     candidates:s.candidates};
   let raw;
   try{raw=await this.executeAgent(payload);}
   catch{throw new SiCandidateAgentError('SI_C01_PROVIDER_UNAVAILABLE',502);}
   const recommendations=validateC01(raw,s);
   const result={status:'ADVISORY_REVIEW_REQUIRED',agentCode:'SI-C01',
     agentRunId:randomUUID(),provider:this.provider.toUpperCase(),
     mock:this.provider==='mock',simulationLabel:this.provider==='mock'?SI_MOCK_MARKER:null,
     snapshotHash:s.snapshotHash,policyRevision:s.policyRevision,
     riskPolicyRevision:s.riskPolicyRevision,actor:input.actor.trim(),
     generatedAt:new Date().toISOString(),externalCalls:this.provider==='mock'?0:1,
     humanDecisionRequired:true,mutations:false,
     warning:this.provider==='mock'?
       'STATIC TEST LOGIC ONLY: NO AIRIA CALL; NO REAL MODEL ANALYSIS OR APPROVAL.':
       'Advisory only. Supervisor decision must be separately approved.',
     recommendations};
   this.latest=result;return result;
  }finally{this.inProgress=false;}
 }
}
