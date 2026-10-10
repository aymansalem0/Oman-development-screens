/**
 * Smart Inspection End-to-End POC: approved SI case -> preparation -> scope ->
 * assignment -> field checks -> report -> CAPA -> follow-up -> closure.
 * Standalone SI case ledger. Never modifies NMC risk/official PSC or silently
 * schedules NMC referrals. Evidence entries are METADATA, not uploaded files.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

const now=()=>new Date().toISOString();
const clone=x=>JSON.parse(JSON.stringify(x));
const str=(v,max=300)=>typeof v==='string'?v.trim().slice(0,max):'';
const validId=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);
const STATUS=['NOT_STARTED','PREPARATION_READY','SCOPE_APPROVED','ASSIGNED','IN_FIELD',
  'REPORT_PENDING_REVIEW','REPORT_RETURNED','REPORT_APPROVED','ACTIONS_OPEN',
  'FOLLOW_UP_PENDING','READY_TO_CLOSE','CLOSED'];
const CHECK_STATUS=['PENDING','PASS','DEFICIENCY','NOT_APPLICABLE'];
const SEVERITY=['MINOR','MAJOR','CRITICAL'];
const final=x=>x==='CLOSED';
const jsonClob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const fails=(code,status=422)=>{throw new SiLifecycleError(code,status);};

export class SiLifecycleError extends Error{
  constructor(code,status=422){super(code);this.code=code;this.status=status;}
}

export class SiInspectionLifecycle{
  constructor({mode='json',oracleRepository=null,targeting,preparation,cases,
    file=process.env.SI_LIFECYCLE_STORE_PATH||'/data/si-inspection-lifecycle.json'}={}){
    this.mode=mode;this.oracle=oracleRepository;this.targeting=targeting;
    this.preparation=preparation;this.cases=cases;this.file=file;
    this.ready=mode==='json';this.active=new Set();
  }
  async db(fn){
    if(!this.oracle?.pool)fails('SI_ORACLE_NOT_READY',503);
    const con=await this.oracle.pool.getConnection();
    try{return await fn(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){this.ready=true;return;}
    await this.db(async con=>{
      const q=await con.execute(`SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
        ('SI_INSPECTION_LIFECYCLE','SI_INSPECTION_LIFECYCLE_AUDIT')`,[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(q.rows.length!==2)fails('SI_MIGRATION_013_REQUIRED',503);
    });
    this.ready=true;
  }
  assertReady(){if(!this.ready)fails('SI_MIGRATION_013_REQUIRED',503);}
  readJson(){
    if(!existsSync(this.file))return {};
    const data=JSON.parse(readFileSync(this.file,'utf8'));
    return data&&typeof data==='object'&&!Array.isArray(data)?data:{};
  }
  writeJson(data){
    mkdirSync(dirname(this.file),{recursive:true});
    const tmp=this.file+'.tmp-'+process.pid;
    writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
    renameSync(tmp,this.file);
  }
  async saved(id){
    this.assertReady();
    if(this.mode==='json')return clone(this.readJson()[id]||null);
    return this.db(async con=>{
      const r=await con.execute(
        'SELECT DOC_JSON FROM SI_INSPECTION_LIFECYCLE WHERE CASE_ID=:id',
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
    });
  }
  async persist(id,before,after,action,actor,reason){
    if(this.mode==='json'){
      const state=this.readJson(),current=state[id]||null;
      if((current?.version||0)!==(before?.version||0))
        fails('SI_LIFECYCLE_VERSION_CONFLICT',409);
      state[id]=after;this.writeJson(state);return;
    }
    return this.db(async con=>{
      try{
        if(before){
          const r=await con.execute(`UPDATE SI_INSPECTION_LIFECYCLE
            SET VERSION_NO=:v,DOC_JSON=:doc,UPDATED_AT=SYSTIMESTAMP
            WHERE CASE_ID=:id AND VERSION_NO=:expected`,
            {v:after.version,doc:jsonClob(after),id,expected:before.version});
          if(r.rowsAffected!==1)fails('SI_LIFECYCLE_VERSION_CONFLICT',409);
        }else{
          await con.execute(`INSERT INTO SI_INSPECTION_LIFECYCLE
            (CASE_ID,VERSION_NO,DOC_JSON) VALUES (:id,:v,:doc)`,
            {id,v:after.version,doc:jsonClob(after)});
        }
        await con.execute(`INSERT INTO SI_INSPECTION_LIFECYCLE_AUDIT
          (AUDIT_ID,CASE_ID,VERSION_NO,ACTION_NAME,ACTOR,REASON)
          VALUES (:id,:caseId,:v,:action,:actor,:reason)`,
          {id:randomUUID(),caseId:id,v:after.version,action,actor,reason:str(reason,500)});
        await con.commit();
      }catch(e){
        await con.rollback();
        if(e.code==='ORA-00001')fails('SI_LIFECYCLE_VERSION_CONFLICT',409);
        throw e;
      }
    });
  }
  async reference(id){
    if(!validId(id))fails('SI_CASE_ID_INVALID');
    const c=await this.targeting.inspectionCase(id);
    if(!c||c.status!=='CREATED')fails('SI_APPROVED_CASE_REQUIRED',404);
    return c;
  }
  async snapshot(id){
    const inspectionCase=await this.reference(id);
    const [record,preparation]=await Promise.all([
      this.saved(id),this.preparation.get(id)]);
    return {status:'ok',inspectionCase,preparation:{
      status:preparation.saved?.status||'NOT_PREPARED',
      version:preparation.saved?.version||0,stale:preparation.stale,
      baseChecklistIds:preparation.context.baseChecklistItemIds,
      dossier:preparation.saved?.dossier||null,
      provenance:preparation.context.provenance,
      externalDocumentsVerified:preparation.context.externalDocumentsVerified
    },record:record||null,
      stages:STATUS,readyForInitialization:!record&&
      ['PREPARED','APPROVED'].includes(preparation.saved?.status||'')&&!preparation.stale,
      limitations:[
        'PSC and Service Excel are POC-simulated sources, not verified regulatory approvals.',
        'Field evidence references are metadata, not independently verified file uploads.',
        'AI reports/vision/voice and cross-domain enforcement are not active in lifecycle V1.',
        'NMC Risk remains unchanged; closure does not imply compliant risk reassessment.'
      ]};
  }
  async list(){
    this.assertReady();
    // A live targeting queue is not a historical ledger. Its NMC referrals
    // disappear after resolution, so always read the *persisted* case registry.
    const registry=await this.targeting.inspectionCaseRegistry();
    let byCurrentCase=new Map();
    try{
      const dashboard=await this.targeting.dashboard();
      byCurrentCase=new Map(dashboard.candidates
        .filter(x=>x.inspectionCase?.id).map(x=>[x.inspectionCase.id,x]));
    }catch{
      // Registry still loads even if live NMC risk/PSC is temporarily down.
    }
    const eventMap=new Map(registry.events.map(x=>[x.eventKey,x]));
    let saved={};
    if(this.mode==='json')saved=this.readJson();
    else saved=await this.db(async con=>{
      const r=await con.execute('SELECT CASE_ID,DOC_JSON FROM SI_INSPECTION_LIFECYCLE',[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      return Object.fromEntries(r.rows.map(row=>[row.CASE_ID,JSON.parse(row.DOC_JSON)]));
    });
    const records=registry.cases.filter(x=>x.status==='CREATED').map(c=>{
      const current=saved[c.id],live=byCurrentCase.get(c.id);
      const bundle=this.targeting.bundles?.find(x=>x.imo===c.imo);
      const vessel=bundle?.inlineContext?.vessel||{};
      const refs=(c.sourceEventKeys||[]).map(key=>eventMap.get(key))
        .filter(Boolean).map(e=>({source:e.payload.sourceType,ref:e.payload.sourceReference}));
      if(c.nmcReferralId&&!refs.some(x=>x.source==='NMC_CASE'))
        refs.push({source:'NMC_CASE',ref:c.nmcCaseId||c.nmcReferralId});
      return {id:c.id,imo:c.imo,
        vesselName:live?.vesselName||vessel.name||vessel.vesselName||('IMO '+c.imo),
        regime:c.regime,approvedBy:c.approvedBy,
        sourceEvents:refs,risk:live?.currentRisk||c.riskAtApproval||null,
        stage:current?.stage||'NOT_STARTED',version:current?.version||0,
        updatedAt:current?.updatedAt||c.createdAt||null,
        findings:current?.findings?.length||0,actions:current?.actions?.length||0};
    }).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return {status:'ok',count:records.length,cases:records};
  }
  async apply(id,payload={}){
    const {action,expectedVersion,actor,data={}}=payload;
    if(!validId(id))fails('SI_CASE_ID_INVALID');
    if(!str(actor,120)||str(actor).length>120||!Number.isInteger(expectedVersion)||
      expectedVersion<0||typeof action!=='string'||!data||typeof data!=='object'||Array.isArray(data))
      fails('SI_LIFECYCLE_REQUEST_INVALID');
    if(this.active.has(id))fails('SI_LIFECYCLE_BUSY',409);
    this.active.add(id);
    try{
      const c=await this.reference(id),previous=await this.saved(id);
      if((previous?.version||0)!==expectedVersion)
        fails('SI_LIFECYCLE_VERSION_CONFLICT',409);
      if(final(previous?.stage))fails('SI_LIFECYCLE_ALREADY_CLOSED',409);
      const prep=await this.preparation.get(id);
      let next=previous?clone(previous):null;
      const requireStage=(...stages)=>{
        if(!next||!stages.includes(next.stage))fails('SI_LIFECYCLE_STAGE_CONFLICT',409);
      };
      const reason=str(data.reason,900);
      switch(action){
        case 'INITIALIZE':{
          if(next)fails('SI_LIFECYCLE_ALREADY_INITIALIZED',409);
          if(!['PREPARED','APPROVED'].includes(prep.saved?.status)||prep.stale)
            fails('SI_PREPARATION_READY_REQUIRED',409);
          next={caseId:id,imo:c.imo,regime:c.regime,stage:'PREPARATION_READY',
            version:0,createdAt:now(),updatedAt:now(),
            preparationVersion:prep.saved.version,
            scopeApprovedBy:null,assignment:null,startedAt:null,completedAt:null,
            checks:prep.context.baseChecklistItemIds.map(checkId=>({
              id:checkId,mandatory:true,status:'PENDING',severity:null,
              note:'',naReason:'',evidenceRefs:[]})),
            findings:[],report:null,actions:[],followUps:[],audit:[]};
          break;
        }
        case 'ADD_SCOPE':{
          requireStage('PREPARATION_READY');
          if(!Array.isArray(data.additions)||data.additions.length>12)
            fails('SI_SCOPE_ADDITIONS_INVALID');
          const allowed=prep.saved?.status==='APPROVED'?
            new Set((prep.saved.dossier?.suggestedAdditionalItems||[]).map(x=>x.title)):new Set();
          const unique=[...new Set(data.additions.map(x=>str(x,140)))].filter(Boolean);
          if(unique.some(x=>!allowed.has(x)))fails('SI_SCOPE_SUGGESTION_NOT_APPROVED',409);
          next.checks=next.checks.filter(x=>x.mandatory).concat(unique.map((title,index)=>({
            id:'additional-'+(index+1),title,mandatory:false,status:'PENDING',severity:null,
            note:'',naReason:'',evidenceRefs:[]})));
          break;
        }
        case 'APPROVE_SCOPE':{
          requireStage('PREPARATION_READY');
          if(!reason||reason.length<8)fails('SI_APPROVAL_REASON_REQUIRED');
          if(prep.stale||!['PREPARED','APPROVED'].includes(prep.saved?.status))
            fails('SI_PREPARATION_STALE',409);
          next.stage='SCOPE_APPROVED';next.scopeApprovedBy=str(actor,120);
          next.scopeReason=reason;break;
        }
        case 'ASSIGN':{
          requireStage('SCOPE_APPROVED');
          const inspector=str(data.inspector,120),port=str(data.port,120),
            startLocal=str(data.startLocal,40),mode=str(data.mode,40);
          if(!inspector||!port||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(startLocal)||
            !['POC_MANUAL','NMC_SCHEDULED'].includes(mode))
            fails('SI_ASSIGNMENT_FIELDS_REQUIRED');
          if(c.nmcReferralId){
            if(mode!=='NMC_SCHEDULED')fails('SI_NMC_SCHEDULING_REQUIRED',409);
            const refs=await this.cases.listInspectionRequests();
            const match=refs.find(r=>r.id===c.nmcReferralId&&r.imo===c.imo&&r.status==='SCHEDULED');
            if(!match)fails('SI_NMC_REFERRAL_NOT_CONFIRMED',409);
            // Never mark arbitrary POC time/inspector/port as an NMC-confirmed booking.
            const selectedUtc=Date.parse(startLocal+':00+04:00');
            const confirmedUtc=Date.parse(match.scheduledAt||'');
            if(!Number.isFinite(selectedUtc)||!Number.isFinite(confirmedUtc)||
              Math.abs(selectedUtc-confirmedUtc)>=60000||
              String(match.inspector||'').trim()!==inspector||
              String(match.port||'').trim()!==port)
              fails('SI_NMC_CONFIRMED_ASSIGNMENT_MISMATCH',409);
          }else if(mode!=='POC_MANUAL')fails('SI_EXTERNAL_SOURCE_POC_SCHEDULING_ONLY',409);
          next.assignment={inspector,port,startLocal,mode,
            operationalValidity:mode==='NMC_SCHEDULED'?'NMC_CONFIRMED':'SIMULATED_POC',
            assignedBy:str(actor,120),assignedAt:now()};
          next.stage='ASSIGNED';break;
        }
        case 'START_FIELD':{
          requireStage('ASSIGNED');
          if(str(actor,120)!==next.assignment.inspector)
            fails('SI_ONLY_ASSIGNED_INSPECTOR',403);
          next.stage='IN_FIELD';next.startedAt=now();break;
        }
        case 'SAVE_CHECKS':{
          requireStage('IN_FIELD','REPORT_RETURNED');
          if(str(actor,120)!==next.assignment.inspector)
            fails('SI_ONLY_ASSIGNED_INSPECTOR',403);
          if(!Array.isArray(data.checks)||data.checks.length>50)
            fails('SI_CHECKS_INVALID');
          const byId=new Map(next.checks.map(x=>[x.id,x]));
          for(const row of data.checks){
            if(!byId.has(row.id)||!CHECK_STATUS.includes(row.status)||
              (row.status==='DEFICIENCY'&&!SEVERITY.includes(row.severity))||
              !Array.isArray(row.evidenceRefs)||row.evidenceRefs.length>12)
              fails('SI_CHECK_VALUE_INVALID');
            const item=byId.get(row.id);
            item.status=row.status;item.severity=row.status==='DEFICIENCY'?row.severity:null;
            item.note=str(row.note,1600);item.naReason=str(row.naReason,500);
            item.evidenceRefs=[...new Set(row.evidenceRefs.map(x=>str(x,180)).filter(Boolean))];
            if(row.status==='NOT_APPLICABLE'&&!item.naReason)
              fails('SI_NA_REASON_REQUIRED');
          }
          if(next.stage==='REPORT_RETURNED')next.stage='IN_FIELD';
          next.report=null;break;
        }
        case 'SUBMIT_FIELD':{
          requireStage('IN_FIELD');
          if(str(actor,120)!==next.assignment.inspector)
            fails('SI_ONLY_ASSIGNED_INSPECTOR',403);
          if(next.checks.some(x=>x.status==='PENDING'))
            fails('SI_ALL_CHECKS_REQUIRED',409);
          const deficiencies=next.checks.filter(x=>x.status==='DEFICIENCY');
          if(deficiencies.some(x=>!x.note||
            (x.severity!=='MINOR'&&!x.evidenceRefs.length)))
            fails('SI_FINDING_NOTE_AND_EVIDENCE_REQUIRED',409);
          next.findings=deficiencies.map(x=>({id:'F-'+x.id,checkId:x.id,
            title:x.title||x.id,severity:x.severity,description:x.note,
            evidenceRefs:clone(x.evidenceRefs),status:'CONFIRMED_BY_INSPECTOR'}));
          next.report={id:randomUUID(),source:'DETERMINISTIC_INSPECTOR_DATA',
            status:'PENDING_REVIEW',generatedAt:now(),submittedBy:str(actor,120),
            summary:str(data.summary,1800)||`Inspected ${next.checks.length} checks. ${deficiencies.length} recorded deficiencies.`,
            checksCompleted:next.checks.length,findingsCount:deficiencies.length,
            criticalCount:deficiencies.filter(x=>x.severity==='CRITICAL').length,
            majorCount:deficiencies.filter(x=>x.severity==='MAJOR').length,
            aiGenerated:false,supervisor:null};
          next.completedAt=now();next.stage='REPORT_PENDING_REVIEW';break;
        }
        case 'RETURN_REPORT':{
          requireStage('REPORT_PENDING_REVIEW');
          if(reason.length<8)fails('SI_RETURN_REASON_REQUIRED');
          next.report.status='RETURNED';next.report.supervisor=str(actor,120);
          next.report.returnReason=reason;next.stage='REPORT_RETURNED';break;
        }
        case 'APPROVE_REPORT':{
          requireStage('REPORT_PENDING_REVIEW');
          if(reason.length<8)fails('SI_APPROVAL_REASON_REQUIRED');
          next.report.status='APPROVED';next.report.supervisor=str(actor,120);
          next.report.approvedAt=now();next.report.approvalReason=reason;
          next.stage='REPORT_APPROVED';break;
        }
        case 'ISSUE_ACTIONS':{
          requireStage('REPORT_APPROVED');
          const expected=new Set(next.findings.map(x=>x.id));
          if(!expected.size)fails('SI_NO_FINDINGS_TO_ACTION',409);
          if(!Array.isArray(data.actions)||data.actions.length!==expected.size)
            fails('SI_ACTIONS_REQUIRED');
          const got=new Set(data.actions.map(x=>x.findingId));
          if(got.size!==expected.size||[...got].some(x=>!expected.has(x)))
            fails('SI_ONE_ACTION_PER_FINDING_REQUIRED');
          next.actions=data.actions.map(x=>{
            const owner=str(x.owner,120),dueDate=str(x.dueDate,20);
            if(!owner||!/^\d{4}-\d\d-\d\d$/.test(dueDate))
              fails('SI_ACTION_OWNER_AND_DATE_REQUIRED');
            return {id:randomUUID(),findingId:x.findingId,owner,dueDate,
              instruction:str(x.instruction,900)||'Rectify documented deficiency',
              status:'OPEN',evidenceRefs:[],review:null,history:[]};
          });
          next.stage='ACTIONS_OPEN';break;
        }
        case 'SUBMIT_ACTION':{
          requireStage('ACTIONS_OPEN','FOLLOW_UP_PENDING');
          const item=next.actions.find(x=>x.id===data.actionId);
          if(!item||!['OPEN','REJECTED'].includes(item.status))
            fails('SI_ACTION_NOT_SUBMITTABLE',409);
          if(str(actor,120)!==item.owner)fails('SI_ACTION_OWNER_REQUIRED',403);
          if(!Array.isArray(data.evidenceRefs)||!data.evidenceRefs.length||
            data.evidenceRefs.length>12)
            fails('SI_CORRECTION_EVIDENCE_REQUIRED');
          item.evidenceRefs=data.evidenceRefs.map(x=>str(x,180)).filter(Boolean);
          if(!item.evidenceRefs.length)fails('SI_CORRECTION_EVIDENCE_REQUIRED');
          item.status='PENDING_VERIFICATION';item.history.push({at:now(),by:actor,event:'SUBMITTED'});
          break;
        }
        case 'VERIFY_ACTION':{
          requireStage('ACTIONS_OPEN','FOLLOW_UP_PENDING');
          const item=next.actions.find(x=>x.id===data.actionId);
          if(!item||item.status!=='PENDING_VERIFICATION'||!['ACCEPT','REJECT'].includes(data.decision)||
            reason.length<8)fails('SI_VERIFICATION_INVALID',409);
          item.status=data.decision==='ACCEPT'?'VERIFIED':'REJECTED';
          item.review={decision:data.decision,reason,by:str(actor,120),at:now()};
          item.history.push({at:now(),by:actor,event:item.status});
          if(next.actions.every(x=>x.status==='VERIFIED'))next.stage='FOLLOW_UP_PENDING';
          break;
        }
        case 'RECORD_FOLLOW_UP':{
          requireStage('FOLLOW_UP_PENDING');
          if(!['DESK_REVIEW','ON_SITE'].includes(data.mode)||
            !['PASS','FAIL'].includes(data.result)||reason.length<8)
            fails('SI_FOLLOW_UP_FIELDS_REQUIRED');
          next.followUps.push({id:randomUUID(),mode:data.mode,result:data.result,
            note:reason,inspector:str(actor,120),at:now(),
            evidenceRefs:Array.isArray(data.evidenceRefs)?
              data.evidenceRefs.map(x=>str(x,180)).filter(Boolean).slice(0,15):[]});
          if(data.result==='PASS')next.stage='READY_TO_CLOSE';
          else{
            // Failed follow-up reopens every deficiency for renewed corrections.
            // Prevents the otherwise inescapable FOLLOW_UP_PENDING state.
            for(const item of next.actions){
              item.status='REJECTED';
              item.review={decision:'REJECT',reason,
                by:str(actor,120),at:now()};
              item.history.push({at:now(),by:actor,event:'FOLLOW_UP_FAILED'});
            }
            next.stage='ACTIONS_OPEN';
          }
          break;
        }
        case 'CLOSE':{
          requireStage('REPORT_APPROVED','READY_TO_CLOSE');
          if(reason.length<8)fails('SI_CLOSE_REASON_REQUIRED');
          if(next.findings.length&&(next.actions.length!==next.findings.length||
            next.actions.some(x=>x.status!=='VERIFIED')||
            !next.followUps.some(x=>x.result==='PASS')))
            fails('SI_CORRECTIVE_ACTIONS_NOT_CLOSED',409);
          next.stage='CLOSED';next.closedAt=now();
          next.closure={by:str(actor,120),reason,at:now(),
            nmcRiskRecalculated:false,regulatoryEnforcementTriggered:false,
            officialComplianceUpdated:false};break;
        }
        default:fails('SI_ACTION_UNSUPPORTED');
      }
      next.version=(previous?.version||0)+1;next.updatedAt=now();
      next.audit.push({id:randomUUID(),version:next.version,action,
        actor:str(actor,120),at:now(),reason:str(reason,500)});
      await this.persist(id,previous,next,action,actor,reason);
      return {status:'ok',record:next};
    }finally{this.active.delete(id);}
  }
}
