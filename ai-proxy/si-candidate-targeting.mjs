/**
 * Smart Inspection Steps 00-04: central source-event, targeting and officer decisions.
 * POC fixtures are NOT official PSC/service facts. NMC referrals are read from the
 * human-approved case workspace. Never call Airia or invent missing risk scores.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {atomicJsonWrite} from './atomic-json-store.mjs';
import oracledb from 'oracledb';
import {getSiRankingPolicy,compareInspections} from './si-inspection-ranking.mjs';

const copy=x=>JSON.parse(JSON.stringify(x));
const iso=()=>new Date().toISOString();
const hash=x=>createHash('sha256').update(x).digest('hex');
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const isImo=x=>typeof x==='string'&&/^\d{7}$/.test(x);
const safeText=(x,n=120)=>typeof x==='string'&&x.trim().length&&x.trim().length<=n?x.trim():null;
const allowedRegimes=['FOCUSED_INSPECTION','FOLLOW_UP_INSPECTION','PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'];
const validSource=['SERVICE_REQUEST','PSC_PORT_CALL'];
/** Source trigger scores are the ONLY configurable inspection-plan priorities.
 * Score is 0–100 for each source; values are NOT weights to normalize.
 * NMC approved referrals remain in the legally protected first tier.
 * Keep the older P01 read-only adapter for saved historical runs only.
 */
