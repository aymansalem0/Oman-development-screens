/** NMC synthetic-POC operational guidance: deterministic published rules, NOT Airia actions.
 * No agent calls, fake maritime evidence, task creation or regulatory decisions.
 * Existing immutable fleet assessments are never rewritten.
 */
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

export class GuidanceError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const clone=x=>JSON.parse(JSON.stringify(x));
const fields=Object.freeze({
  criticalOpenFinding:['EQUALS'], inspectionSeverity:['GTE'],certificateSeverity:['GTE'],
  historySeverity:['GTE'],movementSeverity:['GTE'],dataQualitySeverity:['GTE'],
  riskScore:['GTE'],riskLevel:['EQUALS'],operationalPriority:['EQUALS'],
  dataConflictDetected:['EQUALS']
});
const factors=['movement','inspection','certificate','dataQuality','history'];
const priorities=['ROUTINE','WATCH','HIGH','PRIORITY_REVIEW'];
const status=['ACTIVE','INACTIVE'];
const clob=v=>({val:JSON.stringify(v),type:oracledb.DB_TYPE_CLOB});
const defaultInput=[
 {id:'NMC-GUIDE-001',title:'Review outstanding critical finding',titleAr:'مراجعة الملاحظة الحرجة المفتوحة',priority:'PRIORITY_REVIEW',ownerRole:'NMC_DUTY_OFFICER',enabled:true,
  condition:{field:'criticalOpenFinding',operator:'EQUALS',value:true}},
 {id:'NMC-GUIDE-002',title:'Review elevated inspection exposure',titleAr:'مراجعة ارتفاع مخاطر التفتيش',priority:'WATCH',ownerRole:'MARITIME_INSPECTION_OFFICER',enabled:true,
  condition:{field:'inspectionSeverity',operator:'GTE',value:75}},
 {id:'NMC-GUIDE-003',title:'Verify structural identity-data conflict',titleAr:'التحقق من تعارض بيانات هوية السفينة',priority:'HIGH',ownerRole:'NMC_DATA_QUALITY_OFFICER',enabled:false,
  condition:{field:'dataConflictDetected',operator:'EQUALS',value:true}},
 {id:'NMC-GUIDE-004',title:'Review elevated certificate exposure',titleAr:'مراجعة ارتفاع مخاطر الشهادات',priority:'WATCH',ownerRole:'CERTIFICATE_REVIEW_OFFICER',enabled:false,
  condition:{field:'certificateSeverity',operator:'GTE',value:75}}
];
function validatedCondition(c){
  if(!c||typeof c!=='object'||Array.isArray(c))throw new GuidanceError('GUIDANCE_RULE_INVALID');
  const allowed=fields[c.field];
  if(!allowed||!allowed.includes(c.operator))throw new GuidanceError('GUIDANCE_RULE_INVALID');
  if(c.field.endsWith('Severity')||c.field==='riskScore'){
    if(!Number.isInteger(c.value)||c.value<0||c.value>100)throw new GuidanceError('GUIDANCE_RULE_INVALID');
  }else if(c.field==='riskLevel'){
    if(!['Normal','Watch','High','Critical'].includes(c.value))throw new GuidanceError('GUIDANCE_RULE_INVALID');
  }else if(c.field==='operationalPriority'){
    if(!['Routine','Enhanced Monitoring','Priority Review'].includes(c.value))throw new GuidanceError('GUIDANCE_RULE_INVALID');
  }else if(typeof c.value!=='boolean')throw new GuidanceError('GUIDANCE_RULE_INVALID');
  return {field:c.field,operator:c.operator,value:c.value};
}
function validateRule(input,id){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new GuidanceError('GUIDANCE_RULE_INVALID');
  const title=String(input.title||'').trim(),titleAr=String(input.titleAr||'').trim();
  const extra=input.additionalConditions??[];
  if(!title||title.length>140||!titleAr||titleAr.length>140||
     !priorities.includes(input.priority)||typeof input.enabled!=='boolean'||
     !/^[A-Z][A-Z0-9_]{2,55}$/.test(String(input.ownerRole||''))||
     !Array.isArray(extra)||extra.length>5)
     throw new GuidanceError('GUIDANCE_RULE_INVALID');
  return {id,title,titleAr,priority:input.priority,ownerRole:input.ownerRole,
    enabled:input.enabled,condition:validatedCondition(input.condition),
    additionalConditions:extra.map(validatedCondition)};
}
const starter=defaultInput.map(input=>({id:input.id,revision:1,status:input.enabled?'ACTIVE':'INACTIVE',
  published:validateRule(input,input.id),draft:null,
  publishedRevision:1,updatedAt:new Date().toISOString()}));
