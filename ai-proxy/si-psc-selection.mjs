/**
 * SI-T00: Deterministic PSC Port Call targeting pool / scoped selection quota.
 * A port call alone NEVER approves a statutory inspection. The published quota
 * automatically shortlists eligible imported PSC events into Candidate Center
 * for independent C01 AI advice and officer plan/inspection approval.
 * Prior explicit Publisher decisions remain authoritative. No AI is called
 * merely by importing Excel or opening the queue.
 * Quotas are POC operational policy, NOT statutory IMO/PSC selection rules.
 */
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {atomicJsonWrite} from './atomic-json-store.mjs';
import oracledb from 'oracledb';

export class SiSelectionError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const doc=x=>({type:oracledb.DB_TYPE_CLOB,val:JSON.stringify(x)});
const defaultPolicy={
  period:'MONTHLY',scope:'NATIONAL',ratePercent:15,portOverrides:[],
  mandatoryOutsideQuota:true,
  publishedBy:'SYSTEM',reason:'Illustrative POC 15% PSC selection; not MOEI-approved'
};
const str=(x,n=120)=>typeof x==='string'&&x.trim().length>=3&&x.trim().length<=n?x.trim():null;
const cleanPort=x=>String(x||'').trim().replace(/\s+/g,' ').toUpperCase();
const monthKey=x=>/^20\d\d-(0[1-9]|1[0-2])$/.test(x||'');
function validPolicy(x){
  if(!x||x.period!=='MONTHLY'||!['PER_PORT','NATIONAL'].includes(x.scope)||
     !Number.isInteger(x.ratePercent)||x.ratePercent<0||x.ratePercent>100||
     x.mandatoryOutsideQuota!==true||!Array.isArray(x.portOverrides)||
     x.portOverrides.length>60)return null;
  let entries=[],seen=new Set();
  for(const r of x.portOverrides){
    const p=cleanPort(r?.port);
    if(!p||p.length>120||seen.has(p)||!Number.isInteger(r?.ratePercent)||
      r.ratePercent<0||r.ratePercent>100)return null;
    seen.add(p);entries.push({port:p,ratePercent:r.ratePercent});
  }
  if(x.scope==='NATIONAL'&&entries.length)return null;
  return {period:'MONTHLY',scope:x.scope,ratePercent:x.ratePercent,
    portOverrides:entries,mandatoryOutsideQuota:true};
}
function dateFor(event){
  const v=event.payload.eta;
  if(typeof v!=='string'||!/^20\d\d-(0[1-9]|1[0-2])-\d\dT\d\d:\d\d/.test(v))return null;
  const d=new Date(v.slice(0,16)+':00+04:00');
  if(!Number.isFinite(d.getTime()))return null;
  // The source explicitly holds Dubai-local ETA; quotas use Dubai-local month.
  return {period:v.slice(0,7),time:d.getTime()};
}
function findBucket(event,config){
  const date=dateFor(event),port=cleanPort(event.payload.port);
  if(!date||!port)return null;
  const location=config.scope==='NATIONAL'?'UAE_ALL_PORTS':port;
  return {period:date.period,port,location,key:date.period+'|'+location,etaMs:date.time};
}
/**
 * Pure, no-write quota projection for imported PSC port-call events.
 *
 * - Published rate applied to actual eligible EVENT count, per UAE-local month
 *   and the policy's NATIONAL/PER_PORT scope (floor, never round up).
 * - Old explicit human SELECT / NOT_SELECT decisions remain honored.
 * - Unreviewed events use a reproducible source-backed shortlist: saved NMC
 *   vessel-risk assessment (if present), then ETA and stable event key.
 *   This is PSC screening, NOT the SI inspection EXECUTION priority.
 * - SI-C01 subsequently reviews this shortlist; AI cannot enlarge quota or
 *   create an inspection case. No paid AI calls or automatic DB writes.
 */
