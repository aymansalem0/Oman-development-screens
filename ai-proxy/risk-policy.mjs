/**
 * Central risk policy: append-only version history + a single transactional active pointer.
 * Sources: saved A01/A02 five-factor assessments ONLY. No Airia, no case decisions.
 * Existing source assessments are NEVER rewritten; projections reference source IDs.
 */
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';
const copy=x=>JSON.parse(JSON.stringify(x));
const iso=()=>new Date().toISOString();
const keySet=['movement','inspection','certificate','dataQuality','history'];
const baseline={
  version:'NMC Risk Ruleset 1.0',name:'National Maritime Risk Model',mode:'weighted',
  weights:{movement:25,inspection:28,certificate:20,dataQuality:14,history:13},
  thresholds:{watch:45,high:65,critical:85},
  publishedAt:null,publishedBy:'SYSTEM INITIAL BASELINE',
  changeReason:'Initial central baseline; previous browser policies are NOT auto-imported.'
};
const clob=x=>({val:JSON.stringify(x),type:oracledb.DB_TYPE_CLOB});
const time=col=>`TO_CHAR(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`;
const storeFile=process.env.NMC_RISK_POLICY_STORE_PATH||'/data/nmc-risk-policy.json';
export class RiskPolicyError extends Error{
  constructor(code,status=400,cause=null){super(code,{cause});this.code=code;this.status=status;}
}
export function validateRiskConfig(c){
  if(!c||typeof c!=='object'||Array.isArray(c)||!c.weights||!c.thresholds||
     !['weighted','conservative','max-signal'].includes(c.mode)||
     typeof c.name!=='string'||!c.name.trim()||c.name.length>140)
    throw new RiskPolicyError('RISK_POLICY_INVALID');
  const numbers=keySet.map(k=>c.weights[k]);
  if(numbers.some(x=>!Number.isInteger(x)||x<0||x>100)||
     numbers.reduce((a,b)=>a+b,0)!==100)throw new RiskPolicyError('RISK_WEIGHTS_INVALID');
  const {watch,high,critical}=c.thresholds;
  if(![watch,high,critical].every(Number.isInteger)||
     watch<1||watch>=high||high>=critical||critical>100)
    throw new RiskPolicyError('RISK_THRESHOLDS_INVALID');
  return {name:c.name.trim(),mode:c.mode,
    weights:Object.fromEntries(keySet.map(k=>[k,c.weights[k]])),
    thresholds:{watch,high,critical}};
}
export function calculateRiskPolicy(row,config,revision){
  const signals=row?.signals||[];
  const severities={};
  for(const key of keySet){
    const rows=signals.filter(s=>s.factor===key);
    if(rows.length!==1||!Number.isFinite(rows[0].severity)||
       rows[0].severity<0||rows[0].severity>100)return null;
    severities[key]=rows[0].severity;
  }
  const weighted=keySet.reduce((n,key)=>n+severities[key]*config.weights[key],0)/100;
  const highest=Math.max(...Object.values(severities));
  let raw=weighted;
  if(config.mode==='conservative')raw+=Math.max(0,highest-raw)*.28;
  if(config.mode==='max-signal')raw=raw*.68+highest*.32;
  const score=Math.round(Math.min(100,Math.max(0,raw)));
  const t=config.thresholds;
  const level=score>=t.critical?'Critical':score>=t.high?'High':
    score>=t.watch?'Watch':'Normal';
  const criticalOpenFinding=row.criticalOpenFinding===true;
  const operationalPriority=criticalOpenFinding||level==='Critical'?'Priority Review':
    level==='High'?'Enhanced Monitoring':'Routine';
  return {imo:row.imo,sourceAssessmentId:row.assessmentId,
    riskScore:score,riskLevel:level,operationalPriority,
    criticalOpenFinding,policyVersion:config.version,policyRevision:revision,
    originalScore:row.score,originalLevel:row.level,
    dataNature:'SYNTHETIC_POC_NOT_REGULATORY'};
}
const fromRow=r=>({revision:r.VERSION_NO,policyRef:r.POLICY_REF,
  previousRevision:r.PREVIOUS_VERSION_NO||null,config:JSON.parse(r.CONFIG_JSON),
  reason:r.CHANGE_REASON,publishedBy:r.PUBLISHED_BY,actorRole:r.ACTOR_ROLE,
  publishedAt:r.PUBLISHED_AT});
