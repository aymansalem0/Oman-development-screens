/**
 * Centrally managed NMC POC cases. No Airia call or modification of risk
 * assessments. Case creation is always initiated by an NMC operator after
 * acknowledging a persisted alert. The event and case remain linked.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();
const isId=x=>typeof x==='string'&&/^[a-f\d-]{36}$/i.test(x);
const isImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const noteValue=x=>typeof x==='string'&&x.trim().length>0&&x.length<=500?x.trim():null;
const VALID_TASK_STATUS=['Assigned','In Progress','Completed','Escalated'];
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
    alerts
  }={}){
    if(!['json','oracle'].includes(mode)||!alerts)
      throw new Error('NMC_CASE_CONFIGURATION_INVALID');
    this.mode=mode;this.oracle=oracleRepository;this.file=file;this.alerts=alerts;
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
      tasks:[],actionPlan:null,inspectionRequests:[],decisions:[],inspectionOutcome:null,
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
  async task(id,version,taskId,action,note='',role='OPERATOR'){
    if(!['START','COMPLETE','ESCALATE'].includes(action))
      throw new NmcCaseError('CASE_TASK_ACTION_INVALID');
    if(typeof taskId!=='string'||!/^[-a-z0-9]{1,60}$/.test(taskId))
      throw new NmcCaseError('CASE_TASK_ID_INVALID');
    return this._update(id,version,'TASK_'+action,role,note,row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const task=row.tasks.find(item=>item.id===taskId);
      if(!task)throw new NmcCaseError('CASE_TASK_NOT_FOUND',404);
      const valid=action==='START'
        ?task.status==='Assigned'
        :action==='COMPLETE'
          ?['Assigned','In Progress','Escalated'].includes(task.status)
          :['Assigned','In Progress'].includes(task.status);
      if(!valid)throw new NmcCaseError('CASE_TASK_TRANSITION_INVALID',409);
      if(action==='COMPLETE'&&task.actionType==='PRIORITY_INSPECTION'&&!row.inspectionOutcome)
        throw new NmcCaseError('CASE_INSPECTION_EVIDENCE_REQUIRED',409);
      const nextStatus={START:'In Progress',COMPLETE:'Completed',ESCALATE:'Escalated'}[action];
      const tasks=row.tasks.map(t=>t.id===taskId?{
        ...t,status:nextStatus,
        assignedRole:action==='ESCALATE'?'NMC_SUPERVISOR':t.assignedRole
      }:t);
      const requiredDone=tasks.filter(t=>t.mandatory).every(t=>t.status==='Completed');
      const aiDecisionsPending=!!row.actionPlan?.proposedActions?.some(
        a=>a.decision==='PENDING');
      // Mandatory tasks alone do not mean a reviewed AI plan or post-inspection
      // reassessment is complete. Do not display a false PENDING_VERIFICATION.
      const verified=requiredDone&&!aiDecisionsPending&&!row.inspectionOutcome;
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
        if(row.inspectionOutcome?.inspectionId===outcome.inspectionId)
          throw new NmcCaseError('CASE_INSPECTION_ALREADY_RECORDED',409);
        const request=(row.inspectionRequests||[]).find(r=>r.status==='SCHEDULED'&&
          row.tasks.some(t=>t.actionId===r.actionId&&t.actionType==='PRIORITY_INSPECTION'));
        if((row.actionPlan||row.inspectionRequests?.length)&&!request)
          throw new NmcCaseError('CASE_INSPECTION_NOT_SCHEDULED',409);
        const tasks=row.tasks.map(t=>(request&&t.actionId===request.actionId)||
          (!row.actionPlan&&t.id==='priority-inspection')
          ?{...t,status:'Completed'}:t);
        const requiredDone=tasks.filter(t=>t.mandatory).every(t=>t.status==='Completed');
        return {...row,inspectionOutcome:{
          inspectionId:outcome.inspectionId,
          result:String(outcome.result||'Completed with Findings').slice(0,70),
          findingsCount:outcome.findingsCount,
          criticalFindings:outcome.criticalFindings,
          summary:outcome.summary,
          completedAt:now()
        },inspectionRequests:(row.inspectionRequests||[]).map(r=>r.id===request?.id?
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
        return {...row,actionPlan:plan,status:'IN_PROGRESS'};
      },{sourceAssessmentId:plan.sourceAssessmentId,proposals:plan.proposedActions.length});
  }
  async decideAction(id,version,actionId,decision,note='',role='OPERATOR'){
    if(!['ACCEPT','REJECT','MODIFY'].includes(decision))
      throw new NmcCaseError('CASE_DECISION_INVALID');
    if(decision!=='ACCEPT'&&!noteValue(note))
      throw new NmcCaseError('CASE_DECISION_REASON_REQUIRED');
    return this._update(id,version,'A01_ACTION_'+decision,role,note,row=>{
      if(row.status==='RESOLVED')throw new NmcCaseError('CASE_ALREADY_RESOLVED',409);
      const plan=row.actionPlan;
      if(!plan)throw new NmcCaseError('CASE_ACTION_PLAN_REQUIRED',409);
      const action=plan.proposedActions.find(a=>a.actionId===actionId);
      if(!action)throw new NmcCaseError('CASE_ACTION_NOT_FOUND',404);
      if(action.decision!=='PENDING')throw new NmcCaseError('CASE_ACTION_ALREADY_DECIDED',409);
      if((decision==='ACCEPT'||decision==='MODIFY')&&
        (!Array.isArray(action.evidenceIds)||!action.evidenceIds.length)&&
        action.actionType!=='NO_ACTION')throw new NmcCaseError('CASE_ACTION_EVIDENCE_REQUIRED');
      const accepted=decision!=='REJECT'&&action.actionType!=='NO_ACTION';
      const nextActions=plan.proposedActions.map(a=>a.actionId===actionId?
        {...a,decision,decisionNote:noteValue(note)||'',
          decidedAt:now(),decidedBy:role}:a);
      const tasks=[...row.tasks];
      const inspectionRequests=[...(row.inspectionRequests||[])];
      if(accepted){
        // New A01 tasks are separately namespaced from old fixed-template case
        // task IDs. Preserve actionId unchanged for inspection referral joins.
        const suffix=createHash('sha256').update(action.actionId).digest('hex').slice(0,10);
        const generatedTaskId='a01-'+action.actionId.slice(0,42)+'-'+suffix;
        const task={
          id:generatedTaskId,actionId:action.actionId,actionType:action.actionType,
          title:action.title,priority:action.priority,reason:action.reason,
          status:'Assigned',assignedRole:action.ownerRole,
          mandatory:true,evidenceIds:action.evidenceIds,
          provenance:'AIRIA_A01_HUMAN_APPROVED',sourceAssessmentId:row.sourceAssessmentId,
          generatedAt:now()
        };
        if(tasks.some(t=>t.id===task.id||
          (t.provenance==='AIRIA_A01_HUMAN_APPROVED'&&t.actionId===action.actionId)))
          throw new NmcCaseError('CASE_TASK_EXISTS',409);
        tasks.push(task);
        if(action.actionType==='PRIORITY_INSPECTION'){
          if(inspectionRequests.some(r=>r.status!=='COMPLETED'))
            throw new NmcCaseError('CASE_ACTIVE_INSPECTION_EXISTS',409);
          inspectionRequests.push({
            id:randomUUID(),caseId:row.id,imo:row.imo,actionId:action.actionId,
            status:'PENDING_SCHEDULING',inspectionRegime:'FOCUSED_INSPECTION',
            priority:action.priority,reason:action.reason,evidenceIds:action.evidenceIds,
            sourceScore:row.sourceScore,sourceAssessmentId:row.sourceAssessmentId,
            port:null,scheduledAt:null,inspector:null,scheduledBy:null,
            createdAt:now(),version:1
          });
        }
      }
      const allDecisionsRecorded=nextActions.every(a=>a.decision!=='PENDING');
      const allRequiredDone=tasks.length>0&&
        tasks.filter(t=>t.mandatory).every(t=>t.status==='Completed');
      // Legacy completed tasks cannot mark a case ready while A01 proposals
      // remain undecided or while a new inspection lacks reassessment.
      const ready=allDecisionsRecorded&&allRequiredDone&&!row.inspectionOutcome;
      return {...row,actionPlan:{...plan,proposedActions:nextActions},
        tasks,inspectionRequests,status:ready?'PENDING_VERIFICATION':'IN_PROGRESS'};
    },{actionId,decision});
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
      if(!row.actionPlan && !row.tasks.length)
        throw new NmcCaseError('CASE_ACTION_PLAN_REQUIRED',409);
      if(row.actionPlan?.proposedActions?.some(a=>a.decision==='PENDING'))
        throw new NmcCaseError('CASE_ACTION_DECISIONS_PENDING',409);
      if(row.tasks.some(t=>t.mandatory&&t.status!=='Completed'))
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
