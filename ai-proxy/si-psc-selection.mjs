/**
 * SI-T00: Deterministic PSC Port Call targeting pool / scoped selection quota.
 * Port call != inspection candidate. Only Publisher-selected PSC events
 * enter Candidate Center and SI-P01. No AI calls or fabricated eligibility.
 * Quotas are POC operational policy, NOT statutory IMO/PSC selection rules.
 */
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
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
  _save(data){
    mkdirSync(dirname(this.file),{recursive:true});
    const temp=this.file+'.tmp-'+process.pid;
    writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});
    renameSync(temp,this.file);
  }
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
  async selectedEventKeys(){
    const state=await this._state();
    const latest=new Map(state.decisions.map(d=>[d.eventKey,d]));
    return new Set([...latest.values()].filter(d=>d.action==='SELECT').map(d=>d.eventKey));
  }
  async pool({period=null,port=null}={}){
    const state=await this._state(),candidateState=await this.targeting._state(),
      policy=state.policies.at(-1),config=policy.config;
    const decisions=new Map(state.decisions.map(d=>[d.eventKey,d]));
    const projection=await this.targeting.riskPolicy.projectCurrent();
    const risk=new Map(projection.projections.filter(x=>x?.sourceAssessmentId).map(x=>[x.imo,x]));
    const events=candidateState.events.filter(x=>x.payload.sourceType==='PSC_PORT_CALL');
    const eligible=[];
    for(const e of events){
      const bucket=findBucket(e,config);
      if(!bucket)continue; // Invalid/missing arrival is never implicitly eligible.
      const savedRisk=risk.get(e.payload.imo)||null;
      const last=decisions.get(e.eventKey)||null;
      eligible.push({eventKey:e.eventKey,imo:e.payload.imo,
        vesselName:this.targeting.bundles.find(v=>String(v.imo)===e.payload.imo)
          ?.inlineContext?.vessel?.name||('IMO '+e.payload.imo),
        port:e.payload.port,sourceReference:e.payload.sourceReference,
        eta:e.payload.eta,period:bucket.period,bucket:bucket.key,
        importedAt:e.createdAt,sourceFile:e.sourceImport?.fileName||null,
        sourceExcelRow:e.sourceImport?.excelRow||null,
        nmcRisk:savedRisk?{score:savedRisk.riskScore,level:savedRisk.riskLevel,
          assessmentId:savedRisk.sourceAssessmentId}:null,
        selectionStatus:last?.action==='SELECT'?'SELECTED':
          last?.action==='NOT_SELECT'?'NOT_SELECTED':'IN_POOL',
        selectionDecision:last,arrivalTime:bucket.etaMs});
    }
    const groups=new Map();
    for(const row of eligible){
      if(!groups.has(row.bucket))groups.set(row.bucket,[]);
      groups.get(row.bucket).push(row);
    }
    const summaries=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
      const [p,location]=key.split('|'),
        overridden=config.portOverrides.find(x=>x.port===location),
        rate=overridden?.ratePercent??config.ratePercent,
        target=Math.floor(rows.length*rate/100),
        selected=rows.filter(r=>r.selectionStatus==='SELECTED').length;
      return {bucket:key,period:p,port:location,eligiblePortCalls:rows.length,
        selectionRate:rate,targetCount:target,selectedCount:selected,
        remainingSlots:Math.max(0,target-selected),
        overQuota:selected>target};
    });
    const byBucket=new Map(summaries.map(x=>[x.bucket,x]));
    const ordered=[...eligible].sort((a,b)=>
      a.period.localeCompare(b.period)||a.bucket.localeCompare(b.bucket)||
      (b.nmcRisk?.score??-1)-(a.nmcRisk?.score??-1)||
      a.arrivalTime-b.arrivalTime||a.eventKey.localeCompare(b.eventKey));
    const rankCounter=new Map();
    for(const item of ordered){
      const rank=(rankCounter.get(item.bucket)||0)+1;
      rankCounter.set(item.bucket,rank);
      const g=byBucket.get(item.bucket);
      item.ruleRank=rank;item.ruleRecommended=rank<=g.targetCount;
      // Missing risk always identified as a data gap; no invented score.
      item.missingRisk=!item.nmcRisk;
    }
    const visible=ordered.filter(x=>(!period||x.period===period)&&
      (!port||cleanPort(x.port)===cleanPort(port)));
    return {status:'ok',source:'PSC_PORT_CALL_EXCEL_POC_ONLY',policy,
      scope:config.scope,periodMode:config.period,
      summary:{eligiblePortCalls:eligible.length,
        selectedPortCalls:eligible.filter(x=>x.selectionStatus==='SELECTED').length,
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
        const state=await this._state();
        state.policies[state.policies.length-1]=JSON.parse(locked.rows[0].DOC_JSON);
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