export class CentralRiskPolicy{
  constructor({mode='oracle',oracleRepository=null,fleet=null,file=storeFile}={}){
    this.mode=mode;this.oracle=oracleRepository;this.fleet=fleet;this.file=file;
    this.state=null;this.ready=false;
  }
  async connection(fn){
    if(!this.oracle?.pool)throw new RiskPolicyError('RISK_POLICY_DB_UNAVAILABLE',503);
    const c=await this.oracle.pool.getConnection();
    try{return await fn(c);}finally{await c.close();}
  }
  jsonSave(){
    mkdirSync(dirname(this.file),{recursive:true});
    const tmp=this.file+'.tmp';
    writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});renameSync(tmp,this.file);
  }
  async initialize(){
    if(this.mode==='json'){
      this.state=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):null;
      if(this.state&&(!Array.isArray(this.state.versions)||!Number.isInteger(this.state.activeRevision)))
        throw new RiskPolicyError('RISK_POLICY_JSON_INVALID',503);
      if(!this.state){
        const c={...copy(baseline),publishedAt:iso()};
        this.state={activeRevision:1,versions:[{
          revision:1,policyRef:c.version,previousRevision:null,config:c,
          reason:c.changeReason,publishedBy:c.publishedBy,actorRole:'SYSTEM',publishedAt:c.publishedAt
        }],projections:[]};
        this.jsonSave();
      }
      this.ready=true;return;
    }
    try{
      await this.connection(async c=>{
        // SELECT and lock singleton row; protects against simultaneous startup seeds.
        const r=await c.execute('SELECT VERSION_NO FROM NMC_RISK_POLICY_ACTIVE WHERE SINGLETON_ID=1');
        if(r.rows.length)return;
        const versionExists=await c.execute('SELECT VERSION_NO FROM NMC_RISK_POLICY_VERSION WHERE VERSION_NO=1');
        if(versionExists.rows.length)throw new RiskPolicyError('RISK_POLICY_PARTIAL_SEED',503);
        const at=iso(),config={...copy(baseline),publishedAt:at};
        await c.execute(`INSERT INTO NMC_RISK_POLICY_VERSION
          (VERSION_NO,POLICY_REF,PREVIOUS_VERSION_NO,CONFIG_JSON,CHANGE_REASON,PUBLISHED_BY,ACTOR_ROLE)
          VALUES(1,:b_policy_ref,NULL,:b_config_json,:b_change_reason,:b_published_by,'SYSTEM')`,
          {b_policy_ref:config.version,b_config_json:clob(config),
            b_change_reason:config.changeReason,b_published_by:config.publishedBy});
        await c.execute('INSERT INTO NMC_RISK_POLICY_ACTIVE(SINGLETON_ID,VERSION_NO) VALUES(1,1)');
        await c.commit();
      });
      this.ready=true;
    }catch(e){
      if(e instanceof RiskPolicyError)throw e;
      throw new RiskPolicyError('RISK_POLICY_SCHEMA_NOT_READY',503,e);
    }
  }
  requireReady(){if(!this.ready)throw new RiskPolicyError('RISK_POLICY_SCHEMA_NOT_READY',503,e);}
  async active(){
    this.requireReady();
    if(this.mode==='json')return copy(this.state.versions.find(v=>v.revision===this.state.activeRevision));
    try{return await this.connection(async c=>{
      const q=await c.execute(`SELECT v.VERSION_NO,v.POLICY_REF,v.PREVIOUS_VERSION_NO,
        v.CONFIG_JSON,v.CHANGE_REASON,v.PUBLISHED_BY,v.ACTOR_ROLE,
        ${time('v.PUBLISHED_AT')} PUBLISHED_AT
        FROM NMC_RISK_POLICY_ACTIVE a
        JOIN NMC_RISK_POLICY_VERSION v ON v.VERSION_NO=a.VERSION_NO
        WHERE a.SINGLETON_ID=1`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      if(q.rows.length!==1)throw new RiskPolicyError('RISK_POLICY_ACTIVE_MISSING',503);
      return fromRow(q.rows[0]);
    });}catch(e){if(e instanceof RiskPolicyError)throw e;throw new RiskPolicyError('RISK_POLICY_READ_FAILED',503);}
  }
  async history(){
    this.requireReady();
    if(this.mode==='json')return copy(this.state.versions).reverse();
    try{return await this.connection(async c=>{
      const q=await c.execute(`SELECT VERSION_NO,POLICY_REF,PREVIOUS_VERSION_NO,
        CONFIG_JSON,CHANGE_REASON,PUBLISHED_BY,ACTOR_ROLE,
        ${time('PUBLISHED_AT')} PUBLISHED_AT
        FROM NMC_RISK_POLICY_VERSION ORDER BY VERSION_NO DESC FETCH FIRST 200 ROWS ONLY`,
        [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return q.rows.map(fromRow);
    });}catch{throw new RiskPolicyError('RISK_POLICY_HISTORY_UNAVAILABLE',503);}
  }
  // Backend-owned publication: atomic revision allocation + append-only snapshot,
  // and recomputed projections of SAVED assessed vessels. No Airia calls.
  async publish(request){
    this.requireReady();
    if(!request||!Number.isInteger(request.expectedRevision)||
       typeof request.reason!=='string'||request.reason.trim().length<10||
       request.reason.length>500||
       typeof request.publishedBy!=='string'||
       request.publishedBy.trim().length<3||request.publishedBy.length>120)
      throw new RiskPolicyError('RISK_POLICY_PUBLICATION_INVALID');
    const clean=validateRiskConfig(request.config);
    const source=Object.values(this.fleet?.results||{}).filter(r=>
      r.status==='COMPLETED'&&r.assessmentId);
    const change=(previous)=>{
      if(previous.revision!==request.expectedRevision)throw new RiskPolicyError('RISK_POLICY_VERSION_CONFLICT',409);
      const rev=previous.revision+1,at=iso();
      const config={...clean,version:'NMC Risk Ruleset 1.'+(rev-1),
        publishedAt:at,publishedBy:request.publishedBy.trim(),
        changeReason:request.reason.trim()};
      const projections=source.map(r=>calculateRiskPolicy(r,config,rev)).filter(Boolean);
      return {revision:rev,policyRef:config.version,
        previousRevision:previous.revision,config,reason:config.changeReason,
        publishedBy:config.publishedBy,actorRole:'PUBLISHER',
        publishedAt:at,projections};
    };
    if(this.mode==='json'){
      const previous=this.state.versions.find(v=>v.revision===this.state.activeRevision);
      const next=change(previous);
      this.state.versions.push(copy({...next,projections:undefined}));
      this.state.projections.push(...next.projections);
      this.state.activeRevision=next.revision;
      this.jsonSave();return {...next,projections:undefined,projectionCount:next.projections.length};
    }
    return this.connection(async c=>{
      try{
        const r=await c.execute(`SELECT a.VERSION_NO,v.CONFIG_JSON,v.POLICY_REF
          FROM NMC_RISK_POLICY_ACTIVE a JOIN NMC_RISK_POLICY_VERSION v
          ON v.VERSION_NO=a.VERSION_NO WHERE a.SINGLETON_ID=1 FOR UPDATE OF a.VERSION_NO`,
          [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
        if(r.rows.length!==1)throw new RiskPolicyError('RISK_POLICY_ACTIVE_MISSING',503);
        const previous={revision:r.rows[0].VERSION_NO};
        const next=change(previous);
        await c.execute(`INSERT INTO NMC_RISK_POLICY_VERSION
          (VERSION_NO,POLICY_REF,PREVIOUS_VERSION_NO,CONFIG_JSON,CHANGE_REASON,PUBLISHED_BY,ACTOR_ROLE)
          VALUES(:b_rev,:b_policy_ref,:b_prev,:b_config_json,:b_change_reason,:b_published_by,'PUBLISHER')`,
          {b_rev:next.revision,b_policy_ref:next.policyRef,b_prev:next.previousRevision,
            b_config_json:clob(next.config),b_change_reason:next.reason,
            b_published_by:next.publishedBy});
        for(const p of next.projections){
          await c.execute(`INSERT INTO NMC_RISK_POLICY_PROJECTION
            (POLICY_VERSION_NO,ASSESSMENT_ID,IMO,RISK_SCORE,RISK_LEVEL,OPERATIONAL_PRIORITY,
             CRITICAL_OPEN_FINDING)
            VALUES(:b_revision,:b_assessment_id,:b_imo,:b_score,:b_risk_level,:b_priority,:b_critical)`,
            {b_revision:next.revision,b_assessment_id:p.sourceAssessmentId,b_imo:p.imo,
              b_score:p.riskScore,b_risk_level:p.riskLevel,b_priority:p.operationalPriority,
              b_critical:p.criticalOpenFinding?'Y':'N'});
        }
        await c.execute(`UPDATE NMC_RISK_POLICY_ACTIVE
          SET VERSION_NO=:revision,UPDATED_AT=SYSTIMESTAMP WHERE SINGLETON_ID=1`,
          {revision:next.revision});
        await c.commit();
        return {...next,projections:undefined,projectionCount:next.projections.length};
      }catch(e){
        await c.rollback();
        if(e instanceof RiskPolicyError)throw e;
        throw new RiskPolicyError('RISK_POLICY_PUBLICATION_FAILED',503);
      }
    });
  }
  async projectCurrent(){
    const active=await this.active();
    const projections=[];
    for(const row of Object.values(this.fleet?.results||{})){
      if(row.status!=='COMPLETED'||!row.assessmentId)continue;
      const p=calculateRiskPolicy(row,active.config,active.revision);
      if(p)projections.push(p);
    }
    return {status:'ok',policyRevision:active.revision,policyRef:active.policyRef,
      publishedAt:active.publishedAt,assessed:projections.length,
      projections,provenance:'SYNTHETIC_POC_SAVED_AI_FACTORS'};
  }
  async vessel(imo){
    const projection=await this.projectCurrent();
    return projection.projections.find(p=>p.imo===imo)||null;
  }
  async projectionHistory(imo){
    if(!/^\d{7}$/.test(imo))throw new RiskPolicyError('RISK_POLICY_IMO_INVALID');
    this.requireReady();
    if(this.mode==='json')return this.state.projections.filter(p=>p.imo===imo).sort(
      (a,b)=>b.policyRevision-a.policyRevision);
    return this.connection(async c=>{
      try{
        const q=await c.execute(`SELECT p.IMO,p.ASSESSMENT_ID,p.RISK_SCORE,p.RISK_LEVEL,
          p.OPERATIONAL_PRIORITY,p.CRITICAL_OPEN_FINDING,p.POLICY_VERSION_NO,
          v.POLICY_REF,v.CHANGE_REASON,${time('p.CALCULATED_AT')} CALCULATED_AT
          FROM NMC_RISK_POLICY_PROJECTION p JOIN NMC_RISK_POLICY_VERSION v
          ON v.VERSION_NO=p.POLICY_VERSION_NO
          WHERE p.IMO=:imo ORDER BY p.POLICY_VERSION_NO DESC FETCH FIRST 200 ROWS ONLY`,
          {imo},{outFormat:oracledb.OUT_FORMAT_OBJECT});
        return q.rows.map(r=>({imo:r.IMO,sourceAssessmentId:r.ASSESSMENT_ID,
          riskScore:r.RISK_SCORE,riskLevel:r.RISK_LEVEL,
          operationalPriority:r.OPERATIONAL_PRIORITY,
          criticalOpenFinding:r.CRITICAL_OPEN_FINDING==='Y',
          policyRevision:r.POLICY_VERSION_NO,policyRef:r.POLICY_REF,
          reason:r.CHANGE_REASON,calculatedAt:r.CALCULATED_AT}));
      }catch{throw new RiskPolicyError('RISK_POLICY_HISTORY_UNAVAILABLE',503);}
    });
  }
  async materializeCurrent(savedRow){
    if(!this.ready||!savedRow?.assessmentId)return;
    const active=await this.active();
    const p=calculateRiskPolicy(savedRow,active.config,active.revision);
    if(!p)return;
    if(this.mode==='json'){
      if(!this.state.projections.some(x=>x.policyRevision===p.policyRevision&&
        x.sourceAssessmentId===p.sourceAssessmentId)){
        this.state.projections.push(p);this.jsonSave();
      }
      return;
    }
    await this.connection(async c=>{
      try{
        const exists=await c.execute(`SELECT 1 FROM NMC_RISK_POLICY_PROJECTION
          WHERE POLICY_VERSION_NO=:revision AND ASSESSMENT_ID=:assessment`,
          {revision:active.revision,assessment:p.sourceAssessmentId});
        if(!exists.rows.length){
          await c.execute(`INSERT INTO NMC_RISK_POLICY_PROJECTION
            (POLICY_VERSION_NO,ASSESSMENT_ID,IMO,RISK_SCORE,RISK_LEVEL,OPERATIONAL_PRIORITY,
             CRITICAL_OPEN_FINDING)
            VALUES(:b_revision,:b_assessment_id,:b_imo,:b_score,:b_risk_level,:b_priority,:b_critical)`,
            {b_revision:active.revision,b_assessment_id:p.sourceAssessmentId,b_imo:p.imo,
              b_score:p.riskScore,b_risk_level:p.riskLevel,b_priority:p.operationalPriority,
              b_critical:p.criticalOpenFinding?'Y':'N'});
          await c.commit();
        }
      }catch(e){await c.rollback();if(e?.errorNum!==1)throw e;}
    });
  }
}
