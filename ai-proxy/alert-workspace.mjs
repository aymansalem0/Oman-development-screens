/**
 * National Maritime Center POC — centrally persisted, in-app event alerts.
 * Only reads already-saved A01/A02 fleet results. Does NOT execute Airia,
 * recalculate any official stored assessment, or modify vessel risk.
 * Oracle schema is additive and must be migrated manually by the owner.
 */
import {randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import oracledb from 'oracledb';

const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
const validImo=imo=>typeof imo==='string'&&/^\d{7}$/.test(imo);
const jsonClob=value=>({val:JSON.stringify(value),type:oracledb.DB_TYPE_CLOB});
const stamp=column=>`TO_CHAR(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`;
const allowedActions=['ACKNOWLEDGE','START_FOLLOW_UP','ESCALATE','RESOLVE'];
const isActive=row=>row.status!=='RESOLVED';

export class NmcAlertError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

export class NmcAlertWorkspace {
  constructor({
    mode='json',oracleRepository=null,
    file=process.env.NMC_ALERT_STORE_PATH||'/data/nmc-alert-workspace.json',
    escalationMinutes=Number(process.env.NMC_ALERT_ESCALATE_MINUTES||15)
  }={}){
    if(!['oracle','json'].includes(mode))throw new Error('NMC_ALERT_MODE_INVALID');
    this.mode=mode;this.oracle=oracleRepository;this.file=file;
    this.escalationMinutes=Number.isFinite(escalationMinutes)&&escalationMinutes>=1
      ?escalationMinutes:15;
    this.running=false;
  }

  async list(){
    if(this.mode==='json')return Object.values(this._load().alerts).map(clone)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return this._db(async con=>{
      const r=await con.execute(`SELECT DOC_JSON FROM NMC_ALERT ORDER BY CREATED_AT DESC`,
        [],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.map(row=>JSON.parse(row.DOC_JSON));
    });
  }

  async get(id){
    if(!validId(id))throw new NmcAlertError('ALERT_ID_INVALID');
    if(this.mode==='json')return clone(this._load().alerts[id]||null);
    return this._db(async con=>{
      const r=await con.execute('SELECT DOC_JSON FROM NMC_ALERT WHERE ALERT_ID=:id',
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.length?JSON.parse(r.rows[0].DOC_JSON):null;
    });
  }

  async history(id){
    if(!validId(id))throw new NmcAlertError('ALERT_ID_INVALID');
    if(this.mode==='json')return clone(this._load().history[id]||[]);
    return this._db(async con=>{
      const r=await con.execute(`SELECT VERSION_NO,ACTION_NAME,ACTOR_ROLE,NOTE,
        ${stamp('CHANGED_AT')} CHANGED_AT FROM NMC_ALERT_AUDIT
        WHERE ALERT_ID=:id ORDER BY VERSION_NO DESC`,
        {id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return r.rows.map(row=>({version:row.VERSION_NO,
        action:row.ACTION_NAME,role:row.ACTOR_ROLE,note:row.NOTE,at:row.CHANGED_AT}));
    });
  }

  async overview(projections=null){
    const alerts=await this.list();
    const byImo=projections?new Map(projections.projections.map(p=>[p.imo,p])):null;
    for(const a of alerts){
      const p=byImo?.get(a.imo);
      if(!p)continue;
      a.effectiveRiskScore=p.riskScore;
      a.effectiveRiskLevel=p.riskLevel;
      a.effectivePriority=p.operationalPriority;
      a.effectivePolicyRevision=p.policyRevision;
      a.effectivePolicyRef=p.policyVersion;
      a.effectiveAssessmentId=p.sourceAssessmentId;
      a.policyApplicable=p.criticalOpenFinding||
        p.riskLevel==='High'||p.riskLevel==='Critical';
      a.effectiveSeverity=p.criticalOpenFinding||p.riskLevel==='Critical'?
        'CRITICAL':p.riskLevel==='High'?'HIGH':a.severity;
      a.effectiveTrigger=p.criticalOpenFinding?'CRITICAL_OPEN_FINDING':'RISK_BAND';
    }
    const summary={
      total:alerts.length,active:0,open:0,acknowledged:0,
      inProgress:0,escalated:0,critical:0,high:0,unread:0
    };
    for(const a of alerts){
      if(!isActive(a)||a.policyApplicable===false)continue;
      summary.active++;
      if(a.status==='OPEN'){summary.open++;summary.unread++;}
      if(a.status==='ACKNOWLEDGED')summary.acknowledged++;
      if(a.status==='IN_PROGRESS')summary.inProgress++;
      if(a.status==='ESCALATED'){summary.escalated++;summary.unread++;}
      if((a.effectiveSeverity||a.severity)==='CRITICAL')summary.critical++;
      if((a.effectiveSeverity||a.severity)==='HIGH')summary.high++;
    }
    return {status:'ok',alerts,summary,updatedAt:now(),
      riskPolicyRevision:projections?.policyRevision||null,
      riskPolicyRef:projections?.policyRef||null};
  }

  /**
   * Scan the fleet snapshot already available in server RAM (persisted AI
   * assessments only). Dedupe by IMO+band, ignoring browser-only rule changes.
   * If not assessed: NEVER create an alert or invent risk evidence.
   */
  async scanFleet(snapshot){
    if(this.running)return {skipped:true};
    this.running=true;
    let created=0,escalated=0;
    try{
      const current=await this.list();
      const byKey=new Set(current.map(row=>row.alertKey));
      const alreadyActive=new Set(current.filter(a=>a.status!=='RESOLVED').map(a=>a.imo));
      for(const row of Object.values(snapshot?.results||{})){
        if(row?.status!=='COMPLETED'||!validImo(row.imo)||!Number.isFinite(row.score))continue;
        const critical=row.level==='Critical'||row.criticalOpenFinding===true;
        const high=row.level==='High';
        if(!critical&&!high)continue;
        const severity=critical?'CRITICAL':'HIGH';
        const alertKey=`AI_RISK:${row.imo}:${severity}`;
        if(byKey.has(alertKey)||alreadyActive.has(row.imo))continue;
        const sourceId=typeof row.assessmentId==='string'?
          row.assessmentId.slice(0,100):null;
        const title=critical?'Critical maritime risk requires review':
          'High maritime risk requires review';
        const detail=row.criticalOpenFinding
          ?'A completed AI assessment identifies a critical open inspection finding.'
          :'A completed AI assessment exceeds the operational risk monitoring band.';
        const item={
          id:randomUUID(),alertKey,imo:row.imo,
          severity,status:'OPEN',assignedRole:'NMC_OFFICER',
          source:'SAVED_AI_ASSESSMENT',sourceAssessmentId:sourceId,
          sourceScore:Number.isFinite(row.sourceAiScore)?row.sourceAiScore:row.score,
          sourceLevel:row.sourceAiLevel||row.level,
          sourceRulesetVersion:row.sourceAiScore!==undefined?
            (row.aiRulesetVersion||'SAVED_AI_SOURCE'):row.configVersion||null,
          triggeredByPolicyVersion:row.configVersion||null,
          triggeredByPolicyRevision:row.riskPolicyRevision||null,
          triggeringRiskScore:row.score,triggeringRiskLevel:row.level,
          title,detail,actionHint:'Review vessel evidence and decide follow-up',
          version:1,createdAt:now(),updatedAt:now(),
          provenance:'SYNTHETIC_POC_NON_REGULATORY'
        };
        const inserted=await this._insert(item);
        if(inserted){byKey.add(alertKey);alreadyActive.add(row.imo);created++;}
      }
      // Business monitoring threshold, not an MOEI contractual SLA.
      for(const item of await this.list()){
        if(item.status!=='OPEN'||item.severity!=='CRITICAL')continue;
        const age=Date.now()-new Date(item.createdAt).getTime();
        if(Number.isFinite(age)&&age>=this.escalationMinutes*60000){
          try{
            await this.transition(item.id,'ESCALATE',item.version,
              'Critical event not acknowledged within configured monitoring window',
              'SYSTEM');
            escalated++;
          }catch(err){
            if(err.code!=='ALERT_VERSION_CONFLICT'&&err.code!=='ALERT_TRANSITION_INVALID')
              throw err;
          }
        }
      }
      return {created,escalated};
    }finally{this.running=false;}
  }

  async _insert(item){
    const audit={version:1,action:'DETECTED',role:'SYSTEM',
      note:'Created from saved A01/A02 fleet assessment',at:item.createdAt};
    if(this.mode==='json'){
      const db=this._load();
      if(Object.values(db.alerts).some(a=>a.alertKey===item.alertKey))return false;
      db.alerts[item.id]=item;db.history[item.id]=[audit];
      this._write(db);return true;
    }
    return this._db(async con=>{
      try{
        await con.execute(`INSERT INTO NMC_ALERT
          (ALERT_ID,ALERT_KEY,IMO,STATUS,SEVERITY,ASSIGNED_ROLE,VERSION_NO,DOC_JSON)
          VALUES(:id,:key,:imo,:status,:severity,:assigned,:version,:doc)`,{
          id:item.id,key:item.alertKey,imo:item.imo,status:item.status,
          severity:item.severity,assigned:item.assignedRole,
          version:item.version,doc:jsonClob(item)
        });
        await this._addAudit(con,item.id,audit);
        await con.commit();
        return true;
      }catch(err){
        await con.rollback();
        if(err?.errorNum===1)return false; // Idempotent unique alert key
        throw err;
      }
    });
  }

  async transition(id,action,expectedVersion,note='',role='OPERATOR'){
    if(!validId(id))throw new NmcAlertError('ALERT_ID_INVALID');
    if(!allowedActions.includes(action))throw new NmcAlertError('ALERT_ACTION_INVALID');
    if(!Number.isInteger(expectedVersion)||expectedVersion<1)
      throw new NmcAlertError('ALERT_VERSION_REQUIRED');
    if(typeof note!=='string'||note.length>500)throw new NmcAlertError('ALERT_NOTE_INVALID');
    if(action==='RESOLVE'&&!note.trim())
      throw new NmcAlertError('ALERT_RESOLUTION_NOTE_REQUIRED');
    const nextState=current=>{
      if(!current)throw new NmcAlertError('ALERT_NOT_FOUND',404);
      if(current.version!==expectedVersion)
        throw new NmcAlertError('ALERT_VERSION_CONFLICT',409);
      const allowed={
        ACKNOWLEDGE:['OPEN'],
        START_FOLLOW_UP:['ACKNOWLEDGED','ESCALATED'],
        ESCALATE:['OPEN','ACKNOWLEDGED','IN_PROGRESS'],
        RESOLVE:['ACKNOWLEDGED','IN_PROGRESS','ESCALATED']
      };
      if(!allowed[action].includes(current.status))
        throw new NmcAlertError('ALERT_TRANSITION_INVALID',409);
      if(action==='RESOLVE'&&current.severity==='CRITICAL'&&role!=='SUPERVISOR')
        throw new NmcAlertError('ALERT_SUPERVISOR_REQUIRED',403);
      const status={
        ACKNOWLEDGE:'ACKNOWLEDGED',
        START_FOLLOW_UP:'IN_PROGRESS',
        ESCALATE:'ESCALATED',
        RESOLVE:'RESOLVED'
      }[action];
      return {...current,status,
        assignedRole:action==='ESCALATE'?'NMC_SUPERVISOR':current.assignedRole,
        version:current.version+1,updatedAt:now()};
    };
    if(this.mode==='json'){
      const db=this._load();const next=nextState(db.alerts[id]);
      const audit={version:next.version,action,role,note:note.trim(),at:next.updatedAt};
      db.alerts[id]=next;db.history[id]=[audit,...(db.history[id]||[])];
      this._write(db);return clone(next);
    }
    return this._db(async con=>{
      try{
        const cur=await con.execute(`SELECT DOC_JSON FROM NMC_ALERT
          WHERE ALERT_ID=:id FOR UPDATE`,{id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
        const current=cur.rows.length?JSON.parse(cur.rows[0].DOC_JSON):null;
        const next=nextState(current);
        const update=await con.execute(`UPDATE NMC_ALERT SET STATUS=:status,
          ASSIGNED_ROLE=:assigned,VERSION_NO=:version,DOC_JSON=:doc,
          UPDATED_AT=SYSTIMESTAMP WHERE ALERT_ID=:id AND VERSION_NO=:expected`,{
          status:next.status,assigned:next.assignedRole,version:next.version,
          doc:jsonClob(next),id,expected:expectedVersion
        });
        if(update.rowsAffected!==1)throw new NmcAlertError('ALERT_VERSION_CONFLICT',409);
        await this._addAudit(con,id,{version:next.version,action,role,
          note:note.trim(),at:next.updatedAt});
        await con.commit();return next;
      }catch(err){await con.rollback();throw err;}
    });
  }

  async _addAudit(con,id,entry){
    await con.execute(`INSERT INTO NMC_ALERT_AUDIT
      (ALERT_ID,VERSION_NO,ACTION_NAME,ACTOR_ROLE,NOTE)
      VALUES(:id,:version,:action,:role,:note)`,{
      id,version:entry.version,action:entry.action,role:entry.role,note:entry.note
    });
  }

  async _db(work){
    if(!this.oracle?.pool)throw new NmcAlertError('ALERT_STORE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await work(con);}
    catch(error){
      if(error instanceof NmcAlertError)throw error;
      if([942,904].includes(error?.errorNum))
        throw new NmcAlertError('ALERT_SCHEMA_NOT_READY',503);
      throw new NmcAlertError('ALERT_STORE_UNAVAILABLE',503);
    }finally{await con.close();}
  }

  _load(){
    if(!existsSync(this.file))return {schema:1,alerts:{},history:{}};
    try{
      const record=JSON.parse(readFileSync(this.file,'utf8'));
      if(record.schema===1&&record.alerts&&record.history)return record;
    }catch{throw new NmcAlertError('ALERT_STORE_UNAVAILABLE',503);}
    throw new NmcAlertError('ALERT_STORE_UNAVAILABLE',503);
  }
  _write(content){
    try{
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp';
      writeFileSync(tmp,JSON.stringify(content),{encoding:'utf8',mode:0o600});
      renameSync(tmp,this.file);
    }catch{throw new NmcAlertError('ALERT_STORE_UNAVAILABLE',503);}
  }
}
