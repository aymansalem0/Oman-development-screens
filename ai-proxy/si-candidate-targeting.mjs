/**
 * Smart Inspection Steps 00-04: central source-event, targeting and officer decisions.
 * POC fixtures are NOT official PSC/service facts. NMC referrals are read from the
 * human-approved case workspace. Never call Airia or invent missing risk scores.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

const copy=x=>JSON.parse(JSON.stringify(x));
const iso=()=>new Date().toISOString();
const hash=x=>createHash('sha256').update(x).digest('hex');
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const isImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const safeText=(x,n=120)=>typeof x==='string'&&x.trim().length&&x.trim().length<=n?x.trim():null;
const allowedRegimes=['FOCUSED_INSPECTION','FOLLOW_UP_INSPECTION','PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'];
const validSource=['SERVICE_REQUEST','PSC_PORT_CALL'];
const defaultRules=Object.freeze({riskPriorityThreshold:65,includeMissingRiskInReview:true});
function validateRules(value){
  if(!value||!Number.isInteger(value.riskPriorityThreshold)||
    value.riskPriorityThreshold<0||value.riskPriorityThreshold>100||
    value.includeMissingRiskInReview!==true)return null;
  return {riskPriorityThreshold:value.riskPriorityThreshold,
    includeMissingRiskInReview:true};
}
function jsonWrite(path,data){
  mkdirSync(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
  renameSync(tmp,path);
}
export class SiTargetingError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export class SiCandidateTargeting{
  constructor({mode='json',oracleRepository=null,cases,riskPolicy,bundles=[],
    file=process.env.SI_TARGETING_STORE_PATH||'/data/si-candidate-targeting.json'}={}){
    if(!['json','oracle'].includes(mode)||!cases||!riskPolicy||!Array.isArray(bundles))
      throw Error('SI_TARGETING_CONFIG_INVALID');
    this.mode=mode;this.oracle=oracleRepository;this.cases=cases;
    this.riskPolicy=riskPolicy;this.file=file;
    this.bundles=bundles.filter(x=>isImo(String(x.imo))&&x.active!==false&&x.active!=='N');
    if(new Set(this.bundles.map(x=>String(x.imo))).size!==this.bundles.length)
      throw Error('SI_TARGETING_DUPLICATE_FLEET');
    this.imoSet=new Set(this.bundles.map(x=>String(x.imo)));
    this.fleetSnapshotId='SI-FLEET-'+hash(this.bundles.map(v=>String(v.imo)).sort().join('|')).slice(0,16);
    this.ready=mode==='json';
  }
  _load(){
    if(!existsSync(this.file))return {events:[],decisions:[],cases:[],
      rules:[{version:1,config:copy(defaultRules),publishedBy:'SYSTEM',
        publishedAt:iso(),reason:'Conservative POC source-review baseline'}]};
    const data=JSON.parse(readFileSync(this.file,'utf8'));
    if(!Array.isArray(data.events)||!Array.isArray(data.decisions)||
      !Array.isArray(data.cases)||!Array.isArray(data.rules)||!data.rules.length)
      throw new SiTargetingError('SI_STORE_INVALID',503);
    return data;
  }
  _save(x){jsonWrite(this.file,x);}
  async _db(work){
    if(!this.oracle?.pool)throw new SiTargetingError('SI_ORACLE_NOT_READY',503);
    const con=await this.oracle.pool.getConnection();
    try{return await work(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){this._load();this.ready=true;return;}
    try{
      await this._db(async con=>{
        const tables=await con.execute(
          "SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('SI_CANDIDATE_EVENT','SI_CANDIDATE_DECISION','SI_INSPECTION_CASE','SI_TARGETING_RULE_VERSION')",
          [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        if(tables.rows.length!==4)throw new SiTargetingError('SI_MIGRATION_009_REQUIRED',503);
        const current=await con.execute('SELECT COUNT(*) AS N FROM SI_TARGETING_RULE_VERSION',
          [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        if(Number(current.rows[0].N)===0){
          try{
            await con.execute(`INSERT INTO SI_TARGETING_RULE_VERSION
              (VERSION_NO,CONFIG_JSON,PUBLISHED_BY,REASON)
              VALUES (1,:config,'SYSTEM','Conservative POC source-review baseline')`,
              {config:clob(defaultRules)});
            await con.commit();
          }catch(e){await con.rollback();if(e.code!=='ORA-00001')throw e;}
        }
      });
      this.ready=true;
    }catch(e){this.ready=false;throw e;}
  }
  assertReady(){if(!this.ready)throw new SiTargetingError('SI_MIGRATION_009_REQUIRED',503);}
  async _state(){
    this.assertReady();
    if(this.mode==='json')return this._load();
    return this._db(async con=>{
      const tables={
        events:'SI_CANDIDATE_EVENT',decisions:'SI_CANDIDATE_DECISION',
        cases:'SI_INSPECTION_CASE',rules:'SI_TARGETING_RULE_VERSION'
      };
      const result={};
      for(const [key,table] of Object.entries(tables)){
        const query=key==='rules'?'SELECT VERSION_NO,CONFIG_JSON,PUBLISHED_BY,REASON,TO_CHAR(PUBLISHED_AT AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"\') AS PUBLISHED_AT FROM SI_TARGETING_RULE_VERSION ORDER BY VERSION_NO':
          `SELECT DOC_JSON FROM ${table}`;
        const rows=await con.execute(query,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        result[key]=rows.rows.map(r=>key==='rules'?{
          version:r.VERSION_NO,config:JSON.parse(r.CONFIG_JSON),publishedBy:r.PUBLISHED_BY,
          reason:r.REASON,publishedAt:r.PUBLISHED_AT}:JSON.parse(r.DOC_JSON));
      }
      return result;
    });
  }
  async policy(){
    const state=await this._state();return copy(state.rules.at(-1));
  }
  _validateEvent(input){
    if(!input||!validSource.includes(input.sourceType)||!isImo(input.imo)||
      !this.imoSet.has(input.imo)||!allowedRegimes.includes(input.requestedRegime)||
      !safeText(input.sourceEventId,120)||!safeText(input.sourceReference,120)||
      !safeText(input.port,120)||input.provenance!=='POC_SIMULATOR'||
      !['UNVERIFIED','SOURCE_REVIEWED'].includes(input.sourceApprovalStatus)||
      (input.sourceType==='PSC_PORT_CALL'&&input.requestedRegime!=='PORT_STATE_CONTROL')||
      (input.sourceType==='SERVICE_REQUEST'&&input.requestedRegime!=='UAE_SERVICE_INSPECTION'))
      throw new SiTargetingError('SI_EVENT_VALIDATION_FAILED',422);
    return {sourceType:input.sourceType,sourceEventId:input.sourceEventId.trim(),
      sourceReference:input.sourceReference.trim(),imo:input.imo,requestedRegime:input.requestedRegime,
      port:input.port.trim(),eta:typeof input.eta==='string'?input.eta.slice(0,32):null,
      sourceApprovalStatus:input.sourceApprovalStatus,
      provenance:'POC_SIMULATOR',evidenceIds:Array.isArray(input.evidenceIds)?
        input.evidenceIds.filter(x=>typeof x==='string'&&x.length<=120).slice(0,20):[],
      note:safeText(input.note,500)||'',createdBy:safeText(input.createdBy)||'POC_OPERATOR'};
  }
  async receiveEvent(input){
    const cleaned=this._validateEvent(input),eventKey=hash(cleaned.sourceType+'|'+cleaned.sourceEventId+
      '|'+cleaned.requestedRegime);
    const state=await this._state(),found=state.events.find(x=>x.eventKey===eventKey);
    if(found){
      if(JSON.stringify(found.payload)!==JSON.stringify(cleaned))
        throw new SiTargetingError('SI_EVENT_IDEMPOTENCY_CONFLICT',409);
      return {event:found,replayed:true};
    }
    const event={eventKey,id:randomUUID(),createdAt:iso(),payload:cleaned};
    if(this.mode==='json'){
      state.events.push(event);this._save(state);return {event,replayed:false};
    }
    try{
      await this._db(async con=>{
        await con.execute(`INSERT INTO SI_CANDIDATE_EVENT
          (EVENT_KEY,IMO,SOURCE_TYPE,REGIME,DOC_JSON)
          VALUES (:key,:imo,:type,:regime,:doc)`,{
          key:eventKey,imo:cleaned.imo,type:cleaned.sourceType,
          regime:cleaned.requestedRegime,doc:clob(event)});
        await con.commit();
      });
    }catch(e){
      if(e.code==='ORA-00001')return this.receiveEvent(input);
      throw e;
    }
    return {event,replayed:false};
  }
  _eventsForNmc(referrals){
    return referrals.filter(r=>r.caseStatus!=='RESOLVED'&&
      ['PENDING_SCHEDULING','SCHEDULED'].includes(r.status)&&isImo(r.imo)&&
      this.imoSet.has(r.imo)).map(r=>({
        eventKey:hash('NMC_CASE|'+r.id+'|FOCUSED_INSPECTION'),
        id:r.id,createdAt:r.createdAt,
        payload:{sourceType:'NMC_CASE',sourceEventId:r.id,
          sourceReference:r.caseId,imo:r.imo,requestedRegime:'FOCUSED_INSPECTION',
          port:r.port||'',eta:r.scheduledAt||null,
          sourceApprovalStatus:'APPROVED',provenance:'NMC_HUMAN_APPROVED',
          evidenceIds:r.evidenceIds||[],note:r.reason||'',nmcStatus:r.status,
          nmcCaseId:r.caseId,sourceAssessmentId:r.sourceAssessmentId}
      }));
  }
  _evaluate(state,referrals,risks,rules){
    const byImo=new Map(this.bundles.map(x=>[String(x.imo),x]));
    const groups=new Map();
    const events=[...state.events,...this._eventsForNmc(referrals)];
    for(const e of events){
      const p=e.payload;if(!byImo.has(p.imo))continue;
      const groupKey=hash(p.imo+'|'+p.requestedRegime);
      if(!groups.has(groupKey))groups.set(groupKey,{key:groupKey,imo:p.imo,
        regime:p.requestedRegime,events:[]});
      groups.get(groupKey).events.push(e);
    }
    const decisions=[...state.decisions].sort((a,b)=>a.at.localeCompare(b.at));
    const last=new Map(decisions.map(d=>[d.candidateKey,d]));
    const cases=new Map(state.cases.map(c=>[c.candidateKey,c]));
    const list=[...groups.values()].map(group=>{
      const bundle=byImo.get(group.imo),vessel=bundle.inlineContext?.vessel||bundle,
        risk=risks.get(group.imo)||null,
        nmc=group.events.some(e=>e.payload.sourceType==='NMC_CASE'),
        booked=group.events.some(e=>e.payload.nmcStatus==='SCHEDULED'),
        lastDecision=last.get(group.key)||null,inspectionCase=cases.get(group.key)||null;
      const eligibility=nmc?'MANDATORY':'MANUAL_REVIEW';
      const priority=risk?.riskScore>=rules.riskPriorityThreshold?'PRIORITY':
        risk?'STANDARD':'RISK_UNASSESSED';
      const reasons=nmc?['NMC_HUMAN_APPROVED_REFERRAL']:
        ['SIMULATED_EXTERNAL_SOURCE_MANUAL_REVIEW'];
      if(!risk)reasons.push('NO_SAVED_NMC_RISK');
      if(booked)reasons.push('NMC_ALREADY_SCHEDULED');
      const status=inspectionCase?'INSPECTION_CREATED':booked?'EXTERNALLY_SCHEDULED':
        lastDecision?.action==='DEFER'?'DEFERRED':
        lastDecision?.action==='REJECT'?'REJECTED':'PENDING_REVIEW';
      return {key:group.key,imo:group.imo,
        vesselName:vessel.name||vessel.vesselName||vessel.shipName||('IMO '+group.imo),
        flag:vessel.flag||'',vesselType:vessel.vesselType||vessel.type||'',
        regime:group.regime,eligibility,priority,reasons,status,
        currentRisk:risk?{score:risk.riskScore,level:risk.riskLevel,
          assessmentId:risk.sourceAssessmentId,policyRevision:risk.policyRevision}:null,
        events:group.events.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(e=>({
          eventKey:e.eventKey,sourceType:e.payload.sourceType,
          sourceEventId:e.payload.sourceEventId,sourceReference:e.payload.sourceReference,
          provenance:e.payload.provenance,approval:e.payload.sourceApprovalStatus,
          evidenceIds:e.payload.evidenceIds})),
        inspectionCase,lastDecision};
    }).sort((a,b)=>
      (a.status==='PENDING_REVIEW'?0:1)-(b.status==='PENDING_REVIEW'?0:1)||
      (b.currentRisk?.score??-1)-(a.currentRisk?.score??-1)||a.imo.localeCompare(b.imo));
    return list;
  }
  async dashboard(){
    const state=await this._state(),referrals=await this.cases.listInspectionRequests();
    if(!this.riskPolicy.ready)throw new SiTargetingError('SI_RISK_POLICY_NOT_READY',503);
    const projection=await this.riskPolicy.projectCurrent();
    const risks=new Map(projection.projections.filter(p=>p?.sourceAssessmentId).map(p=>[p.imo,p]));
    const policy=state.rules.at(-1),candidates=this._evaluate(state,referrals,risks,policy.config);
    const summary={evaluatedPopulation:this.bundles.length,assessedRiskVessels:risks.size,
      candidates:candidates.length,pendingReview:candidates.filter(x=>x.status==='PENDING_REVIEW').length,
      inspectionsCreated:candidates.filter(x=>x.status==='INSPECTION_CREATED').length,
      externalScheduled:candidates.filter(x=>x.status==='EXTERNALLY_SCHEDULED').length,
      bySource:Object.fromEntries(['NMC_CASE','SERVICE_REQUEST','PSC_PORT_CALL'].map(s=>
        [s,candidates.filter(x=>x.events.some(e=>e.sourceType===s)).length]))};
    return {status:'ok',source:'PERSISTED_NMC_AND_POC_EVENTS',fleetSnapshotId:this.fleetSnapshotId,
      evaluatedAt:iso(),policy:{version:policy.version,config:policy.config},
      riskPolicyRevision:projection.policyRevision,summary,candidates};
  }
  async previewRules(config){
    const parsed=validateRules(config);
    if(!parsed)throw new SiTargetingError('SI_RULES_INVALID',422);
    const data=await this.dashboard(),newThreshold=parsed.riskPriorityThreshold;
    const impacted=data.candidates.filter(c=>c.currentRisk&&
      (c.currentRisk.score>=data.policy.config.riskPriorityThreshold)!==
      (c.currentRisk.score>=newThreshold));
    return {status:'PREVIEW',fleetSnapshotId:data.fleetSnapshotId,
      evaluatedPopulation:data.summary.evaluatedPopulation,rulesetVersion:data.policy.version,
      affectedImos:[...new Set(impacted.map(c=>c.imo))],affectedCandidateCount:impacted.length,
      unevaluatedRiskVessels:data.summary.evaluatedPopulation-data.summary.assessedRiskVessels,
      warning:'PRIORITY_ONLY_NO_LEGAL_ELIGIBILITY_CHANGE_NO_AI'};
  }
  async publishRules(request){
    const config=validateRules(request?.config),actor=safeText(request?.publishedBy),
      reason=safeText(request?.reason,500);
    if(!config||!actor||!reason||reason.length<8)
      throw new SiTargetingError('SI_POLICY_INPUT_INVALID',422);
    const state=await this._state(),latest=state.rules.at(-1);
    if(request.expectedVersion!==latest.version)
      throw new SiTargetingError('SI_POLICY_VERSION_CONFLICT',409);
    const next={version:latest.version+1,config,publishedBy:actor,reason,
      publishedAt:iso()};
    if(this.mode==='json'){state.rules.push(next);this._save(state);}
    else await this._db(async con=>{
      try{
        await con.execute(`INSERT INTO SI_TARGETING_RULE_VERSION
         (VERSION_NO,CONFIG_JSON,PUBLISHED_BY,REASON)
         VALUES (:version,:config,:publisher,:reason)`,{
          version:next.version,config:clob(config),publisher:actor,reason});
        await con.commit();
      }catch(e){if(e.code==='ORA-00001')
        throw new SiTargetingError('SI_POLICY_VERSION_CONFLICT',409);throw e;}
    });
    return next;
  }
  async decide(input){
    if(!['APPROVE','DEFER','REJECT'].includes(input?.action)||
      !safeText(input?.candidateKey,100)||!safeText(input?.actor)||
      !safeText(input?.note,500)||!isImo(input?.imo))
      throw new SiTargetingError('SI_DECISION_INVALID',422);
    const data=await this.dashboard(),candidate=data.candidates.find(x=>
      x.key===input.candidateKey&&x.imo===input.imo);
    if(!candidate)throw new SiTargetingError('SI_CANDIDATE_NOT_FOUND',404);
    if(candidate.status==='INSPECTION_CREATED'||candidate.status==='EXTERNALLY_SCHEDULED')
      throw new SiTargetingError('SI_CANDIDATE_ALREADY_HANDLED',409);
    const decision={id:randomUUID(),candidateKey:candidate.key,imo:candidate.imo,
      action:input.action,actor:input.actor.trim(),note:input.note.trim(),
      at:iso(),rulesetVersion:data.policy.version,fleetSnapshotId:data.fleetSnapshotId,
      sourceEventKeys:candidate.events.map(x=>x.eventKey)};
    const inspectionCase=input.action==='APPROVE'?{
      id:randomUUID(),candidateKey:candidate.key,imo:candidate.imo,regime:candidate.regime,
      status:'CREATED',createdAt:decision.at,approvedBy:decision.actor,
      decisionId:decision.id,rulesetVersion:decision.rulesetVersion,
      sourceEventKeys:decision.sourceEventKeys,nmcReferralId:candidate.events.find(x=>
        x.sourceType==='NMC_CASE')?.sourceEventId||null,
      evidenceIds:[...new Set(candidate.events.flatMap(x=>x.evidenceIds||[]))],
      riskAssessmentId:candidate.currentRisk?.assessmentId||null,
      riskAtApproval:candidate.currentRisk||null,
      provenance:'POC_HUMAN_APPROVED_NOT_OFFICIAL_INSPECTION_REPORT'}:null;
    if(this.mode==='json'){
      const state=this._load();
      if(state.cases.some(c=>c.candidateKey===candidate.key))
        throw new SiTargetingError('SI_INSPECTION_CASE_EXISTS',409);
      state.decisions.push(decision);
      if(inspectionCase)state.cases.push(inspectionCase);
      this._save(state);
    }else await this._db(async con=>{
      try{
        // Unique CANDIDATE_KEY on SI_INSPECTION_CASE blocks duplicate approvals.
        if(inspectionCase)await con.execute(`INSERT INTO SI_INSPECTION_CASE
          (CASE_ID,CANDIDATE_KEY,IMO,DOC_JSON) VALUES (:id,:key,:imo,:doc)`,{
          id:inspectionCase.id,key:inspectionCase.candidateKey,
          imo:inspectionCase.imo,doc:clob(inspectionCase)});
        await con.execute(`INSERT INTO SI_CANDIDATE_DECISION
          (DECISION_ID,CANDIDATE_KEY,IMO,DOC_JSON) VALUES (:id,:key,:imo,:doc)`,{
          id:decision.id,key:decision.candidateKey,imo:decision.imo,doc:clob(decision)});
        await con.commit();
      }catch(e){
        await con.rollback();
        if(e.code==='ORA-00001')throw new SiTargetingError('SI_INSPECTION_CASE_EXISTS',409);
        throw e;
      }
    });
    return {status:'ok',decision,inspectionCase};
  }
}