export function projectPscQuotaShortlist({
  events=[],config,decisions=[],riskByImo=new Map()
}={}){
 const validated=validPolicy(config);
 if(!validated||!Array.isArray(events)||!Array.isArray(decisions))
  throw new SiSelectionError('SI_SELECTION_POLICY_INVALID',422);
 const latest=new Map(decisions.map(d=>[d.eventKey,d]));
 const eligible=[];
 for(const e of events){
  if(e?.payload?.sourceType!=='PSC_PORT_CALL')continue;
  const bucket=findBucket(e,validated);
  if(!bucket)continue;
  const rawRisk=riskByImo.get(e.payload.imo);
  const nmcRisk=rawRisk&&Number.isFinite(rawRisk.riskScore)?rawRisk:null;
  eligible.push({event:e,bucket,manualDecision:latest.get(e.eventKey)||null,nmcRisk});
 }
 const groups=new Map();
 for(const item of eligible){
  if(!groups.has(item.bucket.key))groups.set(item.bucket.key,[]);
  groups.get(item.bucket.key).push(item);
 }
 const selectedKeys=new Set(),selectionMode=new Map(),summaries=[];
 const compare=(a,b)=>
  (b.nmcRisk?.riskScore??-1)-(a.nmcRisk?.riskScore??-1)||
  a.bucket.etaMs-b.bucket.etaMs||
  a.event.eventKey.localeCompare(b.event.eventKey);
 for(const [key,items] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const [period,location]=key.split('|');
  const rate=validated.portOverrides.find(x=>x.port===location)?.ratePercent??
    validated.ratePercent;
  const target=Math.floor(items.length*rate/100);
  const explicit=items.filter(x=>x.manualDecision?.action==='SELECT');
  const blocked=new Set(items.filter(x=>x.manualDecision?.action==='NOT_SELECT')
    .map(x=>x.event.eventKey));
  for(const x of explicit){
    selectedKeys.add(x.event.eventKey);
    selectionMode.set(x.event.eventKey,'OFFICER_SELECTED');
  }
  const available=items.filter(x=>!x.manualDecision&&!blocked.has(x.event.eventKey))
    .sort(compare);
  const automatic=available.slice(0,Math.max(0,target-explicit.length));
  for(const x of automatic){
    selectedKeys.add(x.event.eventKey);
    selectionMode.set(x.event.eventKey,'RULE_SHORTLISTED');
  }
  summaries.push({bucket:key,period,port:location,eligiblePortCalls:items.length,
    selectionRate:rate,targetCount:target,
    selectedCount:explicit.length+automatic.length,
    manuallySelectedCount:explicit.length,
    automaticallyShortlistedCount:automatic.length,
    remainingSlots:Math.max(0,target-explicit.length-automatic.length),
    overQuota:explicit.length>target});
 }
 return {eligible,selectedKeys,selectionMode,summaries,latest,
   automaticCount:[...selectionMode.values()].filter(x=>x==='RULE_SHORTLISTED').length,
   source:'SAVED_EXCEL_EVENTS_AND_PUBLISHED_QUOTA_RULES',
   aiCalls:0,inspectionApprovals:0};
}
export class SiPscSelection{
  constructor({targeting,mode='json',oracleRepository=null,
    file=process.env.SI_SELECTION_STORE_PATH||'/data/si-psc-selection.json'}={}){
    if(!targeting||!['json','oracle'].includes(mode))throw Error('SI_SELECTION_CONFIG_INVALID');
    this.targeting=targeting;this.mode=mode;this.oracle=oracleRepository;this.file=file;
    this.ready=mode==='json';
  }
  _load(){
    if(!existsSync(this.file))return {
      policies:[{version:1,config:validPolicy(defaultPolicy),
        publishedAt:new Date().toISOString(),publishedBy:defaultPolicy.publishedBy,
        reason:defaultPolicy.reason}],decisions:[]
    };
    const data=JSON.parse(readFileSync(this.file,'utf8'));
    if(!Array.isArray(data.policies)||!data.policies.length||!Array.isArray(data.decisions))
      throw new SiSelectionError('SI_SELECTION_STORE_INVALID',503);
    return data;
  }
  _save(data){atomicJsonWrite(this.file,data);}
  async _db(fn){
    if(!this.oracle?.pool)throw new SiSelectionError('SI_SELECTION_ORACLE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await fn(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){this._load();this.ready=true;return;}
    await this._db(async con=>{
      const r=await con.execute(`SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN
        ('SI_PSC_SELECTION_POLICY','SI_PSC_SELECTION_DECISION')`,[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(r.rows.length!==2)throw new SiSelectionError('SI_MIGRATION_012_REQUIRED',503);
      const n=await con.execute('SELECT COUNT(*) AS N FROM SI_PSC_SELECTION_POLICY',[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(Number(n.rows[0].N)===0){
        try{
          await con.execute(`INSERT INTO SI_PSC_SELECTION_POLICY
            (VERSION_NO,DOC_JSON) VALUES (1,:doc)`,{doc:doc(this._load().policies[0])});
          await con.commit();
        }catch(e){await con.rollback();if(e.code!=='ORA-00001')throw e;}
      }
    });
    this.ready=true;
  }
  assertReady(){if(!this.ready)throw new SiSelectionError('SI_MIGRATION_012_REQUIRED',503);}
  async _state(){
    this.assertReady();
    if(this.mode==='json')return this._load();
    return this._db(async con=>{
      const p=await con.execute('SELECT DOC_JSON FROM SI_PSC_SELECTION_POLICY ORDER BY VERSION_NO',[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      const d=await con.execute('SELECT DOC_JSON FROM SI_PSC_SELECTION_DECISION ORDER BY CREATED_AT',[],
        {outFormat:oracledb.OUT_FORMAT_OBJECT});
      return {policies:p.rows.map(x=>JSON.parse(x.DOC_JSON)),
        decisions:d.rows.map(x=>JSON.parse(x.DOC_JSON))};
    });
  }
  async policy(){
    const state=await this._state();return clone(state.policies.at(-1));
  }
  async _effectiveSelection(){
    const [state,candidateState,projection]=await Promise.all([
      this._state(),this.targeting._state(),
      this.targeting.riskPolicy.projectCurrent()
    ]);
    const riskByImo=new Map(projection.projections.filter(x=>x?.sourceAssessmentId)
      .map(x=>[x.imo,x]));
    return {state,candidateState,projection:projectPscQuotaShortlist({
      events:candidateState.events,config:state.policies.at(-1).config,
      decisions:state.decisions,riskByImo
    })};
  }
  async selectedEventKeys(){
    const selection=await this._effectiveSelection();
    return selection.projection.selectedKeys;
  }
  async pool({period=null,port=null}={}){
    const {state,projection}=await this._effectiveSelection();
    const policy=state.policies.at(-1),config=policy.config;
    const eligible=projection.eligible.map(({event:e,bucket,nmcRisk,manualDecision})=>({
      eventKey:e.eventKey,imo:e.payload.imo,
      vesselName:this.targeting.bundles.find(v=>String(v.imo)===e.payload.imo)
        ?.inlineContext?.vessel?.name||('IMO '+e.payload.imo),
      port:e.payload.port,sourceReference:e.payload.sourceReference,
      eta:e.payload.eta,period:bucket.period,bucket:bucket.key,
      importedAt:e.createdAt,sourceFile:e.sourceImport?.fileName||null,
      sourceExcelRow:e.sourceImport?.excelRow||null,
      nmcRisk:nmcRisk?{score:nmcRisk.riskScore,level:nmcRisk.riskLevel,
        assessmentId:nmcRisk.sourceAssessmentId}:null,
      selectionStatus:manualDecision?.action==='SELECT'?'SELECTED':
        manualDecision?.action==='NOT_SELECT'?'NOT_SELECTED':
        projection.selectedKeys.has(e.eventKey)?'RULE_SHORTLISTED':'IN_POOL',
      selectionOrigin:projection.selectionMode.get(e.eventKey)||'NOT_SHORTLISTED',
      selectionDecision:manualDecision,arrivalTime:bucket.etaMs
    }));
    const summaries=projection.summaries;
    const ordered=[...eligible].sort((a,b)=>
      a.period.localeCompare(b.period)||a.bucket.localeCompare(b.bucket)||
      (b.nmcRisk?.score??-1)-(a.nmcRisk?.score??-1)||
      a.arrivalTime-b.arrivalTime||a.eventKey.localeCompare(b.eventKey));
    const rankCounter=new Map();
    for(const item of ordered){
      const rank=(rankCounter.get(item.bucket)||0)+1;
      rankCounter.set(item.bucket,rank);
      item.ruleRank=rank;
      item.ruleRecommended=item.selectionStatus==='RULE_SHORTLISTED'||
        item.selectionStatus==='SELECTED';
      // Missing risk always identified as a data gap; no invented score.
      item.missingRisk=!item.nmcRisk;
    }
    const visible=ordered.filter(x=>(!period||x.period===period)&&
      (!port||cleanPort(x.port)===cleanPort(port)));
    return {status:'ok',source:'PSC_PORT_CALL_EXCEL_POC_ONLY',policy,
      scope:config.scope,periodMode:config.period,
      selectionMode:'AUTOMATIC_RULE_QUOTA_THEN_C01_ADVISORY',
      aiCallOnRead:false,
      summary:{eligiblePortCalls:eligible.length,
        selectedPortCalls:eligible.filter(x=>x.selectionStatus==='SELECTED'||
          x.selectionStatus==='RULE_SHORTLISTED').length,
        automaticallyShortlistedPortCalls:projection.automaticCount,
        inPoolPortCalls:eligible.filter(x=>x.selectionStatus==='IN_POOL').length,
        notSelectedPortCalls:eligible.filter(x=>x.selectionStatus==='NOT_SELECTED').length,
        distinctVessels:new Set(eligible.map(x=>x.imo)).size,
        buckets:summaries},
      items:visible.map(({arrivalTime,...rest})=>rest)};
  }
  async previewPolicy(config){
    const valid=validPolicy(config);
    if(!valid)throw new SiSelectionError('SI_SELECTION_POLICY_INVALID',422);
    const current=await this.policy();
    // Read-only quota recalculation, no writes or AI.
    const projection=await this._previewWith(valid);
    return {status:'PREVIEW_ONLY_NO_AI',currentVersion:current.version,
      proposed:valid,summary:projection.summary};
  }
  async _previewWith(config){
    const state=await this.targeting._state(),old=await this._state();
    const decisions=new Map(old.decisions.map(d=>[d.eventKey,d]));
    const groups=new Map();
    for(const e of state.events.filter(x=>x.payload.sourceType==='PSC_PORT_CALL')){
      const b=findBucket(e,config);if(!b)continue;
      if(!groups.has(b.key))groups.set(b.key,{port:b.location,period:b.period,events:[]});
      groups.get(b.key).events.push(e);
    }
    const summary=[...groups].map(([key,g])=>{
      const rate=config.portOverrides.find(x=>x.port===g.port)?.ratePercent??config.ratePercent;
      const target=Math.floor(g.events.length*rate/100);
      const selected=g.events.filter(e=>decisions.get(e.eventKey)?.action==='SELECT').length;
      return {bucket:key,eligiblePortCalls:g.events.length,selectionRate:rate,
        targetCount:target,selectedCount:selected,
        overQuota:selected>target};
    });
    return {summary:summary.sort((a,b)=>a.bucket.localeCompare(b.bucket))};
  }
  async publish({config,expectedVersion,publishedBy,reason}={}){
    const clean=validPolicy(config),actor=str(publishedBy),why=str(reason,500);
    if(!clean||!actor||!why||why.length<8)
      throw new SiSelectionError('SI_SELECTION_POLICY_INVALID',422);
    const state=await this._state(),last=state.policies.at(-1);
    if(expectedVersion!==last.version)
      throw new SiSelectionError('SI_SELECTION_POLICY_VERSION_CONFLICT',409);
    const next={version:last.version+1,config:clean,publishedBy:actor,
      reason:why,publishedAt:new Date().toISOString()};
    if(this.mode==='json'){
      const current=this._load();
      if(current.policies.at(-1).version!==expectedVersion)
        throw new SiSelectionError('SI_SELECTION_POLICY_VERSION_CONFLICT',409);
      current.policies.push(next);this._save(current);
    }else await this._db(async con=>{
      try{
        // Lock all policy versions against concurrent quota decisions so a
        // new published rate cannot race a Publisher selecting Port Calls.
        await con.execute('LOCK TABLE SI_PSC_SELECTION_POLICY IN EXCLUSIVE MODE');
        const current=await con.execute(
          'SELECT MAX(VERSION_NO) AS VERSION_NO FROM SI_PSC_SELECTION_POLICY',[],
          {outFormat:oracledb.OUT_FORMAT_OBJECT});
        if(Number(current.rows[0].VERSION_NO)!==expectedVersion)
          throw new SiSelectionError('SI_SELECTION_POLICY_VERSION_CONFLICT',409);
        await con.execute(`INSERT INTO SI_PSC_SELECTION_POLICY (VERSION_NO,DOC_JSON)
          VALUES (:version,:doc)`,{version:next.version,doc:doc(next)});
        await con.commit();
      }catch(e){await con.rollback();if(e.code==='ORA-00001')
        throw new SiSelectionError('SI_SELECTION_POLICY_VERSION_CONFLICT',409);throw e;}
    });
    return next;
  }
  async decide({eventKey,action,actor,reason,expectedPolicyVersion}={}){
    if(!/^[a-f0-9]{64}$/i.test(eventKey||'')||
      !['SELECT','NOT_SELECT'].includes(action)||!str(actor)||!str(reason,500)||
      reason.trim().length<8)
      throw new SiSelectionError('SI_SELECTION_DECISION_INVALID',422);
    this.assertReady();
    const targeting=await this.targeting._state(),
      event=targeting.events.find(e=>e.eventKey===eventKey&&
        e.payload.sourceType==='PSC_PORT_CALL');
    if(!event)throw new SiSelectionError('SI_SELECTION_SOURCE_EVENT_NOT_FOUND',404);
    // Selection decisions must be serialized against policy and quota changes.
    const apply=async(state,write)=>{
      const policy=state.policies.at(-1);
      if(expectedPolicyVersion!==policy.version)
        throw new SiSelectionError('SI_SELECTION_POLICY_VERSION_CONFLICT',409);
      const last=state.decisions.filter(d=>d.eventKey===eventKey).at(-1);
      if(last?.action===action)throw new SiSelectionError('SI_SELECTION_ALREADY_DECIDED',409);
      const b=findBucket(event,policy.config);
      if(!b)throw new SiSelectionError('SI_SELECTION_ARRIVAL_REQUIRED',422);
      const cases=targeting.cases.filter(c=>c.regime==='PORT_STATE_CONTROL'&&
        c.imo===event.payload.imo);
      if(action==='NOT_SELECT'&&cases.length)
        throw new SiSelectionError('SI_SELECTION_HAS_INSPECTION_CASE',409);
      const g=await this._previewWithState(targeting,state,policy.config,b.key);
      if(action==='SELECT'&&g.selectedCount>=g.targetCount)
        throw new SiSelectionError('SI_SELECTION_QUOTA_EXHAUSTED',409);
      const record={id:randomUUID(),eventKey,imo:event.payload.imo,
        port:event.payload.port,period:b.period,bucket:b.key,
        action,actor:actor.trim(),reason:reason.trim(),
        policyVersion:policy.version,decidedAt:new Date().toISOString(),
        sourceReference:event.payload.sourceReference,
        sourceImportBatch:event.sourceImport?.batchId||null};
      await write(record);
      return record;
    };
    if(this.mode==='json'){
      const state=this._load();
      return apply(state,async decision=>{state.decisions.push(decision);this._save(state);});
    }
    return this._db(async con=>{
      try{
        // Exclusive row lock serializes different Publisher decisions in all
        // instances; policy version updates share the same table lock.
        const locked=await con.execute(`SELECT DOC_JSON FROM SI_PSC_SELECTION_POLICY
          WHERE VERSION_NO=(SELECT MAX(VERSION_NO) FROM SI_PSC_SELECTION_POLICY)
          FOR UPDATE`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        const all=await con.execute(
          'SELECT DOC_JSON FROM SI_PSC_SELECTION_DECISION ORDER BY CREATED_AT',[],
          {outFormat:oracledb.OUT_FORMAT_OBJECT});
        const state={policies:[JSON.parse(locked.rows[0].DOC_JSON)],
          decisions:all.rows.map(x=>JSON.parse(x.DOC_JSON))};
        const record=await apply(state,async decision=>{
          await con.execute(`INSERT INTO SI_PSC_SELECTION_DECISION
            (DECISION_ID,EVENT_KEY,IMO,ACTION,DOC_JSON)
            VALUES (:id,:eventKey,:imo,:action,:doc)`,{
              id:decision.id,eventKey,imo:decision.imo,action,doc:doc(decision)});
        });
        await con.commit();
        return record;
      }catch(e){await con.rollback();throw e;}
    });
  }
  async _previewWithState(targeting,state,config,bucketKey){
    const latest=new Map(state.decisions.map(d=>[d.eventKey,d]));
    const events=targeting.events.filter(x=>x.payload.sourceType==='PSC_PORT_CALL'&&
      findBucket(x,config)?.key===bucketKey);
    const location=bucketKey.split('|')[1];
    const rate=config.portOverrides.find(x=>x.port===location)?.ratePercent??config.ratePercent;
    return {targetCount:Math.floor(events.length*rate/100),
      selectedCount:events.filter(e=>latest.get(e.eventKey)?.action==='SELECT').length};
  }
}