const jsonPath=process.env.NMC_GUIDANCE_STORE_PATH||'/data/nmc-guidance.json';
export class OperationalGuidance{
  constructor({mode='oracle',oracleRepository=null,fleet=null}={}){
    this.mode=mode;this.oracle=oracleRepository;this.fleet=fleet;
    this.jsonState=null;
  }
  async withConnection(fn){
    if(!this.oracle?.pool)throw new GuidanceError('GUIDANCE_ORACLE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await fn(con);}finally{await con.close();}
  }
  async initialize(){
    if(this.mode==='json'){
      if(existsSync(jsonPath)){
        try{const d=JSON.parse(readFileSync(jsonPath,'utf8'));if(d.schema===1&&Array.isArray(d.rules)&&Array.isArray(d.results))this.jsonState=d;}
        catch{throw new GuidanceError('GUIDANCE_JSON_INVALID',503);}
      }
      if(!this.jsonState){this.jsonState={schema:1,rules:clone(starter),results:[],audit:[]};this.writeJson();}
      return;
    }
    await this.withConnection(async con=>{
      try{
        const r=await con.execute('SELECT RULE_ID FROM NMC_GUIDANCE_POLICY FETCH FIRST 1 ROWS ONLY');
        if(!r.rows.length){
          for(const state of starter){
            await con.execute('INSERT INTO NMC_GUIDANCE_POLICY(RULE_ID,REVISION,STATUS,RULE_JSON) VALUES(:id,:revision,:status,:doc)',
              {id:state.id,revision:1,status:state.status,doc:clob(state)});
            await this.writeAudit(con,state,'SEED','PLATFORM');
          }
          await con.commit();
        }
      }catch(e){await con.rollback();throw new GuidanceError('GUIDANCE_SCHEMA_NOT_READY',503);}
    });
  }
  writeJson(){
    mkdirSync(dirname(jsonPath),{recursive:true});
    const tmp=jsonPath+'.tmp';writeFileSync(tmp,JSON.stringify(this.jsonState),{mode:0o600});renameSync(tmp,jsonPath);
  }
  async list(){
    if(this.mode==='json')return clone(this.jsonState.rules);
    return this.withConnection(async con=>{
      try{
        const rows=await con.execute('SELECT RULE_JSON FROM NMC_GUIDANCE_POLICY ORDER BY RULE_ID',{}, {outFormat:oracledb.OUT_FORMAT_OBJECT});
        return rows.rows.map(r=>JSON.parse(r.RULE_JSON));
      }catch{throw new GuidanceError('GUIDANCE_SCHEMA_NOT_READY',503);}
    });
  }
  async writeAudit(con,state,action,role){
    await con.execute('INSERT INTO NMC_GUIDANCE_POLICY_AUDIT(AUDIT_ID,RULE_ID,REVISION,ACTION_NAME,ACTOR_ROLE,RULE_JSON) VALUES(:id,:ruleId,:rev,:action,:role,:doc)',
      {id:randomUUID(),ruleId:state.id,rev:state.revision,action,role,doc:clob(state)});
  }
  async history(ruleId){
    if(this.mode==='json')return clone(this.jsonState.audit.filter(a=>a.ruleId===ruleId)).reverse();
    return this.withConnection(async con=>{
      const r=await con.execute('SELECT REVISION,ACTION_NAME,ACTOR_ROLE,TO_CHAR(CREATED_AT AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"\') CREATED_AT FROM NMC_GUIDANCE_POLICY_AUDIT WHERE RULE_ID=:id ORDER BY CREATED_AT DESC FETCH FIRST 100 ROWS ONLY',
        {id:ruleId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.map(x=>({revision:x.REVISION,action:x.ACTION_NAME,role:x.ACTOR_ROLE,at:x.CREATED_AT}));
    });
  }
  async create(input){
    const id=String(input?.id||'');
    if(!/^NMC-GUIDE-[0-9]{3,5}$/.test(id))throw new GuidanceError('GUIDANCE_RULE_INVALID');
    const draft=validateRule(input,id);
    const newState={id,revision:1,status:'DRAFT',published:null,draft,
      publishedRevision:0,updatedAt:new Date().toISOString()};
    if(this.mode==='json'){
      if(this.jsonState.rules.some(r=>r.id===id))throw new GuidanceError('GUIDANCE_RULE_EXISTS',409);
      this.jsonState.rules.push(newState);
      this.jsonState.audit.push({ruleId:id,revision:1,action:'CREATE',role:'EDITOR',at:newState.updatedAt});
      this.writeJson();
      return clone(newState);
    }
    return this.withConnection(async con=>{
      try{
        await con.execute('INSERT INTO NMC_GUIDANCE_POLICY(RULE_ID,REVISION,STATUS,RULE_JSON) VALUES(:id,:revision,:status,:doc)',
          {id,revision:1,status:'DRAFT',doc:clob(newState)});
        await this.writeAudit(con,newState,'CREATE','EDITOR');
        await con.commit();return newState;
      }catch(e){
        await con.rollback();
        if(e?.errorNum===1)throw new GuidanceError('GUIDANCE_RULE_EXISTS',409);
        throw new GuidanceError('GUIDANCE_WRITE_FAILED',503);
      }
    });
  }
  async change(ruleId,revision,operation,draft){
    if(!/^NMC-GUIDE-[0-9]{3,5}$/.test(ruleId))throw new GuidanceError('GUIDANCE_RULE_NOT_FOUND',404);
    if(!Number.isInteger(revision)||revision<1)throw new GuidanceError('GUIDANCE_VERSION_INVALID');
    if(!['EDIT','PUBLISH'].includes(operation))throw new GuidanceError('GUIDANCE_OPERATION_INVALID');
    const changeState=state=>{
      if(!state)throw new GuidanceError('GUIDANCE_RULE_NOT_FOUND',404);
      if(state.revision!==revision)throw new GuidanceError('GUIDANCE_VERSION_CONFLICT',409);
      const next=clone(state);next.revision++;
      if(operation==='EDIT'){next.draft=validateRule(draft,ruleId);}
      else{
        if(!next.draft)throw new GuidanceError('GUIDANCE_NO_DRAFT',409);
        next.published=next.draft;next.draft=null;next.publishedRevision=next.revision;
        next.status=next.published.enabled?'ACTIVE':'INACTIVE';
      }
      next.updatedAt=new Date().toISOString();return next;
    };
    if(this.mode==='json'){
      const i=this.jsonState.rules.findIndex(r=>r.id===ruleId),next=changeState(this.jsonState.rules[i]);
      this.jsonState.rules[i]=next;
      this.jsonState.audit.push({ruleId,revision:next.revision,action:operation,
        role:operation==='PUBLISH'?'SUPERVISOR':'EDITOR',at:next.updatedAt});
      this.writeJson();return clone(next);
    }
    return this.withConnection(async con=>{
      try{
        const query=await con.execute('SELECT RULE_JSON FROM NMC_GUIDANCE_POLICY WHERE RULE_ID=:id FOR UPDATE',
          {id:ruleId},{outFormat:oracledb.OUT_FORMAT_OBJECT});
        const next=changeState(query.rows.length?JSON.parse(query.rows[0].RULE_JSON):null);
        await con.execute('UPDATE NMC_GUIDANCE_POLICY SET REVISION=:rev,STATUS=:status,RULE_JSON=:doc,UPDATED_AT=SYSTIMESTAMP WHERE RULE_ID=:id',
          {rev:next.revision,status:next.status,doc:clob(next),id:ruleId});
        await this.writeAudit(con,next,operation,operation==='PUBLISH'?'SUPERVISOR':'EDITOR');
        await con.commit();return next;
      }catch(e){await con.rollback();if(e instanceof GuidanceError)throw e;throw new GuidanceError('GUIDANCE_WRITE_FAILED',503);}
    });
  }
  // Only explicit structured facts from saved assessment & persisted data-quality conflicts.
  async evaluate(imo){
    const record=this.fleet?.getVesselResult(imo);
    if(!record||record.status!=='COMPLETED'||!record.assessmentId||
       !Array.isArray(record.signals)||record.signals.length!==5)
      throw new GuidanceError('GUIDANCE_ASSESSMENT_NOT_FOUND',404);
    const rules=await this.list();
    const byFactor=Object.fromEntries(record.signals.map(s=>[s.factor,s]));
    if(factors.some(k=>!byFactor[k]||!Number.isFinite(byFactor[k].severity)))
      throw new GuidanceError('GUIDANCE_SIGNALS_INVALID',409);
    let conflicts=[];
    if(this.mode==='oracle'){
      const intel=await this.oracle.intelligence(imo);
      if(intel?.assessmentId===record.assessmentId){
        conflicts=(intel.conflicts||[]).filter(c=>c.STATUS==='PENDING_REVIEW'&&
          c.LAST_ASSESSMENT_ID===record.assessmentId&&
          ['VESSEL_NAME','FLAG','VESSEL_TYPE','OPERATOR_NAME'].includes(c.FIELD_NAME)&&
          typeof c.SOURCE_A_EVIDENCE_ID==='string'&&typeof c.SOURCE_B_EVIDENCE_ID==='string');
      }
    }
    const facts={
      criticalOpenFinding:record.criticalOpenFinding===true,
      inspectionSeverity:byFactor.inspection.severity,certificateSeverity:byFactor.certificate.severity,
      historySeverity:byFactor.history.severity,movementSeverity:byFactor.movement.severity,
      dataQualitySeverity:byFactor.dataQuality.severity,riskScore:record.score,
      riskLevel:record.level,operationalPriority:record.operationalPriority,
      dataConflictDetected:conflicts.length>0
    };
    const items=[];
    for(const s of rules){
      const policy=s.published;
      if(!policy?.enabled)continue;
      const conditions=[policy.condition,...(policy.additionalConditions||[])];
      const observed=conditions.map(condition=>{
        const actual=facts[condition.field];
        const matches=condition.operator==='EQUALS'?actual===condition.value:
          condition.operator==='GTE'?typeof actual==='number'&&actual>=condition.value:false;
        return {condition,observedValue:actual,matches};
      });
      if(!observed.every(x=>x.matches))continue;
      const factorOf=field=>field.endsWith('Severity')?field.replace('Severity',''):
        field==='criticalOpenFinding'?'inspection':
        field==='dataConflictDetected'?'dataQuality':null;
      const ids=conditions.flatMap(condition=>{
        const field=condition.field;
        if(field==='dataConflictDetected')
          return conflicts.flatMap(c=>[c.SOURCE_A_EVIDENCE_ID,c.SOURCE_B_EVIDENCE_ID]);
        const factor=factorOf(field);
        return factor?byFactor[factor]?.evidenceIds||[]:
          [...new Set(record.signals.flatMap(sig=>sig.evidenceIds||[]))];
      }).filter(id=>typeof id==='string'&&id.length>0);
      if(!ids.length)continue;
      const factor=factorOf(policy.condition.field);
      const actual=observed[0].observedValue;
      items.push({
        id:record.assessmentId+':'+s.id+':'+s.publishedRevision,
        ruleId:s.id,ruleRevision:s.publishedRevision,title:policy.title,titleAr:policy.titleAr,
        priority:policy.priority,ownerRole:policy.ownerRole,source:'PLATFORM_BUSINESS_RULE',
        status:'ADVISORY_ONLY',condition:policy.condition,observedValue:actual,
        matchedConditions:observed.map(x=>({condition:x.condition,observedValue:x.observedValue})),
        evidenceIds:[...new Set(ids)].slice(0,60),factor:factor||'assessment',agent:factor?byFactor[factor]?.sourceAgent:null,
        assessmentId:record.assessmentId,generatedAt:new Date().toISOString()
      });
    }
    return {status:'ok',imo,assessmentId:record.assessmentId,assessedAt:record.assessedAt,
      riskScore:record.score,riskLevel:record.level,operationalPriority:record.operationalPriority,
      source:'SYNTHETIC_POC_NOT_REGULATORY',policyCount:rules.filter(r=>r.published?.enabled).length,
      rules:items};
  }
  async materialize(imo){
    const result=await this.evaluate(imo);
    if(this.mode==='json'){
      for(const item of result.rules)if(!this.jsonState.results.some(x=>x.id===item.id))
        this.jsonState.results.push(item);
      this.writeJson();return result;
    }
    await this.withConnection(async con=>{
      try{
        for(const item of result.rules){
          const saved=await con.execute('SELECT 1 FROM NMC_GUIDANCE_RESULT WHERE ASSESSMENT_ID=:assess AND RULE_ID=:id AND RULE_REVISION=:rev',
            {assess:result.assessmentId,id:item.ruleId,rev:item.ruleRevision});
          if(saved.rows.length)continue;
          await con.execute('INSERT INTO NMC_GUIDANCE_RESULT(ASSESSMENT_ID,RULE_ID,RULE_REVISION,RESULT_JSON) VALUES(:assess,:id,:rev,:doc)',
            {assess:result.assessmentId,id:item.ruleId,rev:item.ruleRevision,doc:clob(item)});
        }
        await con.commit();
      }catch(e){await con.rollback();throw new GuidanceError('GUIDANCE_RESULT_SAVE_FAILED',503);}
    });
    return result;
  }
}
