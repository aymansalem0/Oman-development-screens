/**
 * Automatic SI supervisor-approved report -> NMC operational risk reassessment.
 * A01/A02 are evidence providers; the published NMC deterministic risk policy
 * calculates the score. This never approves an NMC regulatory action.
 * Crash safety: RUNNING on restart becomes INTERRUPTED; never automatically
 * repeat potentially billable provider calls after an unknown outcome.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {approvedFindingEvidence,verifiedFindingFactorAttribution,
 FIVE_NMC_RISK_FACTORS} from './si-risk-factor-attribution.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const stamp=()=>new Date().toISOString();
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const validImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const safeCode=e=>/^[A-Z][A-Z0-9_]{2,95}$/.test(String(e?.code||e?.message||''))?
 String(e.code||e.message):'SI_RISK_REASSESSMENT_UNAVAILABLE';
export class SiPostInspectionRiskError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export function approvedInspectionBundle(bundle,view){
 const report=view?.record?.report,caseRow=view?.inspectionCase;
 if(!bundle||!validImo(bundle.imo)||bundle.imo!==caseRow?.imo||
   !validId(caseRow.id)||!validId(report?.id)||
   report.status!=='APPROVED'||!report.supervisor)
  throw new SiPostInspectionRiskError('SI_RISK_APPROVED_REPORT_REQUIRED');
 const evidenceId='SI-REPORT-'+report.id;
 const findings=approvedFindingEvidence(report,view.record.findings||[]);
 const summary=String(report.summary||'').slice(0,1500);
 const source={evidenceId,inspectionId:caseRow.id,reportId:report.id,
   status:'SUPERVISOR_APPROVED',approvedAt:report.approvedAt||null,
   approvedBy:report.supervisor,summary,findings,
   aiGenerated:false,regulatoryDecision:false};
 const context=clone(bundle.inlineContext);
 context.approvedInspectionReports=[
   ...(Array.isArray(context.approvedInspectionReports)?
     context.approvedInspectionReports.filter(x=>x.inspectionId!==caseRow.id):[]),
   source
 ].slice(-20);
 // A01/A02 KEEP their existing 5-factor input/response contract. Each
 // confirmed defect has its own authorized evidence ID for AI citation.
 // Never infer a factor from severity or keyword; the AI must explicitly
 // cite the defect ID in the appropriate factor signal.
 context.inspectionFindings=[...(context.inspectionFindings||[]),{
   sourceEvidenceId:evidenceId,origin:'SI_HUMAN_APPROVED',findings
 }].slice(-20);
 context.postInspectionFactorAttribution={
   reportEvidenceId:evidenceId,
   requiredFindingEvidenceIds:findings.map(f=>f.evidenceId),
   factors:FIVE_NMC_RISK_FACTORS,
   instructions:[
    'Read every confirmed human-approved defect and its actual supporting evidence.',
    'For each of the FIVE existing risk signals, cite individual SI-FINDING evidenceIds ONLY when that defect is genuinely relevant.',
    'Inspection is equipment / safety / recorded inspection issues; certificate requires certificate-specific evidence.',
    'Movement requires independent vessel movement/navigation evidence; history requires real previous history.',
    'DataQuality requires documented inconsistent/missing facts, not simply an equipment defect.',
    'One defect may be relevant to multiple factors. Do not invent trends, documents, history, AIS observations, data gaps or risk scores.',
    'The risk engine scores the full five-factor assessment; retain ALL required baseline evidence citations.',
    'Every confirmed inspector defect must be cited by at least one appropriate factor, or no new risk score will be accepted.'
   ]
 };
 const existing=Array.isArray(context.deficiencies)?context.deficiencies:[];
 context.deficiencies=[...existing,...findings.map(f=>({
   id:f.findingId,description:f.finding,severity:
     f.severity==='CRITICAL'?'Critical':f.severity==='MAJOR'?'Major':'Minor',
   status:'Open',sourceEvidenceId:evidenceId
 }))];
 return {...bundle,inlineContext:context,
   evidenceIds:[...new Set([...bundle.evidenceIds,evidenceId,
     ...findings.map(f=>f.evidenceId)])],siFindingsForAttribution:findings};
}
export class SiPostInspectionRisk{
 constructor({fleet,getBundle,getRiskConfig,caseWorkspace,riskPolicy,getView,
   aiAvailable=()=>true,file=process.env.SI_RISK_REASSESSMENT_PATH||
   '/data/si-risk-reassessments.json'}={}){
  Object.assign(this,{fleet,getBundle,getRiskConfig,caseWorkspace,riskPolicy,
    getView,aiAvailable,file});
  this.active=new Set();
  this.records=this.load();
  for(const item of Object.values(this.records))if(item.status==='RUNNING'){
   item.status='INTERRUPTED_REVIEW_BEFORE_RETRY';
   item.updatedAt=stamp();
  }
  if(Object.values(this.records).some(x=>x.status==='INTERRUPTED_REVIEW_BEFORE_RETRY'))
   this.persist();
 }
 load(){
  if(!existsSync(this.file))return {};
  const doc=JSON.parse(readFileSync(this.file,'utf8'));
  if(doc?.schema!==1||!doc.records||typeof doc.records!=='object')
   throw new SiPostInspectionRiskError('SI_RISK_LEDGER_INVALID',503);
  return doc.records;
 }
 persist(){
  mkdirSync(dirname(this.file),{recursive:true});
  const tmp=this.file+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify({schema:1,records:this.records}),
    {mode:0o600});
  renameSync(tmp,this.file);
 }
 status(caseId){
  return Object.values(this.records).filter(x=>x.caseId===caseId)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(clone);
 }
 /**
  * Called only after supervisor approval and VERIFIED NMC routing.
  * Persist event before asynchronously calling billable A01/A02.
  */
 enqueue({caseId,imo,reportId,nmcCaseId}={}){
  if(![caseId,reportId,nmcCaseId].every(validId)||!validImo(imo))
   throw new SiPostInspectionRiskError('SI_RISK_FORWARD_SOURCE_INVALID');
  const eventId=caseId+':'+reportId;
  const existing=this.records[eventId];
  if(existing){
   if(existing.imo!==imo||existing.nmcCaseId!==nmcCaseId)
    throw new SiPostInspectionRiskError('SI_RISK_EVENT_CONFLICT');
   return clone(existing);
  }
  const row={eventId,caseId,imo,reportId,nmcCaseId,
    status:'QUEUED',createdAt:stamp(),updatedAt:stamp(),
    aiRequested:true,aiExecutionStatus:'QUEUED',regulatoryDecision:false,
    estimatedAiriaCalls:2};
  this.records[eventId]=row;this.persist();
  queueMicrotask(()=>void this.process(eventId));
  return clone(row);
 }
 async retry(eventId,{confirmCost=false}={}){
  const row=this.records[eventId];
  if(!row)throw new SiPostInspectionRiskError('SI_RISK_EVENT_NOT_FOUND',404);
  if(this.active.has(eventId)||row.status==='RUNNING')
   throw new SiPostInspectionRiskError('SI_RISK_ALREADY_RUNNING');
  if(row.status==='COMPLETED'||row.status==='QUEUED')
   return clone(row);
  const requiresAi=!row.result;
  if(requiresAi&&confirmCost!==true)
   throw new SiPostInspectionRiskError('SI_RISK_RETRY_AI_COST_CONFIRMATION_REQUIRED',422);
  row.status='QUEUED';row.errorCode=null;row.errorDetails=null;
  row.updatedAt=stamp();this.persist();
  queueMicrotask(()=>void this.process(eventId));
  return clone(row);
 }
 async process(eventId){
  if(this.active.has(eventId))return;
  const row=this.records[eventId];
  if(!row||row.status!=='QUEUED')return;
  this.active.add(eventId);row.status='RUNNING';row.updatedAt=stamp();
  this.persist();
  try{
   if(!row.result){
    if(!this.aiAvailable())throw new SiPostInspectionRiskError('SI_RISK_A01_A02_NOT_CONFIGURED',503);
    if(this.fleet.job?.status==='RUNNING')
     throw new SiPostInspectionRiskError('SI_RISK_FLEET_BATCH_BUSY');
    if(this.fleet.persistenceHealthy===false)
     throw new SiPostInspectionRiskError('SI_RISK_PERSISTENCE_UNAVAILABLE',503);
    const view=await this.getView(row.caseId);
    if(view.inspectionCase.imo!==row.imo||view.record?.report?.id!==row.reportId||
       view.record?.report?.status!=='APPROVED')
     throw new SiPostInspectionRiskError('SI_RISK_SOURCE_CHANGED');
    const bundle=await this.getBundle(row.imo);
    if(!bundle)throw new SiPostInspectionRiskError('SI_RISK_SOURCE_VESSEL_NOT_IN_NMC_COHORT');
    const augmented=approvedInspectionBundle(bundle,view);
    const evidenceId='SI-REPORT-'+row.reportId;
    const active=await this.getRiskConfig();
    const previous=this.fleet.getVesselResult(row.imo);
    // A01/A02 assess ALL FIVE NMC factors, then the central published risk
    // policy calculates the score. Individual source IDs bind actual inspector
    // defects to relevant factor signals; NO keyword-based assumptions.
    const assessed=await this.fleet.assess(augmented,active.config);
    const reportFindings=augmented.siFindingsForAttribution;
    const factorAttribution=verifiedFindingFactorAttribution(
      reportFindings,assessed.signals);
    if(!reportFindings.length&&!assessed.signals.some(s=>
        s.evidenceIds.includes(evidenceId)))
     throw new SiPostInspectionRiskError('SI_RISK_AI_DID_NOT_CITE_APPROVED_REPORT');
    const inputHash=createHash('sha256').update(JSON.stringify({
      prior:previous?.assessmentId||null,reportId:row.reportId,
      evidenceId,factorAttribution,
      approved:augmented.inlineContext.approvedInspectionReports,
      policyRevision:active.revision})).digest('hex');
    const at=stamp();
    const result={...assessed,status:'COMPLETED',inputHash,
      lastCheckedAt:at,nextCheckAt:new Date(Date.now()+3600000).toISOString(),
      refreshFailure:null};
    const before={assessmentId:previous?.assessmentId||null,
      score:previous?.score??null,level:previous?.level??null,
      signals:(previous?.signals||[]).map(s=>({
       factor:s.factor,severity:s.severity}))};
    if(this.fleet.repository){
      result.assessmentId=await this.fleet.repository.saveAssessment(result,{
        previous,jobId:null});
    }else{
      result.assessmentId=null;
      this.fleet.results[row.imo]=result;
      await this.fleet.persist();
    }
    this.fleet.results[row.imo]=result;
    // Persist the completed billable calls before optional downstream writes.
    row.result={assessmentId:result.assessmentId,score:result.score,
      level:result.level,previous:before,evidenceId,
      policyVersion:active.config.version,
      findingFactorAttribution:factorAttribution,
      factorChanges:result.signals.map(s=>({
        factor:s.factor,previous:before.signals.find(p=>p.factor===s.factor)?.severity??null,
        current:s.severity,sourceAgent:s.sourceAgent,confidence:s.confidence,
        reason:String(s.reason||'').slice(0,800),
        evidenceIds:s.evidenceIds.filter(id=>id===evidenceId||
          reportFindings.some(f=>f.evidenceId===id))
      })),createdAt:at};
    row.aiExecutionStatus='VALIDATED_SAVED';
    row.status='RISK_SAVED_NMC_PENDING';row.updatedAt=stamp();this.persist();
   }
   const saved=this.fleet.getVesselResult(row.imo);
   if(!saved||saved.status!=='COMPLETED'||
      saved.assessmentId!==row.result.assessmentId)
     throw new SiPostInspectionRiskError('SI_RISK_SAVED_ASSESSMENT_CHANGED');
   // The policy projection will be refreshed; source assessments are immutable.
   if(this.riskPolicy.ready)await this.riskPolicy.materializeCurrent(saved);
   else throw new SiPostInspectionRiskError('SI_RISK_POLICY_NOT_READY',503);
   const {result}=row;
   await this.caseWorkspace.recordPostInspectionRisk(row.nmcCaseId,{
    eventId:row.eventId,inspectionId:row.caseId,reportId:row.reportId,
    imo:row.imo,assessmentId:result.assessmentId,
    previousAssessmentId:result.previous.assessmentId,
    previousScore:result.previous.score,previousLevel:result.previous.level,
    newScore:result.score,newLevel:result.level,
    policyVersion:result.policyVersion,evidenceId:result.evidenceId,
    factorChanges:result.factorChanges,
    findingFactorAttribution:result.findingFactorAttribution||[]
   });
   row.status='COMPLETED';row.errorCode=null;row.errorDetails=null;
   row.updatedAt=stamp();
   this.persist();
  }catch(e){
   row.status=row.result?'RISK_SAVED_NMC_SYNC_FAILED':'FAILED';
   row.errorCode=safeCode(e);
   const details=e?.details;
   row.errorDetails=details&&
     ['movement','inspection','certificate','dataQuality','history']
       .includes(details.factor)&&['A01','A02'].includes(details.agent)&&
     Number.isInteger(details.unknownCount)&&
     Number.isInteger(details.citedCount)?{
      factor:details.factor,agent:details.agent,
      unknownCount:details.unknownCount,citedCount:details.citedCount
     }:null;
   row.updatedAt=stamp();this.persist();
   console.error('[si-risk-reassess] FAILED '+JSON.stringify({
     caseId:row.caseId,eventId:row.eventId,status:row.status,
     errorCode:row.errorCode,errorDetails:row.errorDetails}));
  }finally{this.active.delete(eventId);}
 }
}