export const SI_SOURCE_PRIORITY_DEFAULT=Object.freeze({
  NMC_CASE:100,SERVICE_REQUEST:100,PSC_PORT_CALL:20
});
export function getSiSourceScores(config){
  const scores=config?.sourceTriggerScores??
    config?.prioritization?.sourceTriggerScores??SI_SOURCE_PRIORITY_DEFAULT;
  const keys=Object.keys(SI_SOURCE_PRIORITY_DEFAULT);
  if(!scores||typeof scores!=='object'||Array.isArray(scores)||
     Object.keys(scores).sort().join('|')!==[...keys].sort().join('|')||
     keys.some(key=>!Number.isInteger(scores[key])||scores[key]<0||scores[key]>100))
    throw new SiTargetingError('SI_SOURCE_TRIGGER_SCORES_INVALID',422);
  return Object.fromEntries(keys.map(key=>[key,scores[key]]));
}
export const SI_P01_DEFAULT=Object.freeze({
  weights:{risk:30,trigger:25,history:20,deadline:15,urgency:10},
  approvedNmcFirst:true,missingRiskAction:'REVIEW_REQUIRED',
  sourceTriggerScores:SI_SOURCE_PRIORITY_DEFAULT
});
export function getSiPrioritySettings(config){
  // Historical SI-P01 GET/preview remains readable; none of its weights
  // controls the current candidate-plan selection or ranking.
  const p=config?.prioritization||SI_P01_DEFAULT;
  const weights=p.weights||SI_P01_DEFAULT.weights;
  return {weights,approvedNmcFirst:true,missingRiskAction:'REVIEW_REQUIRED',
    sourceTriggerScores:getSiSourceScores(config)};
}
// Eligibility is governed by source workflows (approved NMC, actionable
// Service Request, selected PSC quota), NOT a numerical source priority.
const defaultRules=Object.freeze({
  ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}
});
function validateRules(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).join('|')!=='ranking')return null;
  try{return {ranking:getSiRankingPolicy(value)};}catch{return null;}
}
export class SiTargetingError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export class SiCandidateTargeting{
  constructor({mode='json',oracleRepository=null,cases,riskPolicy,bundles=[],
    loadIncidentSignals=null,
    file=process.env.SI_TARGETING_STORE_PATH||'/data/si-candidate-targeting.json'}={}){
    if(!['json','oracle'].includes(mode)||!cases||!riskPolicy||!Array.isArray(bundles))
      throw Error('SI_TARGETING_CONFIG_INVALID');
    this.mode=mode;this.oracle=oracleRepository;this.cases=cases;
    this.riskPolicy=riskPolicy;this.file=file;
    this.loadIncidentSignals=typeof loadIncidentSignals==='function'?loadIncidentSignals:null;
    this.bundles=bundles.filter(x=>isImo(String(x.imo))&&x.active!==false&&x.active!=='N');
    if(new Set(this.bundles.map(x=>String(x.imo))).size!==this.bundles.length)
      throw Error('SI_TARGETING_DUPLICATE_FLEET');
    this.imoSet=new Set(this.bundles.map(x=>String(x.imo)));
    this.fleetSnapshotId='SI-FLEET-'+hash(this.bundles.map(v=>String(v.imo)).sort().join('|')).slice(0,16);
    this.ready=mode==='json';
    this.pscSelection=null; // Injected targeting gate; source imports stay in PSC pool.
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
  _save(x){atomicJsonWrite(this.file,x);}
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
  /**
   * Full approved-case registry: historical and closed cases must remain visible
   * even when a source referral drops out of the live targeting queue.
   */
  async inspectionCaseRegistry(){
    const state=await this._state();
    return {cases:copy(state.cases),events:copy(state.events)};
  }
  /** Only business-approved SI cases may enter the AI dossier workflow. */
  async inspectionCase(id){
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))
      throw new SiTargetingError('SI_CASE_ID_INVALID',422);
    this.assertReady();
    if(this.mode==='json')return copy(this._load().cases.find(c=>c.id===id)||null);
    return this._db(async con=>{
      const r=await con.execute(
        'SELECT DOC_JSON FROM SI_INSPECTION_CASE WHERE CASE_ID=:id',
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
    });
  }
  _validateEvent(input){
    if(!input||!validSource.includes(input.sourceType)||!isImo(input.imo)||
      !this.imoSet.has(input.imo)||!allowedRegimes.includes(input.requestedRegime)||
      !safeText(input.sourceEventId,120)||!safeText(input.sourceReference,120)||
      !safeText(input.port,120)||input.provenance!=='POC_SIMULATOR'||
      !['UNVERIFIED','SOURCE_REVIEWED','SOURCE_FINAL'].includes(input.sourceApprovalStatus)||
      (input.sourceType==='PSC_PORT_CALL'&&input.requestedRegime!=='PORT_STATE_CONTROL')||
      (input.sourceType==='SERVICE_REQUEST'&&input.requestedRegime!=='UAE_SERVICE_INSPECTION'))
      throw new SiTargetingError('SI_EVENT_VALIDATION_FAILED',422);
    return {sourceType:input.sourceType,sourceEventId:input.sourceEventId.trim(),
      sourceReference:input.sourceReference.trim(),imo:input.imo,requestedRegime:input.requestedRegime,
      port:input.port.trim(),eta:typeof input.eta==='string'?input.eta.slice(0,32):null,
      // Imported ETD is final by POC business rule and has no standalone
      // review step. Original row remains visibly POC_SIMULATOR.
      reportedDepartureLocal:typeof input.reportedDepartureLocal==='string'&&
        /^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(input.reportedDepartureLocal)
        ?input.reportedDepartureLocal:null,
      // SOURCE_FINAL uses source-provided ETD immediately; SOURCE_REVIEWED
      // remains supported for legacy rows. ETA is NEVER treated as ETD.
      departureAt:['SOURCE_FINAL','SOURCE_REVIEWED'].includes(input.sourceApprovalStatus)&&
        typeof input.departureAt==='string'&&
        /^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(input.departureAt)&&
        Number.isFinite(Date.parse(input.departureAt))?input.departureAt:null,
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
  _evaluate(state,referrals,risks,rules,selectedPscKeys=null){
    const byImo=new Map(this.bundles.map(x=>[String(x.imo),x]));
    const groups=new Map();
    const events=[...state.events,...this._eventsForNmc(referrals)];
    for(const e of events){
      const p=e.payload;if(!byImo.has(p.imo))continue;
      if(p.sourceType==='PSC_PORT_CALL'&&selectedPscKeys){
        // Keep pre-migration PSC approvals/cases visible as historical
        // workflows; newly imported PSC events require explicit selection.
        const legacyKey=hash(p.imo+'|'+p.requestedRegime);
        // A historical (pre-quota) case must not automatically unlock
        // newly arriving Port Calls for the same vessel and regime.
        const legacyHandled=state.cases.some(c=>c.candidateKey===legacyKey&&
          e.createdAt<=(c.createdAt||''))||
          state.decisions.some(d=>d.candidateKey===legacyKey&&
          e.createdAt<=(d.at||''));
        if(!selectedPscKeys.has(e.eventKey)&&!legacyHandled)continue;
      }
      const groupKey=hash(p.imo+'|'+p.requestedRegime);
      if(!groups.has(groupKey))groups.set(groupKey,{key:groupKey,imo:p.imo,
        regime:p.requestedRegime,events:[]});
      groups.get(groupKey).events.push(e);
    }
    const decisions=[...state.decisions].sort((a,b)=>a.at.localeCompare(b.at));
    const last=new Map(decisions.map(d=>[d.candidateKey,d]));
    const cases=new Map(state.cases.flatMap(c=>
      [...new Set([c.candidateKey,...(c.candidateKeys||[])])].map(k=>[k,c])));
    const list=[...groups.values()].map(group=>{
      // Repeat visits are legal for a NEW source event even on the same
      // physical vessel and inspection regime. Never re-use an already
      // approved eventKey merely because it has the same IMO.
      const priorCases=state.cases.filter(c=>c.imo===group.imo&&
        (c.regimes||[c.regime]).includes(group.regime));
      const handledEvents=new Set(priorCases.flatMap(c=>c.sourceEventKeys||[]));
      const newEvents=group.events.filter(e=>!handledEvents.has(e.eventKey));
      const repeat=priorCases.length>0&&newEvents.length>0;
      const key=repeat?hash('SI_REPEAT|'+group.imo+'|'+group.regime+'|'+
        newEvents.map(e=>e.eventKey).sort().join('|')):group.key;
      // A completed referral stays visible as handled, but a separate new
      // referral is projected as PENDING_REVIEW with its own candidate key.
      const activeEvents=repeat?newEvents:group.events;
      const historicalCase=priorCases.at(-1)||null;
      const inspectionCase=repeat?null:(cases.get(key)||historicalCase);
      const bundle=byImo.get(group.imo),vessel=bundle.inlineContext?.vessel||bundle,
        risk=risks.get(group.imo)||null,
        nmc=activeEvents.some(e=>e.payload.sourceType==='NMC_CASE'),
        booked=activeEvents.some(e=>e.payload.nmcStatus==='SCHEDULED'),
        lastDecision=last.get(key)||null;
      const eligibility=nmc?'MANDATORY':'MANUAL_REVIEW';
      // Eligibility and operational execution order are independent.
      // Never turn vessel risk, source weight or ET(A) into an ETD.
      const priority='SOURCE_ELIGIBLE';
      const reasons=nmc?['NMC_HUMAN_APPROVED_REFERRAL']:
        ['SIMULATED_EXTERNAL_SOURCE_MANUAL_REVIEW'];
      if(!risk)reasons.push('NO_SAVED_NMC_RISK');
      if(booked)reasons.push('NMC_ALREADY_SCHEDULED');
      const status=inspectionCase?'INSPECTION_CREATED':booked?'EXTERNALLY_SCHEDULED':
        lastDecision?.action==='DEFER'?'DEFERRED':
        lastDecision?.action==='REJECT'?'REJECTED':'PENDING_REVIEW';
      return {key,imo:group.imo,
        vesselName:vessel.name||vessel.vesselName||vessel.shipName||('IMO '+group.imo),
        flag:vessel.flag||'',vesselType:vessel.vesselType||vessel.type||'',
        regime:group.regime,eligibility,priority,reasons,status,
        currentRisk:risk?{score:risk.riskScore,level:risk.riskLevel,
          assessmentId:risk.sourceAssessmentId,policyRevision:risk.policyRevision}:null,
        events:activeEvents.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(e=>({
          eventKey:e.eventKey,sourceType:e.payload.sourceType,
          sourceEventId:e.payload.sourceEventId,sourceReference:e.payload.sourceReference,
          provenance:e.payload.provenance,approval:e.payload.sourceApprovalStatus,
          evidenceIds:e.payload.evidenceIds,
          importFile:e.sourceImport?.fileName||null,
          importBatchId:e.sourceImport?.batchId||null,
          importExcelRow:e.sourceImport?.excelRow||null,
          port:e.payload.port||null,
          eta:e.payload.eta||null,
          reportedDepartureLocal:e.payload.reportedDepartureLocal||null,
          departureAt:e.payload.departureAt||null,
          departureVerified:['SOURCE_FINAL','SOURCE_REVIEWED'].includes(e.payload.sourceApprovalStatus)&&
            Boolean(e.payload.departureAt),
          departureAuthority:e.payload.sourceApprovalStatus==='SOURCE_FINAL'?
            'SOURCE_FINAL_NO_DATE_APPROVAL':e.payload.sourceApprovalStatus,
          contextNote:e.payload.note||null,
          originalSourceRow:e.sourceImport?.sourceRow||null})),
        inspectionCase,lastDecision};
    }).sort((a,b)=>
      (a.status==='PENDING_REVIEW'?0:1)-(b.status==='PENDING_REVIEW'?0:1)||
      (b.currentRisk?.score??-1)-(a.currentRisk?.score??-1)||a.imo.localeCompare(b.imo));
    return list;
  }
  /**
   * One display record per physical vessel (IMO). Never collapse underlying
   * inspection-regime candidates, their case IDs or independent officer
   * decisions: PSC and Service Requests are different statutory workflows.
   * A single vessel may have multiple source events and multiple actions.
   */
  _vesselCandidates(candidates,incidentSignals=new Map()){
    const vessels=new Map();
    for(const c of candidates){
      let item=vessels.get(c.imo);
      if(!item){
        item={imo:c.imo,vesselName:c.vesselName,flag:c.flag,
          vesselType:c.vesselType,currentRisk:c.currentRisk,
          departureAt:null,departureVerified:false,departureStatus:'MISSING',
          incidentSeverity:null,incidentHumanReviewed:false,incidentEvidenceRef:null,
          candidateKeys:[],regimes:[],sourceTypes:[],sourceEvents:[],
          workflows:[],pendingWorkflows:0,createdWorkflows:0,
          scheduledWorkflows:0,highestPriority:'RISK_UNASSESSED',
          eligibility:'MANUAL_REVIEW'};
        vessels.set(c.imo,item);
      }
      item.candidateKeys.push(c.key);
      if(!item.regimes.includes(c.regime))item.regimes.push(c.regime);
      item.workflows.push({candidateKey:c.key,regime:c.regime,
        status:c.status,eligibility:c.eligibility,priority:c.priority,
        eventCount:c.events.length,
        inspectionCaseId:c.inspectionCase?.id||null});
      if(c.status==='PENDING_REVIEW')item.pendingWorkflows++;
      if(c.status==='INSPECTION_CREATED')item.createdWorkflows++;
      if(c.status==='EXTERNALLY_SCHEDULED')item.scheduledWorkflows++;
      if(c.priority==='PRIORITY')item.highestPriority='PRIORITY';
      else if(c.priority==='STANDARD'&&item.highestPriority!=='PRIORITY')
        item.highestPriority='STANDARD';
      if(c.eligibility==='MANDATORY')item.eligibility='MANDATORY';
      for(const e of c.events){
        if(!item.sourceTypes.includes(e.sourceType))item.sourceTypes.push(e.sourceType);
        if(!item.sourceEvents.some(existing=>existing.eventKey===e.eventKey))
          item.sourceEvents.push(e);
      }
    }
    const sourceOrder=['NMC_CASE','SERVICE_REQUEST','PSC_PORT_CALL'];
    const regimeOrder=['FOCUSED_INSPECTION','UAE_SERVICE_INSPECTION',
      'PORT_STATE_CONTROL','FOLLOW_UP_INSPECTION'];
    for(const item of vessels.values()){
      item.sourceTypes.sort((a,b)=>sourceOrder.indexOf(a)-sourceOrder.indexOf(b));
      item.regimes.sort((a,b)=>regimeOrder.indexOf(a)-regimeOrder.indexOf(b));
      item.workflows.sort((a,b)=>regimeOrder.indexOf(a.regime)-regimeOrder.indexOf(b.regime));
      item.sourceEvents.sort((a,b)=>sourceOrder.indexOf(a.sourceType)-
        sourceOrder.indexOf(b.sourceType)||
        a.sourceReference.localeCompare(b.sourceReference));
      const departures=item.sourceEvents.filter(e=>e.departureVerified&&
          typeof e.departureAt==='string'&&Number.isFinite(Date.parse(e.departureAt))&&
          Date.parse(e.departureAt)>=Date.now()).sort((a,b)=>
            Date.parse(a.departureAt)-Date.parse(b.departureAt));
      // A ship can have multiple saved MSW source events, including legacy
      // imports. Conflicting active ETDs/ports must NEVER be silently ranked
      // using the earliest arbitrary value.
      const distinctDepartures=new Set(departures.map(e=>
        new Date(Date.parse(e.departureAt)).toISOString()+'|'+
        String(e.port||'').trim().toUpperCase()));
      if(distinctDepartures.size>1){
        item.departureStatus='CONFLICT';
        item.departureAt=null;item.departureVerified=false;
      }else if(departures.length){
        item.departureAt=departures[0].departureAt;
        item.departureVerified=true;item.departureStatus='VERIFIED';
      }
      const incident=incidentSignals.get(item.imo);
      if(incident&&incident.humanReviewed===true&&
          Number.isFinite(incident.severity)&&incident.severity>=0&&incident.severity<=100){
        item.incidentSeverity=incident.severity;
        item.incidentHumanReviewed=true;
        item.incidentEvidenceRef=incident.incidentId||null;
      }
    }
    return [...vessels.values()].sort((a,b)=>compareInspections(a,b));
  }
  async dashboard(){
    const state=await this._state(),referrals=await this.cases.listInspectionRequests();
    if(!this.riskPolicy.ready)throw new SiTargetingError('SI_RISK_POLICY_NOT_READY',503);
    const projection=await this.riskPolicy.projectCurrent();
    const risks=new Map(projection.projections.filter(p=>p?.sourceAssessmentId).map(p=>[p.imo,p]));
    // PSC events remain in an independent targeting pool until a Publisher
    // explicitly selects them. NMC approved referrals and Service Requests
    // retain their existing independent business pathways.
    const selectedPscKeys=this.pscSelection?await this.pscSelection.selectedEventKeys():null;
    const policy=state.rules.at(-1),candidates=this._evaluate(
      state,referrals,risks,policy.config,selectedPscKeys);
    let incidentSignals=new Map();
    // Read-only incident feed. Missing/unavailable POC feed never blocks
    // targeting and never fabricates severity.
    if(this.loadIncidentSignals){
      try{
        const signals=await this.loadIncidentSignals();
        for(const row of Array.isArray(signals)?signals:[]){
          if(isImo(row.imo)&&row.humanReviewed===true&&
             Number.isFinite(row.severity)&&row.severity>=0&&row.severity<=100&&
             !['CLOSED','RESOLVED'].includes(row.operationalStatus)){
            const old=incidentSignals.get(row.imo);
            if(!old||row.severity>old.severity)incidentSignals.set(row.imo,row);
          }
        }
      }catch{incidentSignals=new Map();}
    }
    const vesselCandidates=this._vesselCandidates(candidates,incidentSignals);
    const summary={evaluatedPopulation:this.bundles.length,assessedRiskVessels:risks.size,
      candidateVessels:vesselCandidates.length,
      pendingVessels:vesselCandidates.filter(v=>v.pendingWorkflows>0).length,
      createdVessels:vesselCandidates.filter(v=>v.createdWorkflows>0).length,
      candidates:candidates.length,pendingReview:candidates.filter(x=>x.status==='PENDING_REVIEW').length,
      inspectionsCreated:candidates.filter(x=>x.status==='INSPECTION_CREATED').length,
      externalScheduled:candidates.filter(x=>x.status==='EXTERNALLY_SCHEDULED').length,
      bySource:Object.fromEntries(['NMC_CASE','SERVICE_REQUEST','PSC_PORT_CALL'].map(s=>
        [s,candidates.filter(x=>x.events.some(e=>e.sourceType===s)).length]))};
    return {status:'ok',source:'PERSISTED_NMC_AND_POC_EVENTS',fleetSnapshotId:this.fleetSnapshotId,
      evaluatedAt:iso(),policy:{version:policy.version,config:policy.config},
      riskPolicyRevision:projection.policyRevision,summary,candidates,vesselCandidates};
  }
  async previewRules(config){
    const parsed=validateRules(config);
    if(!parsed)throw new SiTargetingError('SI_RULES_INVALID',422);
    const data=await this.dashboard();
    const before=getSiRankingPolicy(data.policy.config);
    const proposed=getSiRankingPolicy(parsed);
    const changed=JSON.stringify(before)!==JSON.stringify(proposed);
    return {status:'PREVIEW',fleetSnapshotId:data.fleetSnapshotId,
      evaluatedPopulation:data.summary.evaluatedPopulation,rulesetVersion:data.policy.version,
      affectedImos:[],affectedCandidateCount:0,
      potentialRankingCandidates:changed?
        data.candidates.filter(c=>c.status==='PENDING_REVIEW').length:0,
      aiSettingsChanged:changed,requiresManualAiRerun:changed,
      unevaluatedRiskVessels:data.summary.evaluatedPopulation-data.summary.assessedRiskVessels,
      warning:'INSPECTION_ENTRY_INDEPENDENT_FROM_ETD_AND_INCIDENT_RANKING; NO_IMPACT_ESTIMATE_WITHOUT_VERIFIED_SIGNALS'};
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
    // An already scheduled, human-approved NMC referral may be linked into a
    // *new SI workflow record* without making a second NMC booking.
    const linkScheduledNmc=candidate.status==='EXTERNALLY_SCHEDULED'&&
      input.action==='APPROVE'&&candidate.events.some(e=>
        e.sourceType==='NMC_CASE'&&e.approval==='APPROVED');
    if(candidate.status==='INSPECTION_CREATED'||
      (candidate.status==='EXTERNALLY_SCHEDULED'&&!linkScheduledNmc))
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
      nmcCaseId:candidate.events.find(x=>x.sourceType==='NMC_CASE')?.sourceReference||null,
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
  /**
   * A single plan approval creates ONE inspection dossier/case per physical
   * vessel, preserving ALL NMC/PSC/service reasons and regulatory scopes.
   * Does not collapse distinct statutory obligations: regimes[]/scopeSources[]
   * remain separately traceable even though field preparation is coordinated.
   */
  async decideBatch({items,actor,note,approvedPlanId}={}){
    if(!Array.isArray(items)||items.length<1||items.length>40||
       !safeText(actor,120)||!safeText(note,500)||note.trim().length<8||
       !safeText(approvedPlanId,100))
      throw new SiTargetingError('SI_BULK_APPROVAL_INVALID',422);
    const imos=new Set(),keys=new Set();
    for(const item of items){
      if(!isImo(item?.imo)||!safeText(item?.candidateKey,100)||
         !Array.isArray(item.candidateKeys)||item.candidateKeys.length<1||
         !Array.isArray(item.inspectionReasons)||!item.inspectionReasons.length||
         imos.has(item.imo)||!item.candidateKeys.includes(item.candidateKey))
        throw new SiTargetingError('SI_BULK_SELECTION_INVALID',422);
      imos.add(item.imo);
      for(const key of item.candidateKeys){
        if(!safeText(key,100)||keys.has(key))
          throw new SiTargetingError('SI_BULK_SELECTION_INVALID',422);
        keys.add(key);
      }
    }
    const data=await this.dashboard(),registry=await this.inspectionCaseRegistry();
    const candidateMap=new Map(data.candidates.map(c=>[c.key,c]));
    const decisions=[],cases=[];
    const approvedAt=iso();
    for(const item of items){
      // Do not accept source event details supplied by the client or an AI.
      // Rebuild ALL underlying reasons directly from trusted server sources.
      const workflows=data.candidates.filter(c=>c.imo===item.imo&&
        (c.status==='PENDING_REVIEW'||(c.status==='EXTERNALLY_SCHEDULED'&&
         c.events.some(e=>e.sourceType==='NMC_CASE'&&e.approval==='APPROVED'))));
      const actualKeys=workflows.map(c=>c.key);
      if(!workflows.length||actualKeys.length!==item.candidateKeys.length||
         actualKeys.some(k=>!item.candidateKeys.includes(k))||
         !item.candidateKeys.every(k=>candidateMap.get(k)?.imo===item.imo))
        throw new SiTargetingError('SI_BULK_CANDIDATE_CHANGED',409);
      if(registry.cases.some(c=>[c.candidateKey,...(c.candidateKeys||[])]
          .some(k=>actualKeys.includes(k))))
        throw new SiTargetingError('SI_INSPECTION_CASE_EXISTS',409);
      const ordered=[...workflows].sort((a,b)=>
        Number(b.events.some(e=>e.sourceType==='NMC_CASE'))-
        Number(a.events.some(e=>e.sourceType==='NMC_CASE'))||
        a.regime.localeCompare(b.regime));
      const primary=ordered[0];
      if(item.candidateKey!==primary.key)
        throw new SiTargetingError('SI_BULK_PRIMARY_SOURCE_CHANGED',409);
      const sourceEvents=new Map();
      for(const workflow of ordered){
        for(const event of workflow.events){
          const key=event.eventKey||
            [event.sourceType,event.sourceEventId,workflow.regime].join(':');
          if(!sourceEvents.has(key))sourceEvents.set(key,{
            eventKey:key,candidateKey:workflow.key,
            sourceType:event.sourceType,
            sourceEventId:event.sourceEventId,
            sourceReference:event.sourceReference,
            inspectionRegime:workflow.regime,
            sourceApproval:event.approval,
            reason:event.contextNote||null,
            evidenceIds:[...new Set(event.evidenceIds||[])],
            sourceProvenance:event.provenance||null
          });
        }
      }
      const reasons=[...sourceEvents.values()];
      if(!reasons.length||JSON.stringify(reasons)!==
        JSON.stringify(item.inspectionReasons))
        throw new SiTargetingError('SI_BULK_SOURCE_EVENTS_CHANGED',409);
      const candidateKeys=ordered.map(c=>c.key);
      const regimes=[...new Set(ordered.map(c=>c.regime))];
      const sourceKeys=[...sourceEvents.keys()];
      const decision={id:randomUUID(),candidateKey:primary.key,candidateKeys,
        imo:item.imo,action:'APPROVE',actor:actor.trim(),note:note.trim(),
        at:approvedAt,rulesetVersion:data.policy.version,
        fleetSnapshotId:data.fleetSnapshotId,sourceEventKeys:sourceKeys,
        approvedPlanId,approvedAllSources:true};
      const inspectionCase={
        id:randomUUID(),candidateKey:primary.key,candidateKeys,
        imo:item.imo,regime:primary.regime,regimes,
        inspectionReasons:reasons,
        inspectionScopes:regimes.map(regime=>({
          regime,reasonEventKeys:reasons.filter(r=>r.inspectionRegime===regime)
            .map(r=>r.eventKey),
          requiresRegulatoryReview:true
        })),
        status:'CREATED',createdAt:approvedAt,
        approvedBy:decision.actor,decisionId:decision.id,
        rulesetVersion:decision.rulesetVersion,approvedPlanId,
        sourceEventKeys:sourceKeys,
        nmcReferralId:reasons.find(e=>e.sourceType==='NMC_CASE')?.sourceEventId||null,
        nmcCaseId:reasons.find(e=>e.sourceType==='NMC_CASE')?.sourceReference||null,
        nmcReferrals:reasons.filter(e=>e.sourceType==='NMC_CASE')
          .map(e=>e.sourceReference),
        evidenceIds:[...new Set(reasons.flatMap(e=>e.evidenceIds))],
        riskAssessmentId:primary.currentRisk?.assessmentId||null,
        riskAtApproval:primary.currentRisk||null,
        provenance:'POC_HUMAN_APPROVED_ALL_TRIGGERS_NOT_OFFICIAL_INSPECTION_REPORT'
      };
      decisions.push(decision);cases.push(inspectionCase);
    }
    if(this.mode==='json'){
      const saved=this._load();
      if(cases.some(c=>saved.cases.some(existing=>
          [existing.candidateKey,...(existing.candidateKeys||[])]
            .some(k=>c.candidateKeys.includes(k)))))
        throw new SiTargetingError('SI_INSPECTION_CASE_EXISTS',409);
      saved.decisions.push(...decisions);saved.cases.push(...cases);
      this._save(saved);
    }else await this._db(async con=>{
      try{
        for(let i=0;i<cases.length;i++){
          const c=cases[i],d=decisions[i];
          await con.execute(`INSERT INTO SI_INSPECTION_CASE
            (CASE_ID,CANDIDATE_KEY,IMO,DOC_JSON)
            VALUES (:id,:key,:imo,:doc)`,{
            id:c.id,key:c.candidateKey,imo:c.imo,doc:clob(c)});
          await con.execute(`INSERT INTO SI_CANDIDATE_DECISION
            (DECISION_ID,CANDIDATE_KEY,IMO,DOC_JSON)
            VALUES (:id,:key,:imo,:doc)`,{
            id:d.id,key:d.candidateKey,imo:d.imo,doc:clob(d)});
        }
        await con.commit();
      }catch(e){
        await con.rollback();
        if(e.code==='ORA-00001')
          throw new SiTargetingError('SI_INSPECTION_CASE_EXISTS',409);
        throw e;
      }
    });
    return {status:'APPROVED',approvedPlanId,decisions,cases};
  }
}
