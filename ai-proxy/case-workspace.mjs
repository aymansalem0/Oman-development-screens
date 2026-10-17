/**
 * Centrally managed NMC POC cases. No Airia call or modification of risk
 * assessments. Case creation is always initiated by an NMC operator after
 * acknowledging a persisted alert. The event and case remain linked.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';
import {buildSingleProposal,decisionDefinition,decisionActionPlan,isRegulatedDecision} from './nmc-decision-policy.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();
const isId=x=>typeof x==='string'&&/^[a-f\d-]{36}$/i.test(x);
const isImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const noteValue=x=>typeof x==='string'&&x.trim().length>0&&x.length<=500?x.trim():null;
const VALID_TASK_STATUS=['Assigned','In Progress','Completed','Escalated'];
// POC routes, not a legal MOEI decision-authority matrix; human changes are
// restricted to supported types and role mappings, not arbitrary agent text.
const HUMAN_REPLACEMENT_ROUTES=Object.freeze({
  VERIFY_CERTIFICATE:{title:'Verify maritime certificate status',role:'COMPLIANCE_OFFICER'},
  ENHANCED_MONITORING:{title:'Maintain enhanced vessel monitoring',role:'NMC_OFFICER'},
  PRIORITY_INSPECTION:{title:'Request priority vessel inspection',role:'INSPECTION_OFFICER'},
  REVIEW_DEFICIENCY:{title:'Review open inspection deficiencies',role:'COMPLIANCE_OFFICER'},
  VERIFY_DEFICIENCY_CLOSURE:{title:'Verify evidence of deficiency closure',role:'COMPLIANCE_OFFICER'},
  REQUEST_EXTERNAL_VERIFICATION:{title:'Request independent evidence verification',role:'COMPLIANCE_OFFICER'},
  NO_ACTION:{title:'No further intervention',role:'NMC_OFFICER'}
});
export class NmcCaseError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
function auditEntry(row,action,role,note='',details={}){
  return {version:row.version,action,role,note,details,at:row.updatedAt};
}
export class NmcCaseWorkspace{
  constructor({
    mode='json',oracleRepository=null,
    file=process.env.NMC_CASE_STORE_PATH||'/data/nmc-case-workspace.json',
    alerts,singleDecisionMode=true
  }={}){
    if(!['json','oracle'].includes(mode)||!alerts)
      throw new Error('NMC_CASE_CONFIGURATION_INVALID');
    this.mode=mode;this.oracle=oracleRepository;this.file=file;this.alerts=alerts;
    this.singleDecisionMode=singleDecisionMode;
  }
  async list(){
    if(this.mode==='json')return Object.values(this._load().cases).map(clone)
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    return this._db(async con=>{
      const result=await con.execute('SELECT DOC_JSON FROM NMC_CASE ORDER BY UPDATED_AT DESC',
        [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return result.rows.map(row=>JSON.parse(row.DOC_JSON));
    });
  }
  async get(id){
    if(!isId(id))throw new NmcCaseError('CASE_ID_INVALID');
    if(this.mode==='json')return clone(this._load().cases[id]||null);
    return this._db(async con=>{
      const result=await con.execute('SELECT DOC_JSON FROM NMC_CASE WHERE CASE_ID=:id',
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return result.rows.length?JSON.parse(result.rows[0].DOC_JSON):null;
    });
  }
  async byImo(imo){
    if(!isImo(imo))throw new NmcCaseError('CASE_IMO_INVALID');
    const cases=(await this.list()).filter(row=>row.imo===imo);
    return cases.find(row=>row.status!=='RESOLVED')||cases[0]||null;
  }
  async history(id){
    if(!isId(id))throw new NmcCaseError('CASE_ID_INVALID');
    if(this.mode==='json')return clone(this._load().history[id]||[]);
    return this._db(async con=>{
      const result=await con.execute(`SELECT VERSION_NO,ACTION_NAME,ACTOR_ROLE,NOTE,DETAIL_JSON,
        TO_CHAR(CHANGED_AT AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') AS CHANGED_AT
        FROM NMC_CASE_AUDIT WHERE CASE_ID=:id ORDER BY VERSION_NO DESC`,
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return result.rows.map(row=>({
        version:row.VERSION_NO,action:row.ACTION_NAME,role:row.ACTOR_ROLE,
        note:row.NOTE,details:JSON.parse(row.DETAIL_JSON),at:row.CHANGED_AT
      }));
    });
  }
  async fromAlert(alertId,role='OPERATOR'){
    if(!isId(alertId))throw new NmcCaseError('CASE_ALERT_ID_INVALID');
    const alert=await this.alerts.get(alertId);
    if(!alert)throw new NmcCaseError('CASE_ALERT_NOT_FOUND',404);
    if(!['ACKNOWLEDGED','IN_PROGRESS','ESCALATED'].includes(alert.status))
      throw new NmcCaseError('CASE_ALERT_ACK_REQUIRED',409);
    // Resumable/idempotent create: existing active case for this vessel is linked
    // rather than creating a competing operational case.
    const existing=(await this.list()).find(c=>
      c.status!=='RESOLVED'&&c.imo===alert.imo);
    if(existing){
      if(existing.alertIds.includes(alert.id))return existing;
      return this._update(existing.id,existing.version,'ALERT_LINKED',role,
        'Linked an additional alert to the existing maritime case',
        row=>({...row,alertIds:[...row.alertIds,alert.id]}),
        {alertId:alert.id});
    }
    const id=randomUUID(),timestamp=now();
    const record={
      id,imo:alert.imo,status:'OPEN',assignedRole:'NMC_OFFICER',
      source:'SAVED_AI_ALERT',sourceAssessmentId:alert.sourceAssessmentId,
      alertIds:[alert.id],sourceScore:alert.sourceScore,sourceLevel:alert.sourceLevel,
      createdAt:timestamp,updatedAt:timestamp,version:1,
      // New cases start with no fabricated tasks. A01 proposes actions;
      // human acceptance materializes tasks in the central case.
      tasks:[],actionPlan:null,operationalDecision:null,decisionFeedback:[],restriction:null,
      inspectionRequests:[],decisions:[],inspectionOutcome:null,
      resolutionNote:null,provenance:'SYNTHETIC_POC_NON_REGULATORY'
    };
    const log=auditEntry(record,'CREATED',role,
      'Case opened following human acknowledgment of saved AI risk alert',
      {alertId:alert.id,imo:alert.imo});
    if(this.mode==='json'){
      const db=this._load();
      const concurrent=Object.values(db.cases).find(c=>
        c.status!=='RESOLVED'&&c.imo===record.imo);
      if(concurrent)return this.fromAlert(alertId,role);
      db.cases[id]=record;db.history[id]=[log];this._write(db);
      return clone(record);
    }
    return this._db(async con=>{
      try{
        await con.execute(`INSERT INTO NMC_CASE(
          CASE_ID,IMO,SOURCE_ALERT_ID,ACTIVE_IMO,STATUS,VERSION_NO,DOC_JSON,UPDATED_ROLE)
          VALUES(:id,:imo,:alert,:imo,:status,:version,:doc,:role)`,{
          id,imo:record.imo,alert:alert.id,status:record.status,
          version:1,doc:clob(record),role
        });
        await this._audit(con,id,log);
        await con.commit();return record;
      }catch(error){
        await con.rollback();
        if(error?.errorNum===1){
          const existing=await this.byImo(alert.imo);
          if(existing?.status!=='RESOLVED')return existing;
        }
        throw error;
      }
    });
  }

  /**
   * Intake from an already persisted, evidence-grounded incident assessment.
   * This opens/links ONE active NMC case per vessel without fabricating
   * approval, execution, inspection or legal action. Incident ID + source
   * description hash are the idempotency identity.
   */
  async fromIncident(incident,assessment,sourceVessel=null,role='NMC_SYSTEM'){
    const id=incident?.incidentId,imo=incident?.imo;
    if(!/^INC-[A-Za-z0-9-]{3,70}$/.test(id||'')||!isImo(imo)||
      !assessment||assessment.descriptionHash!==incident.descriptionHash||
      assessment.assessmentStatus!=='AI_COMPLETE'&&assessment.assessmentStatus!=='HUMAN_REVIEWED'||
      !/^A01_A02_EXISTING_CONTRACTS_V1$/.test(assessment.contractVersion||'')||
      !assessment.aiEvidenceIds?.includes('INCIDENT-'+id)||
      !Number.isFinite(assessment.incidentRiskScore))
      throw new NmcCaseError('CASE_INCIDENT_ASSESSMENT_NOT_VERIFIED',409);
    if(!sourceVessel||sourceVessel.status!=='COMPLETED'||
      !Number.isFinite(sourceVessel.score))
      throw new NmcCaseError('CASE_INCIDENT_VESSEL_CONTEXT_REQUIRED',409);
    const event={
      incidentId:id,descriptionHash:incident.descriptionHash,
      sourceOrganization:incident.sourceOrganization,sourceType:incident.sourceType,
      sourceReference:incident.sourceReference,sourceIncidentStatus:incident.sourceIncidentStatus,
      sourceOperationalStatus:incident.operationalStatus,
      incidentType:incident.incidentType,portOrZone:incident.portOrZone,
      sourceDescription:incident.description,sourceReportedSeverity:incident.reportedSeverity,
      evidenceIds:[...new Set(assessment.aiEvidenceIds)].slice(0,40),
      incidentRiskScore:assessment.incidentRiskScore,
      incidentRiskBand:assessment.incidentRiskBand,
      incidentScoreSource:'NMC_DETERMINISTIC_INCIDENT_POLICY',
      suggestedFollowup:assessment.aiProposedFollowup,
      suggestedFollowupState:assessment.suggestedFollowupState,
      sourceAssessmentId:assessment.assessmentId,
      a02ContextStatus:assessment.a02IncidentCompliance?.status||'UNKNOWN',
      decisionStatus:'PENDING_HUMAN_REVIEW',
      approvedFollowup:null,officerName:null,officerReason:null,
      receivedAt:incident.receivedAt||incident.reportedAt||null,
      assessedAt:assessment.assessedAt,updatedAt:now()
    };
    const existing=(await this.list()).find(x=>x.status!=='RESOLVED'&&x.imo===imo);
    if(existing){
      const prior=(existing.incidentEvents||[]).find(x=>x.incidentId===id);
      if(prior?.descriptionHash===incident.descriptionHash&&
         prior?.sourceAssessmentId===assessment.assessmentId)
        return existing;
      if(prior?.decisionStatus==='OFFICER_APPROVED'&&
         prior.descriptionHash!==incident.descriptionHash)
        throw new NmcCaseError('CASE_INCIDENT_NEW_VERSION_REQUIRES_REVIEW',409);
      return this._update(existing.id,existing.version,'INCIDENT_LINKED',role,
        'Source incident linked to active vessel case; action pending human decision',
        row=>({...row,incidentEvents:[
          ...(row.incidentEvents||[]).filter(x=>x.incidentId!==id),event
        ]}),{incidentId:id,assessmentId:assessment.assessmentId,hasAutomaticTasks:false});
    }
    const caseId=randomUUID(),created=now();
    const record={
      id:caseId,imo,status:'OPEN',assignedRole:'NMC_OFFICER',
      source:'GOOGLE_SHEETS_INCIDENT',sourceAssessmentId:sourceVessel.assessmentId||null,
      alertIds:[],sourceScore:sourceVessel.score,sourceLevel:sourceVessel.level||'UNKNOWN',
      createdAt:created,updatedAt:created,version:1,
      tasks:[],actionPlan:null,operationalDecision:null,decisionFeedback:[],
      restriction:null,inspectionRequests:[],decisions:[],inspectionOutcome:null,
      incidentEvents:[event],
      resolutionNote:null,provenance:'SYNTHETIC_POC_NON_REGULATORY'
    };
    const log=auditEntry(record,'INCIDENT_CASE_CREATED',role,
      'Automatically opened from an evidence-grounded NMC source incident; no tasks approved',
      {incidentId:id,assessmentId:assessment.assessmentId,source:'GOOGLE_SHEETS',humanApproved:false});
    if(this.mode==='json'){
      const state=this._load();
      const duplicate=Object.values(state.cases).find(x=>x.status!=='RESOLVED'&&x.imo===imo);
      if(duplicate)return this.fromIncident(incident,assessment,sourceVessel,role);
      state.cases[caseId]=record;state.history[caseId]=[log];
      this._write(state);
      return clone(record);
    }
    return this._db(async con=>{
      try{
        await con.execute(`INSERT INTO NMC_CASE(
          CASE_ID,IMO,SOURCE_ALERT_ID,ACTIVE_IMO,STATUS,VERSION_NO,DOC_JSON,UPDATED_ROLE)
          VALUES(:id,:imo,:alert,:imo,:status,:version,:doc,:role)`,{
          id:caseId,imo,alert:null,status:'OPEN',version:1,
          doc:clob(record),role
        });
        await this._audit(con,caseId,log);await con.commit();
        return record;
      }catch(error){
        await con.rollback();
        if(error?.errorNum===1){
          const match=(await this.list()).find(x=>x.status!=='RESOLVED'&&x.imo===imo);
          if(match)return this.fromIncident(incident,assessment,sourceVessel,role);
        }
        // Oracle SOURCE_ALERT_ID must permit NULL for source-independent incident cases.
        if(error?.errorNum===1400)throw new NmcCaseError('CASE_INCIDENT_SCHEMA_REQUIRES_NULL_ALERT',503);
        throw error;
      }
    });
  }

  /**
   * The ONLY place to approve incident actions: NMC Case Management.
   * All executable tasks are generated AFTER an accountable human decision.
   */
  async decideIncident(caseId,version,incidentId,{decision,approvedFollowup,note,officer}={},role='OPERATOR'){
    const allowed=['VERIFY_INFORMATION','ACTIVE_MONITORING','REFER_SMART_INSPECTION',
      'ESCALATE_TO_AUTHORITY','INCIDENT_RESPONSE','CLOSE_AFTER_VERIFICATION'];
    if(!/^INC-[A-Za-z0-9-]{3,70}$/.test(incidentId||'')||
      !['ACCEPT','MODIFY','REJECT'].includes(decision)||
      !allowed.includes(approvedFollowup)||
      typeof note!=='string'||note.trim().length<15||note.length>500||
      typeof officer!=='string'||officer.trim().length<3||officer.length>80)
      throw new NmcCaseError('CASE_INCIDENT_DECISION_INVALID',422);
    const routes={
      VERIFY_INFORMATION:'REQUEST_EXTERNAL_VERIFICATION',
      ACTIVE_MONITORING:'ENHANCED_MONITORING',
      REFER_SMART_INSPECTION:'REFER_SMART_INSPECTION',
      ESCALATE_TO_AUTHORITY:'REQUEST_EXTERNAL_VERIFICATION',
      INCIDENT_RESPONSE:'INCIDENT_RESPONSE_COORDINATION',
      CLOSE_AFTER_VERIFICATION:'REQUEST_EXTERNAL_VERIFICATION'
    };
    return this._update(caseId,version,'INCIDENT_DECISION_'+decision,role,note.trim(),row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const event=(row.incidentEvents||[]).find(x=>x.incidentId===incidentId);
      if(!event)throw new NmcCaseError('CASE_INCIDENT_NOT_FOUND',404);
      if(event.decisionStatus!=='PENDING_HUMAN_REVIEW')
        throw new NmcCaseError('CASE_INCIDENT_ALREADY_DECIDED',409);
      if(decision==='ACCEPT'&&approvedFollowup!==event.suggestedFollowup||
        decision==='MODIFY'&&approvedFollowup===event.suggestedFollowup||
        decision==='REJECT'&&approvedFollowup!=='VERIFY_INFORMATION')
        throw new NmcCaseError('CASE_INCIDENT_DECISION_MISMATCH',422);
      const followup=decision==='REJECT'?'VERIFY_INFORMATION':approvedFollowup;
      const workflowCode=routes[followup];
      const steps=decisionActionPlan(workflowCode);
      if(!steps)throw new NmcCaseError('CASE_INCIDENT_WORKFLOW_UNAVAILABLE',409);
      const taskSet=[...row.tasks],inspectionRequests=[...(row.inspectionRequests||[])];
      const reviewed={
        ...event,decisionStatus:'OFFICER_APPROVED',officerDecision:decision,
        approvedFollowup:followup,officerName:officer.trim(),officerReason:note.trim(),
        decidedAt:now(),workflowCode,
        followupExecutionStatus:'PENDING_TASKS'
      };
      for(const step of steps){
        const incidentKey=createHash('sha256').update(incidentId).digest('hex').slice(0,14);
        const taskId=('inc-'+incidentKey+'-'+step.id).slice(0,60);
        if(taskSet.some(t=>t.id===taskId))
          throw new NmcCaseError('CASE_INCIDENT_TASK_DUPLICATE',409);
        const actionId='incident-'+incidentId.toLowerCase();
        taskSet.push({
          id:taskId,actionId,incidentId,actionType:step.kind==='SMART_INSPECTION'
            ?'PRIORITY_INSPECTION':workflowCode,
          workflowStepId:step.id,title:step.titleEn,titleAr:step.titleAr,
          priority:event.incidentRiskBand,reason:note.trim(),
          status:'Assigned',assignedRole:step.role,mandatory:step.mandatory,
          regulatedEnforcement:false,evidenceIds:[...event.evidenceIds],
          provenance:'NMC_INCIDENT_HUMAN_APPROVED',approvalMode:decision,generatedAt:now()
        });
        if(step.kind==='SMART_INSPECTION'){
          if(inspectionRequests.some(x=>x.status!=='COMPLETED'))
            throw new NmcCaseError('CASE_ACTIVE_INSPECTION_EXISTS',409);
          inspectionRequests.push({
            id:randomUUID(),caseId:row.id,imo:row.imo,incidentId,
            actionId,status:'PENDING_SCHEDULING',
            inspectionRegime:'FOCUSED_INSPECTION',
            priority:event.incidentRiskBand,reason:note.trim(),
            evidenceIds:[...event.evidenceIds],sourceScore:row.sourceScore,
            sourceAssessmentId:row.sourceAssessmentId,
            port:null,scheduledAt:null,inspector:null,scheduledBy:null,
            createdAt:now(),version:1,
            referralSource:'NMC_INCIDENT_HUMAN_APPROVED_POC'
          });
        }
      }
      return {...row,status:'IN_PROGRESS',tasks:taskSet,inspectionRequests,
        incidentEvents:row.incidentEvents.map(x=>x.incidentId===incidentId?reviewed:x)
      };
    },{incidentId,decision,approvedFollowup,officer:officer.trim(),
       noAutomaticEnforcement:true});
  }

  async task(id,version,taskId,action,note='',role='OPERATOR'){
    if(!['START','COMPLETE','ESCALATE'].includes(action))
      throw new NmcCaseError('CASE_TASK_ACTION_INVALID');
    if(typeof taskId!=='string'||!/^[-a-z0-9]{1,60}$/.test(taskId))
      throw new NmcCaseError('CASE_TASK_ID_INVALID');
    return this._update(id,version,'TASK_'+action,role,note,row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const task=row.tasks.find(item=>item.id===taskId);
      if(!task||(!row.actionPlan&&!(row.incidentEvents||[]).length)||
         !['AIRIA_A01_HUMAN_APPROVED','NMC_DECISION_HUMAN_APPROVED',
           'NMC_INCIDENT_HUMAN_APPROVED'].includes(task.provenance))
        throw new NmcCaseError('CASE_TASK_NOT_FOUND',404);
      const valid=action==='START'
        ?task.status==='Assigned'
        :action==='COMPLETE'
          ?['Assigned','In Progress','Escalated'].includes(task.status)
          :['Assigned','In Progress'].includes(task.status);
      if(!valid)throw new NmcCaseError('CASE_TASK_TRANSITION_INVALID',409);
      if(action==='COMPLETE'&&task.regulatedEnforcement&&
        row.restriction?.status!=='SIMULATED_ACTIVE')
        throw new NmcCaseError('CASE_RESTRICTION_AUTHORIZATION_REQUIRED',409);
      if(action==='COMPLETE'&&task.actionType==='PRIORITY_INSPECTION'&&!row.inspectionOutcome)
        throw new NmcCaseError('CASE_INSPECTION_EVIDENCE_REQUIRED',409);
      const nextStatus={START:'In Progress',COMPLETE:'Completed',ESCALATE:'Escalated'}[action];
      const tasks=row.tasks.map(t=>t.id===taskId?{
        ...t,status:nextStatus,
        assignedRole:action==='ESCALATE'?'NMC_SUPERVISOR':t.assignedRole
      }:t);
      const aiTasks=tasks.filter(t=>['AIRIA_A01_HUMAN_APPROVED','NMC_DECISION_HUMAN_APPROVED','NMC_INCIDENT_HUMAN_APPROVED'].includes(t.provenance));
      const requiredDone=aiTasks.filter(t=>t.mandatory).every(t=>t.status==='Completed');
      const aiDecisionsPending=row.operationalDecision
        ?row.operationalDecision.decisionStatus==='PENDING_HUMAN_REVIEW'
        :!!row.actionPlan?.proposedActions?.some(a=>a.decision==='PENDING');
      // Mandatory tasks alone do not mean a reviewed AI plan or post-inspection
      // reassessment is complete. Do not display a false PENDING_VERIFICATION.
      const incidentDecisionsPending=(row.incidentEvents||[])
        .some(ev=>ev.decisionStatus==='PENDING_HUMAN_REVIEW');
      const verified=requiredDone&&!aiDecisionsPending&&
        !incidentDecisionsPending&&!row.inspectionOutcome;
      return {...row,tasks,status:verified?'PENDING_VERIFICATION':'IN_PROGRESS'};
    },{taskId,action});
  }
  async decision(id,version,data,role='OPERATOR'){
    const {recommendationId,decision,note,evidenceIds}=data||{};
    if(typeof recommendationId!=='string'||!/^[-a-zA-Z0-9]{1,90}$/.test(recommendationId))
      throw new NmcCaseError('CASE_RECOMMENDATION_INVALID');
    if(!['ACCEPT','MODIFY','REJECT'].includes(decision))
      throw new NmcCaseError('CASE_DECISION_INVALID');
    if(decision!=='ACCEPT'&&!noteValue(note))
      throw new NmcCaseError('CASE_DECISION_REASON_REQUIRED');
    if(decision==='MODIFY'&&!Object.hasOwn(HUMAN_REPLACEMENT_ROUTES,replacementActionType||''))
      throw new NmcCaseError('CASE_MODIFICATION_ROUTE_REQUIRED');
    if(decision!=='MODIFY'&&replacementActionType)
      throw new NmcCaseError('CASE_MODIFICATION_ROUTE_UNEXPECTED');
    if(!Array.isArray(evidenceIds)||evidenceIds.length>20||
      evidenceIds.some(v=>typeof v!=='string'||v.length>100))
      throw new NmcCaseError('CASE_EVIDENCE_INVALID');
    return this._update(id,version,'DECISION_RECORDED',role,note||'',row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const entry={recommendationId,decision,note:noteValue(note)||'',
        evidenceIds:[...new Set(evidenceIds)],at:now(),role};
      const previous=row.decisions.filter(d=>d.recommendationId!==recommendationId);
      return {...row,decisions:[entry,...previous]};
    },{recommendationId,decision,evidenceIds});
  }
  /**
   * Forward an approved SI-origin report to an existing active NMC case, or
   * open ONE human-review case. No artificial alert, inspection request,
   * inspector assignment or regulatory decision is generated.
   * SOURCE_ALERT_ID must permit NULL (existing incident-case migration).
   */
  async fromSiInspection({inspectionId,imo,reportId,summary,supervisor}={},role='SI_SUPERVISOR'){
    if(!isId(inspectionId)||!isId(reportId)||!isImo(imo)||
      typeof summary!=='string'||summary.length>500||
      typeof supervisor!=='string'||supervisor.length>120||!supervisor.trim())
      throw new NmcCaseError('CASE_SI_FORWARD_INVALID',422);
    const eventId=inspectionId+':'+reportId+':FORWARDED';
    const entry={eventId,inspectionId,reportId,
      summary,supervisor,receivedAt:now(),source:'SI_APPROVED_REPORT',
      regulatoryDecision:false};
    const open=(await this.list()).find(row=>row.imo===imo&&row.status!=='RESOLVED');
    if(open){
      if((open.siInspectionSources||[]).some(x=>x.eventId===eventId))
        return open;
      return this._update(open.id,open.version,'SI_APPROVED_REPORT_FORWARDED',role,
        'Approved SI inspector report forwarded for NMC review',row=>({
          ...row,siInspectionSources:[...(row.siInspectionSources||[]),entry]
        }),{eventId,inspectionId,reportId});
    }
    const id=randomUUID(),timestamp=now();
    const record={id,imo,status:'OPEN',assignedRole:'NMC_OFFICER',
      source:'SI_APPROVED_INSPECTION',sourceAssessmentId:null,
      alertIds:[],sourceScore:null,sourceLevel:null,
      createdAt:timestamp,updatedAt:timestamp,version:1,
      tasks:[],actionPlan:null,operationalDecision:null,decisionFeedback:[],
      restriction:null,inspectionRequests:[],decisions:[],inspectionOutcome:null,
      siInspectionSources:[entry],postInspectionRiskHistory:[],
      resolutionNote:null,provenance:'SYNTHETIC_POC_NON_REGULATORY'};
    const audit=auditEntry(record,'SI_APPROVED_REPORT_FORWARDED',role,
      'Approved inspection handed to NMC; no regulatory action',
      {eventId,inspectionId,reportId});
    if(this.mode==='json'){
      const db=this._load(),existing=Object.values(db.cases).find(row=>
        row.imo===imo&&row.status!=='RESOLVED');
      if(existing)return this.fromSiInspection({inspectionId,imo,reportId,summary,supervisor},role);
      db.cases[id]=record;db.history[id]=[audit];this._write(db);return clone(record);
    }
    return this._db(async con=>{
      try{
        await con.execute(`INSERT INTO NMC_CASE(
          CASE_ID,IMO,SOURCE_ALERT_ID,ACTIVE_IMO,STATUS,VERSION_NO,DOC_JSON,UPDATED_ROLE)
          VALUES(:id,:imo,NULL,:imo,:status,:version,:doc,:role)`,{
          id,imo,status:record.status,version:1,doc:clob(record),role});
        await this._audit(con,id,audit);await con.commit();return record;
      }catch(error){
        await con.rollback();
        if(error?.errorNum===1){
          const existing=await this.byImo(imo);
          if(existing?.status!=='RESOLVED')return this.fromSiInspection(
            {inspectionId,imo,reportId,summary,supervisor},role);
        }
        if(error?.errorNum===1400)throw new NmcCaseError(
          'CASE_SI_SOURCE_ALERT_NULL_MIGRATION_REQUIRED',503);
        throw error;
      }
    });
  }

  /** Save verified operational AI score without approving any NMC decisions. */
  async recordPostInspectionRisk(id,result,role='NMC_AI_SYSTEM'){
    const {eventId,inspectionId,reportId,imo,assessmentId,
      previousAssessmentId,previousScore,previousLevel,
      newScore,newLevel,policyVersion,evidenceId,factorChanges,
      findingFactorAttribution=[]}=result||{};
    if(!isId(id)||!isId(inspectionId)||!isId(reportId)||!isImo(imo)||
      !isId(assessmentId)||typeof eventId!=='string'||eventId.length>150||
      !Number.isFinite(newScore)||newScore<0||newScore>100||
      !['Normal','Watch','High','Critical'].includes(newLevel)||
      typeof evidenceId!=='string'||!evidenceId.startsWith('SI-REPORT-')||
      !Array.isArray(factorChanges)||factorChanges.length!==5||
      !Array.isArray(findingFactorAttribution)||findingFactorAttribution.length>100)
      throw new NmcCaseError('CASE_AI_RISK_UPDATE_INVALID',422);
    const allowedFactors=new Set(['movement','inspection','certificate','dataQuality','history']);
    if(new Set(factorChanges.map(f=>f.factor)).size!==5||
      factorChanges.some(f=>!allowedFactors.has(f.factor)||
        !Number.isFinite(f.current)||f.current<0||f.current>100)||
      findingFactorAttribution.some(f=>!Array.isArray(f.linkedFactors)||
        !f.linkedFactors.length||
        f.linkedFactors.some(x=>!allowedFactors.has(x.factor)||
          !String(x.sourceEvidenceId||'').startsWith('SI-FINDING-'))))
      throw new NmcCaseError('CASE_AI_FACTOR_ATTRIBUTION_INVALID',422);
    const entry={eventId,inspectionId,reportId,assessmentId,previousAssessmentId,
      previousScore,previousLevel,newScore,newLevel,policyVersion,evidenceId,
      factorChanges,findingFactorAttribution,
      calculatedAt:now(),officialRegulatoryDecision:false};
    for(let tries=0;tries<3;tries++){
      const row=await this.get(id);
      if(!row||row.imo!==imo)throw new NmcCaseError('CASE_AI_RISK_SOURCE_MISMATCH',409);
      if((row.postInspectionRiskHistory||[]).some(x=>x.eventId===eventId))
        return row;
      try{return await this._update(id,row.version,'SI_POST_INSPECTION_AI_RISK_REASSESSED',role,
        'A01/A02 validated post-inspection operational risk; decisions remain human',current=>({
          ...current,operationalRisk:{
            score:newScore,level:newLevel,assessmentId,
            previousScore,previousLevel,sourceInspectionId:inspectionId,
            sourceReportId:reportId,evidenceId,policyVersion,updatedAt:entry.calculatedAt,
            factorAttribution: findingFactorAttribution.map(f=>({
              findingId:f.findingId,title:f.title,severity:f.severity,
              factors:f.linkedFactors.map(x=>x.factor)})),
            provisional:true,regulatoryDecision:false},
          postInspectionRiskHistory:[...(current.postInspectionRiskHistory||[]),entry]
        }),{eventId,assessmentId,inspectionId,newScore,previousScore,
          evidenceId,regulatoryDecision:false});}
      catch(error){if(error?.code!=='CASE_VERSION_CONFLICT'||tries===2)throw error;}
    }
  }
  /** Human supervisor report decision, informational NMC Case update only.
   * Never marks an inspection request completed, changes vessel risk or resolves a case.
   */
  async inspectionReview(id,version,update,role='SI_SUPERVISOR'){
    if(!update||!['APPROVED','RETURNED'].includes(update.decision)||
       typeof update.inspectionId!=='string'||!isId(update.inspectionId)||
       typeof update.referralId!=='string'||!isId(update.referralId)||
       typeof update.reportId!=='string'||!isId(update.reportId)||
       typeof update.summary!=='string'||update.summary.length>500)
      throw new NmcCaseError('CASE_INSPECTION_REVIEW_INVALID',422);
    const eventId=update.inspectionId+':'+update.reportId+':'+update.decision;
    return this._update(id,version,'INSPECTION_SUPERVISOR_REVIEW',role,
      'Supervisor '+update.decision+' inspection report',row=>{
        if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        if(!row.inspectionRequests?.some(x=>x.id===update.referralId))
          throw new NmcCaseError('CASE_INSPECTION_REFERRAL_MISMATCH',409);
        const events=Array.isArray(row.inspectionReviewHistory)?
          row.inspectionReviewHistory:[];
        if(events.some(x=>x.eventId===eventId))
          throw new NmcCaseError('CASE_INSPECTION_REVIEW_ALREADY_RECORDED',409);
        return {...row,inspectionReviewStatus:update.decision,
          inspectionReviewHistory:[...events,{
            eventId,inspectionId:update.inspectionId,
            reportId:update.reportId,referralId:update.referralId,
            decision:update.decision,summary:update.summary,
            inspector:update.inspector||null,supervisor:update.supervisor||null,
            reviewedAt:now(),source:'SI_HUMAN_SUPERVISOR'
          }],status:row.status};
      },{inspectionId:update.inspectionId,referralId:update.referralId,
        decision:update.decision,eventId});
  }

  async inspection(id,version,outcome,role='OPERATOR'){
    if(!outcome||typeof outcome.inspectionId!=='string'||
      !/^[a-zA-Z0-9-]{1,100}$/.test(outcome.inspectionId)||
      typeof outcome.summary!=='string'||outcome.summary.length>500||
      !Number.isInteger(outcome.findingsCount)||outcome.findingsCount<0||
      !Number.isInteger(outcome.criticalFindings)||outcome.criticalFindings<0)
      throw new NmcCaseError('CASE_INSPECTION_INVALID');
    return this._update(id,version,'INSPECTION_RECORDED',role,
      outcome.summary||'Smart Inspection outcome recorded',row=>{
        if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        const previousInspections=Array.isArray(row.inspectionHistory)
          ?row.inspectionHistory
          :(row.inspectionOutcome?[row.inspectionOutcome]:[]);
        if(previousInspections.some(i=>i.inspectionId===outcome.inspectionId))
          throw new NmcCaseError('CASE_INSPECTION_ALREADY_RECORDED',409);
        const request=(row.inspectionRequests||[]).find(r=>r.status==='SCHEDULED'&&
          row.tasks.some(t=>t.actionId===r.actionId&&t.actionType==='PRIORITY_INSPECTION'));
        if((row.actionPlan||row.inspectionRequests?.length)&&!request)
          throw new NmcCaseError('CASE_INSPECTION_NOT_SCHEDULED',409);
        const tasks=row.tasks.map(t=>(request&&t.actionId===request.actionId)||
          (!row.actionPlan&&t.id==='priority-inspection')
          ?{...t,status:'Completed'}:t);
        const aiTasks=tasks.filter(t=>t.provenance==='AIRIA_A01_HUMAN_APPROVED');
      const requiredDone=aiTasks.filter(t=>t.mandatory).every(t=>t.status==='Completed');
        const savedOutcome={
          inspectionId:outcome.inspectionId,
          result:String(outcome.result||'Completed with Findings').slice(0,70),
          findingsCount:outcome.findingsCount,
          criticalFindings:outcome.criticalFindings,
          summary:outcome.summary,
          inspector:request?.inspector||null,
          inspectionRequestId:request?.id||null,
          completedAt:now()
        };
        return {...row,inspectionOutcome:savedOutcome,
          // Carry forward historic case results instead of overwriting the
          // earlier inspection that existed before the new A01 referral.
          inspectionHistory:[...previousInspections,savedOutcome],
          inspectionRequests:(row.inspectionRequests||[]).map(r=>r.id===request?.id?
          {...r,status:'COMPLETED',completedAt:now(),inspectionId:outcome.inspectionId}:r),
          // A field inspection is NOT a verified post-inspection risk
          // assessment; the case must remain in-progress until A02 refresh.
          tasks,status:'IN_PROGRESS'};
      },{inspectionId:outcome.inspectionId});
  }

  async saveActionPlan(id,version,plan,role='OPERATOR'){
    if(!plan||!Array.isArray(plan.proposedActions)||!plan.proposedActions.length)
      throw new NmcCaseError('CASE_ACTION_PLAN_INVALID');
    return this._update(id,version,'A01_ACTION_PLAN_RECORDED',role,
      'A01 evidence-backed proposals submitted for human decision',row=>{
        if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        if(row.actionPlan)throw new NmcCaseError('CASE_ACTION_PLAN_EXISTS',409);
        if(row.imo!==plan.imo||row.sourceScore!==plan.sourceScore||
          row.sourceAssessmentId!==plan.sourceAssessmentId)
          throw new NmcCaseError('CASE_ACTION_PLAN_SOURCE_MISMATCH',409);
        // An older case may have been pending verification on its legacy tasks.
        // Starting a new AI action review reopens the operational work stage.
        return {...row,actionPlan:plan,operationalDecision:this.singleDecisionMode?buildSingleProposal(plan):null,status:'IN_PROGRESS'};
      },{sourceAssessmentId:plan.sourceAssessmentId,proposals:plan.proposedActions.length});
  }
  async decideAction(id,version,actionId,decision,note='',role='OPERATOR',replacementActionType=null){
    if(!['ACCEPT','REJECT','MODIFY'].includes(decision))
      throw new NmcCaseError('CASE_DECISION_INVALID');
    if(decision!=='ACCEPT'&&!noteValue(note))
      throw new NmcCaseError('CASE_DECISION_REASON_REQUIRED');
    // Reject unknown replacement actions BEFORE writing any case or task.
    // An absent/unsupported route must never silently fall back to the
    // original A01 title, owner or workflow. Regulatory decisions remain
    // outside the human-approved POC replacement route allowlist.
    if(decision==='MODIFY'&&!Object.hasOwn(HUMAN_REPLACEMENT_ROUTES,replacementActionType||''))
      throw new NmcCaseError('CASE_MODIFICATION_ROUTE_REQUIRED');
    if(decision!=='MODIFY'&&replacementActionType)
      throw new NmcCaseError('CASE_MODIFICATION_ROUTE_UNEXPECTED');
    return this._update(id,version,'A01_ACTION_'+decision,role,note,row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const plan=row.actionPlan;
      if(!plan)throw new NmcCaseError('CASE_ACTION_PLAN_REQUIRED',409);
      if(row.operationalDecision)throw new NmcCaseError('CASE_SINGLE_DECISION_MODE',409);
      const action=plan.proposedActions.find(a=>a.actionId===actionId);
      if(!action)throw new NmcCaseError('CASE_ACTION_NOT_FOUND',404);
      if(action.decision!=='PENDING')throw new NmcCaseError('CASE_ACTION_ALREADY_DECIDED',409);
      const changed=decision==='MODIFY';
      if(changed&&replacementActionType===action.actionType)
        throw new NmcCaseError('CASE_MODIFICATION_MUST_CHANGE_ROUTE');
      const effectiveType=changed?replacementActionType:action.actionType;
      const route=changed?HUMAN_REPLACEMENT_ROUTES[replacementActionType]:null;
      if((decision==='ACCEPT'||changed)&&
        (!Array.isArray(action.evidenceIds)||!action.evidenceIds.length)&&
        effectiveType!=='NO_ACTION')throw new NmcCaseError('CASE_ACTION_EVIDENCE_REQUIRED');
      // Original A01 proposal stays immutable for review and later feedback.
      const effectiveTitle=route?.title||action.title;
      const effectiveRole=route?.role||action.ownerRole;
      const effectiveReason=changed?noteValue(note):action.reason;
      const accepted=decision!=='REJECT'&&effectiveType!=='NO_ACTION';
      const nextActions=plan.proposedActions.map(a=>a.actionId===actionId?
        {...a,decision,decisionNote:noteValue(note)||'',
          ...(changed?{replacementActionType:effectiveType,
            replacementTitle:effectiveTitle,replacementOwnerRole:effectiveRole}:{}),
          decidedAt:now(),decidedBy:role}:a);
      const tasks=[...row.tasks];
      const inspectionRequests=[...(row.inspectionRequests||[])];
      if(accepted){
        // New A01 tasks are separately namespaced from old fixed-template case
        // task IDs. Preserve actionId unchanged for inspection referral joins.
        const suffix=createHash('sha256').update(action.actionId).digest('hex').slice(0,10);
        const generatedTaskId='a01-'+action.actionId.slice(0,42)+'-'+suffix;
        const task={
          id:generatedTaskId,actionId:action.actionId,actionType:effectiveType,
          title:effectiveTitle,priority:action.priority,reason:effectiveReason,
          status:'Assigned',assignedRole:effectiveRole,approvalMode:decision,
          mandatory:true,evidenceIds:action.evidenceIds,
          provenance:'AIRIA_A01_HUMAN_APPROVED',sourceAssessmentId:row.sourceAssessmentId,
          generatedAt:now()
        };
        if(tasks.some(t=>t.id===task.id||
          (t.provenance==='AIRIA_A01_HUMAN_APPROVED'&&t.actionId===action.actionId)))
          throw new NmcCaseError('CASE_TASK_EXISTS',409);
        tasks.push(task);
        if(effectiveType==='PRIORITY_INSPECTION'){
          if(inspectionRequests.some(r=>r.status!=='COMPLETED'))
            throw new NmcCaseError('CASE_ACTIVE_INSPECTION_EXISTS',409);
          inspectionRequests.push({
            id:randomUUID(),caseId:row.id,imo:row.imo,actionId:action.actionId,
            status:'PENDING_SCHEDULING',inspectionRegime:'FOCUSED_INSPECTION',
            priority:action.priority,reason:effectiveReason,evidenceIds:action.evidenceIds,
            sourceScore:row.sourceScore,sourceAssessmentId:row.sourceAssessmentId,
            port:null,scheduledAt:null,inspector:null,scheduledBy:null,
            createdAt:now(),version:1
          });
        }
      }
      const allDecisionsRecorded=nextActions.every(a=>a.decision!=='PENDING');
      const aiTasks=tasks.filter(t=>t.provenance==='AIRIA_A01_HUMAN_APPROVED');
      const allRequiredDone=aiTasks.filter(t=>t.mandatory)
        .every(t=>t.status==='Completed');
      // Legacy completed tasks cannot mark a case ready while A01 proposals
      // remain undecided or while a new inspection lacks reassessment.
      const ready=allDecisionsRecorded&&allRequiredDone&&!row.inspectionOutcome;
      return {...row,actionPlan:{...plan,proposedActions:nextActions},
        tasks,inspectionRequests,status:ready?'PENDING_VERIFICATION':'IN_PROGRESS'};
    },{actionId,decision,replacementActionType:decision==='MODIFY'?replacementActionType:null});
  }

  /**
   * SINGLE maritime business decision for new NMC POC cases.
   * The primary source remains the unchanged A01 action; the catalogue and
   * mapping are NMC-owned policy, not claimed to have been authored by Airia.
   * No genuine restriction, detention, or port API is called.
   */
  /**
   * Explicitly opt an untouched, previously-saved legacy A01 action plan
   * into the single-decision POC. Never invoke Airia or change saved risk,
   * any individual A01 proposal or a human's previous decisions.
   */
  async initializeOperational(id,version,role='OPERATOR'){
    return this._update(id,version,'SINGLE_DECISION_FROM_SAVED_A01',role,
      'Operator converted unreviewed saved A01 recommendations to one NMC POC decision',
      row=>{
        if(row.status==='RESOLVED')
          throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        if(!row.actionPlan?.proposedActions?.length)
          throw new NmcCaseError('CASE_ACTION_PLAN_REQUIRED',409);
        if(row.operationalDecision)
          throw new NmcCaseError('CASE_SINGLE_DECISION_EXISTS',409);
        if(row.actionPlan.proposedActions.some(a=>a.decision!=='PENDING')||
          row.tasks.some(t=>t.provenance==='AIRIA_A01_HUMAN_APPROVED')||
          (row.decisions||[]).length>0||
          (row.inspectionRequests||[]).length>0)
          throw new NmcCaseError('CASE_LEGACY_REVIEW_ALREADY_STARTED',409);
        const proposal=buildSingleProposal(row.actionPlan);
        if(!proposal)throw new NmcCaseError('CASE_SINGLE_DECISION_UNAVAILABLE',409);
        return {...row,operationalDecision:proposal};
      },{noNewAiCall:true,originalAssessmentUnchanged:true});
  }

  async decideOperational(id,version,data,role='OPERATOR'){
    const {decision,newDecisionCode,note}=data||{};
    if(!['ACCEPT','MODIFY','REJECT'].includes(decision))
      throw new NmcCaseError('CASE_DECISION_INVALID');
    if(decision!=='ACCEPT'&&!noteValue(note))
      throw new NmcCaseError('CASE_DECISION_REASON_REQUIRED');
    if(decision==='MODIFY'&&!decisionDefinition(newDecisionCode))
      throw new NmcCaseError('CASE_DECISION_CODE_UNSUPPORTED');
    if(decision!=='MODIFY'&&newDecisionCode)
      throw new NmcCaseError('CASE_MODIFICATION_ROUTE_UNEXPECTED');
    return this._update(id,version,'OPERATIONAL_DECISION_'+decision,role,note||'',row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const proposal=row.operationalDecision;
      if(!proposal)throw new NmcCaseError('CASE_SINGLE_DECISION_UNAVAILABLE',409);
      if(proposal.decisionStatus!=='PENDING_HUMAN_REVIEW')
        throw new NmcCaseError('CASE_ACTION_ALREADY_DECIDED',409);
      const missingA01Reason=proposal.rationale===
        'A01 recommendation linked to the validated source evidence IDs';
      // Legacy A01 sometimes omitted action-specific reasoning. Never
      // treat the generic filler as valid business reasoning. An authorized
      // human may explicitly supply and own a documented explanation.
      if(decision==='ACCEPT'&&missingA01Reason&&!noteValue(note))
        throw new NmcCaseError('CASE_DECISION_RATIONALE_UNAVAILABLE',409);
      const code=decision==='MODIFY'?newDecisionCode:proposal.code;
      if(decision==='MODIFY'&&code===proposal.code)
        throw new NmcCaseError('CASE_MODIFICATION_MUST_CHANGE_ROUTE');
      const def=decisionDefinition(code);
      if(!def)throw new NmcCaseError('CASE_DECISION_CODE_UNSUPPORTED');
      if(decision!=='REJECT'&&
        (isRegulatedDecision(code)||['REFER_SMART_INSPECTION','UNMAPPED_TO_INSPECTION'].includes(code))&&
        !proposal.evidenceIds?.length)
        throw new NmcCaseError('CASE_DECISION_EVIDENCE_REQUIRED',409);
      // Regulatory decisions are simulated *only after* a second, distinct
      // publisher-key approval and documented authority reference.
      const restriction=decision!=='REJECT'&&isRegulatedDecision(code)
        ?{type:def.restrictionType,status:'PENDING_AUTHORITY_APPROVAL',
          pocOnly:true,legalAuthorityConfirmed:false,
          originalRiskScore:row.sourceScore,requestedAt:now(),
          authorityReference:null,authorizedAt:null,releaseEvidenceRef:null}
        :null;
      const steps=decision==='REJECT'?[]:decisionActionPlan(code);
      const tasks=[...row.tasks];
      const inspectionRequests=[...(row.inspectionRequests||[])];
      for(const [i,item] of steps.entries()){
        const idPart='nmc-'+String(i+1)+'-'+item.id;
        if(tasks.some(t=>t.id===idPart))throw new NmcCaseError('CASE_TASK_EXISTS',409);
        const linkedActionId=proposal.selectedFromActionId;
        tasks.push({
          id:idPart,actionId:linkedActionId,actionType:item.kind==='SMART_INSPECTION'
            ?'PRIORITY_INSPECTION':code,
          workflowStepId:item.id,title:item.titleEn,titleAr:item.titleAr,
          priority:proposal.originalA01Proposal.priority||'HIGH',
          reason:decision==='MODIFY'||missingA01Reason?noteValue(note):proposal.rationale,
          status:'Assigned',assignedRole:item.role,mandatory:item.mandatory,
          regulatedEnforcement:!!def.regulated,
          evidenceIds:proposal.evidenceIds,
          provenance:'NMC_DECISION_HUMAN_APPROVED',
          approvalMode:decision,generatedAt:now()
        });
        if(item.kind==='SMART_INSPECTION'){
          if(inspectionRequests.some(x=>x.status!=='COMPLETED'))
            throw new NmcCaseError('CASE_ACTIVE_INSPECTION_EXISTS',409);
          inspectionRequests.push({
            id:randomUUID(),caseId:row.id,imo:row.imo,
            actionId:linkedActionId,status:'PENDING_SCHEDULING',
            inspectionRegime:'FOCUSED_INSPECTION',priority:'HIGH',
            reason:decision==='MODIFY'||missingA01Reason?noteValue(note):proposal.rationale,
            evidenceIds:proposal.evidenceIds,sourceScore:row.sourceScore,
            sourceAssessmentId:row.sourceAssessmentId,
            port:null,scheduledAt:null,inspector:null,scheduledBy:null,
            createdAt:now(),version:1,
            referralSource:'NMC_HUMAN_APPROVED_BUSINESS_DECISION'
          });
        }
      }
      const reviewed={
        ...proposal,decisionStatus:decision==='REJECT'?'REJECTED':'APPROVED',
        humanDecision:decision,
        approvedCode:decision==='REJECT'?null:code,
        approvedTitleEn:decision==='REJECT'?null:def.titleEn,
        approvedTitleAr:decision==='REJECT'?null:def.titleAr,
        approvedWorkflowSteps:steps,decisionNote:noteValue(note)||'',
        rationaleSource:missingA01Reason?'OFFICER_VALIDATED_LEGACY_A01':'AIRIA_A01_ACTION',
        decidedBy:role,decidedAt:now(),regulatoryEffect:'NONE_POC_ONLY'
      };
      // An immutable-original event goes to a durable CASE outbox. It is not
      // transmitted to an imaginary improvement agent without a verified API.
      const feedback=decision==='MODIFY'?[
        ...(row.decisionFeedback||[]),{
          id:randomUUID(),eventType:'NMC_AI_DECISION_IMPROVEMENT',
          originalA01Proposal:clone(proposal.originalA01Proposal),
          originalNmcProposedCode:proposal.code,
          humanApprovedCode:code,reason:noteValue(note),
          evidenceIds:[...proposal.evidenceIds],
          caseId:row.id,imo:row.imo,sourceAssessmentId:row.sourceAssessmentId,
          at:now(),status:'QUEUED_AWAITING_AGENT_INTEGRATION',
          aiTransmissionCount:0
        }
      ]:(row.decisionFeedback||[]);
      return {
        ...row,operationalDecision:reviewed,restriction,tasks,
        inspectionRequests,decisionFeedback:feedback,status:'IN_PROGRESS'
      };
    },{decision,newDecisionCode:decision==='MODIFY'?newDecisionCode:null,
      originalA01ActionId:null,feedbackQueued:decision==='MODIFY'});
  }

  /**
   * Explicit publisher-key authorization of a simulated restriction.
   * This does NOT attest that an MOEI officer has legal powers, and has
   * no external port/ship/legal registry side effects.
   */
  async authorizeRestriction(id,version,data,role='POC_SUPERVISOR'){
    const authorityReference=typeof data?.authorityReference==='string'
      ?data.authorityReference.trim():'';
    const legalBasis=typeof data?.legalBasis==='string'?data.legalBasis.trim():'';
    if(!/^[A-Za-z0-9/_.-]{6,80}$/.test(authorityReference)||legalBasis.length<10||
      legalBasis.length>500)
      throw new NmcCaseError('CASE_RESTRICTION_AUTHORITY_EVIDENCE_REQUIRED');
    return this._update(id,version,'POC_RESTRICTION_SIMULATED_AUTHORIZED',role,
      'Simulator authorization only — never dispatched to ports',row=>{
        if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        if(row.restriction?.status!=='PENDING_AUTHORITY_APPROVAL')
          throw new NmcCaseError('CASE_RESTRICTION_NOT_PENDING',409);
        return {...row,restriction:{
          ...row.restriction,status:'SIMULATED_ACTIVE',pocOnly:true,
          legalAuthorityConfirmed:false,authorityReference,
          legalBasis,authorizedAt:now(),authorizedBy:role
        }};
      },{authorityReference,simulation:true});
  }

  async releaseRestriction(id,version,data,role='POC_SUPERVISOR'){
    const authorityReference=typeof data?.authorityReference==='string'
      ?data.authorityReference.trim():'';
    const rectificationEvidenceRef=typeof data?.rectificationEvidenceRef==='string'
      ?data.rectificationEvidenceRef.trim():'';
    if(!/^[A-Za-z0-9/_.-]{6,80}$/.test(authorityReference)||
      !/^[A-Za-z0-9/_.-]{6,100}$/.test(rectificationEvidenceRef))
      throw new NmcCaseError('CASE_RESTRICTION_RELEASE_EVIDENCE_REQUIRED');
    return this._update(id,version,'POC_RESTRICTION_SIMULATED_RELEASED',role,
      'Simulation release after recorded rectification evidence',row=>{
        if(row.restriction?.status!=='SIMULATED_ACTIVE')
          throw new NmcCaseError('CASE_RESTRICTION_NOT_ACTIVE',409);
        return {...row,restriction:{
          ...row.restriction,status:'SIMULATED_RELEASED',
          releasedAt:now(),releaseAuthorityReference:authorityReference,
          releaseEvidenceRef:rectificationEvidenceRef
        }};
      },{authorityReference,rectificationEvidenceRef,simulation:true});
  }

  async listInspectionRequests(){
    const rows=await this.list();
    return rows.flatMap(c=>(c.inspectionRequests||[]).map(r=>({
      ...r,caseStatus:c.status,sourceLevel:c.sourceLevel
    }))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async scheduleInspection(id,version,requestId,data,role='OPERATOR'){
    const {scheduledAt,port,inspector}=data||{};
    const stamp=Date.parse(scheduledAt);
    if(typeof scheduledAt!=='string'||!Number.isFinite(stamp)||stamp<=Date.now()||
      typeof port!=='string'||!port.trim()||port.trim().length>120||
      typeof inspector!=='string'||!inspector.trim()||inspector.trim().length>120)
      throw new NmcCaseError('CASE_SCHEDULE_INVALID');
    return this._update(id,version,'INSPECTION_SCHEDULED',role,
      'NMC referral scheduled by a human Smart Inspection coordinator',row=>{
        if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
        const req=(row.inspectionRequests||[]).find(r=>r.id===requestId);
        if(!req)throw new NmcCaseError('CASE_INSPECTION_REQUEST_NOT_FOUND',404);
        if(req.status!=='PENDING_SCHEDULING')
          throw new NmcCaseError('CASE_INSPECTION_SCHEDULE_CONFLICT',409);
        return {...row,inspectionRequests:row.inspectionRequests.map(r=>r.id!==requestId?r:{
          ...r,status:'SCHEDULED',scheduledAt:new Date(stamp).toISOString(),
          port:port.trim(),inspector:inspector.trim(),scheduledBy:role,version:r.version+1
        })};
      },{requestId,scheduledAt:new Date(stamp).toISOString()});
  }
  async resolve(id,version,note,role='SUPERVISOR'){
    if(role!=='SUPERVISOR')throw new NmcCaseError('CASE_SUPERVISOR_REQUIRED',403);
    const reason=noteValue(note);
    if(!reason)throw new NmcCaseError('CASE_RESOLUTION_NOTE_REQUIRED');
    return this._update(id,version,'RESOLVED',role,reason,row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      if(!row.actionPlan&&!(row.incidentEvents||[]).length)
        throw new NmcCaseError('CASE_ACTION_PLAN_REQUIRED',409);
      if((row.incidentEvents||[]).some(ev=>ev.decisionStatus==='PENDING_HUMAN_REVIEW'))
        throw new NmcCaseError('CASE_INCIDENT_DECISION_PENDING',409);
      if(row.operationalDecision
        ?row.operationalDecision.decisionStatus==='PENDING_HUMAN_REVIEW'
        :row.actionPlan?.proposedActions?.some(a=>a.decision==='PENDING'))
        throw new NmcCaseError('CASE_ACTION_DECISIONS_PENDING',409);
      if(row.restriction&&row.restriction.status!=='SIMULATED_RELEASED')
        throw new NmcCaseError('CASE_RESTRICTION_STILL_ACTIVE',409);
      if(row.tasks.some(t=>['AIRIA_A01_HUMAN_APPROVED','NMC_DECISION_HUMAN_APPROVED','NMC_INCIDENT_HUMAN_APPROVED'].includes(t.provenance)&&
        t.mandatory&&t.status!=='Completed'))
        throw new NmcCaseError('CASE_MANDATORY_TASKS_INCOMPLETE',409);
      // Stage 3 will add evidence-linked A02 compliance refresh and a new,
      // persisted deterministic risk assessment. Until then, no completed
      // inspection can be presented as fully reassessed and ready for closure.
      if(row.inspectionOutcome)
        throw new NmcCaseError('CASE_RISK_REASSESSMENT_PENDING',409);
      return {...row,status:'RESOLVED',resolutionNote:reason};
    },{});
  }
  async _update(id,version,action,role,note,build,details){
    if(!isId(id))throw new NmcCaseError('CASE_ID_INVALID');
    if(!Number.isInteger(version)||version<1)
      throw new NmcCaseError('CASE_VERSION_REQUIRED');
    if(typeof note!=='string'||note.length>500)
      throw new NmcCaseError('CASE_NOTE_INVALID');
    const updateRow=current=>{
      if(!current)throw new NmcCaseError('CASE_NOT_FOUND',404);
      if(current.version!==version)throw new NmcCaseError('CASE_VERSION_CONFLICT',409);
      const next=build(clone(current));
      next.version=current.version+1;next.updatedAt=now();
      return next;
    };
    if(this.mode==='json'){
      const db=this._load();
      const next=updateRow(db.cases[id]);
      const entry=auditEntry(next,action,role,note,details);
      db.cases[id]=next;
      db.history[id]=[entry,...(db.history[id]||[])];
      this._write(db);return clone(next);
    }
    return this._db(async con=>{
      try{
        const r=await con.execute('SELECT DOC_JSON FROM NMC_CASE WHERE CASE_ID=:id FOR UPDATE',
          {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
        const next=updateRow(r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null);
        const changed=await con.execute(`UPDATE NMC_CASE
          SET STATUS=:status,ACTIVE_IMO=:active,VERSION_NO=:newVersion,
          DOC_JSON=:doc,UPDATED_ROLE=:role,UPDATED_AT=SYSTIMESTAMP
          WHERE CASE_ID=:id AND VERSION_NO=:version`,{
          id,status:next.status,
          active:next.status==='RESOLVED'?null:next.imo,
          newVersion:next.version,doc:clob(next),role,version
        });
        if(changed.rowsAffected!==1)throw new NmcCaseError('CASE_VERSION_CONFLICT',409);
        await this._audit(con,id,auditEntry(next,action,role,note,details));
        await con.commit();return next;
      }catch(err){await con.rollback();throw err;}
    });
  }
  async _audit(con,id,row){
    await con.execute(`INSERT INTO NMC_CASE_AUDIT(
      CASE_ID,VERSION_NO,ACTION_NAME,ACTOR_ROLE,NOTE,DETAIL_JSON)
      VALUES(:id,:version,:action,:role,:note,:doc)`,{
      id,version:row.version,action:row.action,role:row.role,
      note:row.note,doc:clob(row.details)
    });
  }
  async _db(work){
    if(!this.oracle?.pool)throw new NmcCaseError('CASE_STORE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await work(con);}
    catch(err){
      if(err instanceof NmcCaseError)throw err;
      if([942,904].includes(err?.errorNum))
        throw new NmcCaseError('CASE_SCHEMA_NOT_READY',503);
      throw new NmcCaseError('CASE_STORE_UNAVAILABLE',503);
    }finally{await con.close();}
  }
  _load(){
    if(!existsSync(this.file))return {schema:1,cases:{},history:{}};
    try{
      const db=JSON.parse(readFileSync(this.file,'utf8'));
      if(db.schema===1&&db.cases&&db.history)return db;
    }catch{throw new NmcCaseError('CASE_STORE_UNAVAILABLE',503);}
    throw new NmcCaseError('CASE_STORE_UNAVAILABLE',503);
  }
  _write(db){
    try{
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp';
      writeFileSync(tmp,JSON.stringify(db),{mode:0o600});
      renameSync(tmp,this.file);
    }catch{throw new NmcCaseError('CASE_STORE_UNAVAILABLE',503);}
  }
}
