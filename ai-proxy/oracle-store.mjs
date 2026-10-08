import oracledb from 'oracledb';
import { randomUUID } from 'node:crypto';

// Oracle thin driver, schema must be provisioned manually in FREEPDB1.
// No DDL, admin credentials, password logs, or fallback to JSON in Oracle mode.
const mask = 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM';
const time = name => `TO_CHAR(${name} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`;
const utc = v => v ? new Date(v).toISOString().replace('Z', '+00:00') : null;
const jsonClob = value => ({val:JSON.stringify(value??null),type:oracledb.DB_TYPE_CLOB});
const sourceId = id => id.startsWith('PSC-SIM-')||id.startsWith('DET-PSC-SIM-') ?
  'PSC_GOOGLE_SIM' : 'NMC_INTERNAL_SIM';

export class OracleIntelligenceStore {
  constructor({user=process.env.NMC_DB_USER,password=process.env.NMC_DB_PASSWORD,
    connectString=process.env.NMC_DB_CONNECT_STRING}={}){
    this.connectionOptions={user,password,connectString};
    this.pool=null;
  }

  async init(){
    if(!this.connectionOptions.user||!this.connectionOptions.password||
       !this.connectionOptions.connectString)throw new Error('ORACLE_DB_CONFIGURATION_MISSING');
    oracledb.fetchAsString=[oracledb.CLOB];
    try {
      this.pool=await oracledb.createPool({...this.connectionOptions,
        poolMin:1,poolMax:4,poolIncrement:1,queueTimeout:15000});
      const con=await this.pool.getConnection();
      try{
        const result=await con.execute(
          'SELECT VERSION_NUMBER FROM NMC_SCHEMA_VERSION WHERE VERSION_NUMBER=1');
        if(result.rows.length!==1)throw new Error('ORACLE_NMC_SCHEMA_V1_MISSING');
      }finally{await con.close();}
    }catch(error){
      if(this.pool){await this.pool.close(0);this.pool=null;}
      if(error.message==='ORACLE_NMC_SCHEMA_V1_MISSING')throw error;
      throw new Error('ORACLE_SCHEMA_UNAVAILABLE');
    }
  }

  async health(){
    if(!this.pool)return {mode:'oracle',ready:false};
    try{
      const con=await this.pool.getConnection();
      try{await con.execute('SELECT 1 FROM DUAL');return {mode:'oracle',ready:true,schemaVersion:1};}
      finally{await con.close();}
    }catch{return {mode:'oracle',ready:false};}
  }

  async seedVessels(bundles){
    const con=await this.pool.getConnection();
    try{
      await con.executeMany(`MERGE INTO NMC_VESSEL d
        USING(SELECT :imo IMO,:name VESSEL_NAME,:flag FLAG,
        :vesselType VESSEL_TYPE,:operator OPERATOR_NAME FROM DUAL) s
        ON(d.IMO=s.IMO)
        WHEN MATCHED THEN UPDATE SET d.VESSEL_NAME=s.VESSEL_NAME,
          d.FLAG=s.FLAG,d.VESSEL_TYPE=s.VESSEL_TYPE,d.OPERATOR_NAME=s.OPERATOR_NAME
        WHEN NOT MATCHED THEN INSERT(IMO,VESSEL_NAME,FLAG,VESSEL_TYPE,OPERATOR_NAME)
        VALUES(s.IMO,s.VESSEL_NAME,s.FLAG,s.VESSEL_TYPE,s.OPERATOR_NAME)`,
      bundles.map(b=>{const v=b.inlineContext.vessel;return{
        imo:b.imo,name:String(v.name||b.imo).slice(0,200),
        flag:String(v.flag||'Unknown').slice(0,80),
        vesselType:String(v.vesselType||'Unknown').slice(0,80),
        operator:String(v.operator||'Unknown').slice(0,250)};}));
      for(const [id,name,cls] of [
        ['NMC_INTERNAL_SIM','NMC Vessel 360 synthetic fixture','INTERNAL_SIMULATION'],
        ['PSC_GOOGLE_SIM','Google Sheets synthetic PSC dataset','EXTERNAL_SIMULATION']]){
        await con.execute(`MERGE INTO NMC_DATA_SOURCE d
          USING(SELECT :id SOURCE_ID,:name SOURCE_NAME,:cls SOURCE_CLASS FROM DUAL) s
          ON(d.SOURCE_ID=s.SOURCE_ID)
          WHEN NOT MATCHED THEN INSERT(SOURCE_ID,SOURCE_NAME,SOURCE_CLASS)
          VALUES(s.SOURCE_ID,s.SOURCE_NAME,s.SOURCE_CLASS)`,{id,name,cls});
      }
      await con.commit();
    }catch{await con.rollback();throw new Error('ORACLE_VESSEL_SEED_FAILED');}
    finally{await con.close();}
  }

  async loadLatest(){
    const con=await this.pool.getConnection();
    try{
      const sql=`SELECT st.IMO,st.STATUS,st.ASSESSMENT_ID,
        ${time('st.LAST_CHECKED_AT')} LAST_CHECKED_AT,
        ${time('st.NEXT_CHECK_AT')} NEXT_CHECK_AT,
        ${time('st.ATTEMPTED_AT')} ATTEMPTED_AT,
        st.REFRESH_FAILURE,st.FAILURE_REASON,
        a.RISK_SCORE,a.RISK_LEVEL,a.OPERATIONAL_PRIORITY,a.CRITICAL_OPEN_FINDING,
        a.RULESET_VERSION,a.INPUT_HASH,a.SOURCE_MODE,a.SOURCE_NATURE,a.RULESET_JSON,
        a.PSC_SUMMARY_JSON,${time('a.ASSESSED_AT')} ASSESSED_AT
        FROM NMC_VESSEL_CURRENT_STATE st
        LEFT JOIN NMC_AI_ASSESSMENT a ON a.ASSESSMENT_ID=st.ASSESSMENT_ID`;
      const query=await con.execute(sql,{},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      const map={};const byId={};
      for(const r of query.rows){
        const record={imo:r.IMO,status:r.STATUS,
          lastCheckedAt:r.LAST_CHECKED_AT||undefined,
          nextCheckAt:r.NEXT_CHECK_AT||undefined,
          attemptedAt:r.ATTEMPTED_AT||undefined,
          refreshFailure:r.REFRESH_FAILURE||null,reasonCode:r.FAILURE_REASON||undefined,
          authoritative:false};
        if(r.ASSESSMENT_ID){
          Object.assign(record,{
            assessmentId:r.ASSESSMENT_ID,score:r.RISK_SCORE,level:r.RISK_LEVEL,
            operationalPriority:r.OPERATIONAL_PRIORITY,
            criticalOpenFinding:r.CRITICAL_OPEN_FINDING==='Y',
            configVersion:r.RULESET_VERSION,sourceMode:r.SOURCE_MODE,
            sourceNature:r.SOURCE_NATURE,inputHash:r.INPUT_HASH,
            assessedAt:r.ASSESSED_AT,signals:[],
            ruleset:JSON.parse(r.RULESET_JSON),
            pscSummary:r.PSC_SUMMARY_JSON?JSON.parse(r.PSC_SUMMARY_JSON):null,
            reviewedByHuman:false,evidenceVerified:false
          });
          byId[r.ASSESSMENT_ID]=record;
        }
        map[r.IMO]=record;
      }
      const factors=await con.execute(`SELECT f.ASSESSMENT_ID,f.FACTOR_KEY,f.SEVERITY,
        f.CONFIDENCE,f.AGENT_CODE,f.REASON_TEXT,f.EVIDENCE_IDS_JSON
        FROM NMC_AI_RISK_FACTOR f
        JOIN NMC_VESSEL_CURRENT_STATE c ON c.ASSESSMENT_ID=f.ASSESSMENT_ID`,
        {},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      for(const f of factors.rows){
        byId[f.ASSESSMENT_ID]?.signals.push({
          factor:f.FACTOR_KEY,severity:f.SEVERITY,confidence:f.CONFIDENCE,
          sourceAgent:f.AGENT_CODE,reason:f.REASON_TEXT||'',
          evidenceIds:JSON.parse(f.EVIDENCE_IDS_JSON)
        });
      }
      return map;
    }catch{throw new Error('ORACLE_LOAD_FAILED');}
    finally{await con.close();}
  }

  async saveJob(job){
    const con=await this.pool.getConnection();
    try{
      await con.execute(`MERGE INTO NMC_AI_JOB d USING(SELECT :id JOB_ID FROM DUAL) s
        ON(d.JOB_ID=s.JOB_ID)
        WHEN MATCHED THEN UPDATE SET d.STATUS=:status,
          d.COMPLETED_COUNT=:completed,d.FAILED_COUNT=:failed,
          d.FINISHED_AT=CASE WHEN :finished=1 THEN SYSTIMESTAMP ELSE NULL END
        WHEN NOT MATCHED THEN INSERT(JOB_ID,STATUS,TOTAL_COUNT,COMPLETED_COUNT,
          FAILED_COUNT,STARTED_AT)
          VALUES(:id,:status,:total,:completed,:failed,SYSTIMESTAMP)`,
        {id:job.id,status:job.status,total:job.total,
          completed:job.completed,failed:job.failed,
          finished:job.status==='RUNNING'?0:1},{autoCommit:true});
    }catch{throw new Error('ORACLE_JOB_WRITE_FAILED');}
    finally{await con.close();}
  }

  async saveAssessment(row,{previous=null,jobId=null}={}){
    const con=await this.pool.getConnection();
    const id=randomUUID();
    try{
      await con.execute(`INSERT INTO NMC_AI_ASSESSMENT(
        ASSESSMENT_ID,IMO,JOB_ID,RISK_SCORE,RISK_LEVEL,OPERATIONAL_PRIORITY,
        CRITICAL_OPEN_FINDING,RULESET_VERSION,INPUT_HASH,SOURCE_MODE,
        RULESET_JSON,PSC_SUMMARY_JSON,SOURCE_NATURE,VERIFIED_BY_AUTHORITY)
        VALUES(:id,:imo,:jobId,:score,:level,:priority,:critical,:version,
          :hash,:sourceMode,:ruleset,:pscSummary,:sourceNature,'N')`,
        {id,imo:row.imo,jobId,score:row.score,level:row.level,
          priority:row.operationalPriority,critical:row.criticalOpenFinding?'Y':'N',
          version:row.configVersion,hash:row.inputHash||null,
          sourceMode:row.sourceMode,ruleset:jsonClob(row.ruleset),
          pscSummary:jsonClob(row.pscSummary),
          sourceNature:row.sourceNature||'SYNTHETIC_NOT_RIYADH_MOU'});
      const evidence=new Set();
      for(const signal of row.signals){
        await con.execute(`INSERT INTO NMC_AI_RISK_FACTOR(
          ASSESSMENT_ID,FACTOR_KEY,SEVERITY,CONFIDENCE,AGENT_CODE,
          REASON_TEXT,EVIDENCE_IDS_JSON)
          VALUES(:id,:factor,:severity,:confidence,:agent,:reason,:evidence)`,
          {id,factor:signal.factor,severity:signal.severity,
            confidence:signal.confidence,agent:signal.sourceAgent,
            reason:String(signal.reason||'').slice(0,1800),
            evidence:jsonClob(signal.evidenceIds)});
        for(const ev of signal.evidenceIds)evidence.add(ev);
        await con.execute(`INSERT INTO NMC_AI_FINDING(FINDING_ID,ASSESSMENT_ID,
          FINDING_TYPE,SUMMARY_TEXT,SEVERITY,CONFIDENCE,EVIDENCE_IDS_JSON,
          REQUIRES_HUMAN_REVIEW)
          VALUES(:finding,:assessmentId,'AI_RISK_SIGNAL',:summary,:severity,
            :confidence,:evidence,'Y')`,
          {finding:randomUUID(),assessmentId:id,
            summary:String(signal.reason||'Risk signal').slice(0,1800),
            severity:signal.severity,confidence:signal.confidence,
            evidence:jsonClob(signal.evidenceIds)});
      }
      for(const evidenceId of evidence){
        await con.execute(`INSERT INTO NMC_EVIDENCE(
          ASSESSMENT_ID,EVIDENCE_ID,SOURCE_ID,VERIFIED_BY_AUTHORITY)
          VALUES(:id,:evidenceId,:source,'N')`,
          {id,evidenceId,source:sourceId(evidenceId)});
      }
      for(const agent of ['A01','A02']){
        await con.execute(`INSERT INTO NMC_AI_EXECUTION(
          EXECUTION_ID,ASSESSMENT_ID,AGENT_CODE,EXECUTION_STATUS)
          VALUES(:executionId,:assessmentId,:agent,'SIGNALS_VALIDATED')`,
          {executionId:randomUUID(),assessmentId:id,agent});
      }
      await con.execute(`INSERT INTO NMC_DATA_QUALITY(
        ASSESSMENT_ID,CALCULATION_STATUS)
        VALUES(:id,'NOT_CALCULATED')`,{id});
      const nextAt=utc(row.nextCheckAt);
      await con.execute(`MERGE INTO NMC_VESSEL_CURRENT_STATE dst
        USING(SELECT :imo IMO FROM DUAL) s ON(dst.IMO=s.IMO)
        WHEN MATCHED THEN UPDATE SET dst.ASSESSMENT_ID=:assessmentId,
          dst.STATUS='COMPLETED',dst.LAST_CHECKED_AT=SYSTIMESTAMP,
          dst.NEXT_CHECK_AT=TO_TIMESTAMP_TZ(:nextAt,'${mask}'),
          dst.REFRESH_FAILURE=NULL,dst.FAILURE_REASON=NULL,
          dst.UPDATED_AT=SYSTIMESTAMP
        WHEN NOT MATCHED THEN INSERT(IMO,ASSESSMENT_ID,STATUS,
          LAST_CHECKED_AT,NEXT_CHECK_AT)
          VALUES(:imo,:assessmentId,'COMPLETED',SYSTIMESTAMP,
            TO_TIMESTAMP_TZ(:nextAt,'${mask}'))`,
          {imo:row.imo,assessmentId:id,nextAt});
      const changed=previous?.status==='COMPLETED'&&
        (previous.score!==row.score||previous.level!==row.level);
      await con.execute(`INSERT INTO NMC_INTELLIGENCE_EVENT(
        EVENT_ID,IMO,ASSESSMENT_ID,EVENT_TYPE,EVENT_DESCRIPTION,
        PREVIOUS_RISK_SCORE,NEW_RISK_SCORE)
        VALUES(:eventId,:imo,:assessmentId,:eventType,:description,:oldScore,:newScore)`,
        {eventId:randomUUID(),imo:row.imo,assessmentId:id,
          eventType:changed?'RISK_CHANGE':'AI_ASSESSMENT',
          description:changed?'Synthetic AI risk assessment changed':
            'A01/A02 synthetic vessel risk assessment completed',
          oldScore:previous?.score??null,newScore:row.score});
      await con.commit();
      return id;
    }catch{await con.rollback();throw new Error('ORACLE_ASSESSMENT_WRITE_FAILED');}
    finally{await con.close();}
  }

  async saveStateBatch(records){
    if(!records.length)return;
    const con=await this.pool.getConnection();
    try{
      await con.executeMany(`MERGE INTO NMC_VESSEL_CURRENT_STATE dst
        USING(SELECT :imo IMO FROM DUAL) s ON(dst.IMO=s.IMO)
        WHEN MATCHED THEN UPDATE SET dst.STATUS=:status,
          dst.LAST_CHECKED_AT=TO_TIMESTAMP_TZ(:checkedAt,'${mask}'),
          dst.NEXT_CHECK_AT=TO_TIMESTAMP_TZ(:nextAt,'${mask}'),
          dst.ATTEMPTED_AT=TO_TIMESTAMP_TZ(:attemptedAt,'${mask}'),
          dst.REFRESH_FAILURE=:refreshFailure,
          dst.FAILURE_REASON=:failureReason,dst.UPDATED_AT=SYSTIMESTAMP
        WHEN NOT MATCHED THEN INSERT(IMO,STATUS,LAST_CHECKED_AT,
          NEXT_CHECK_AT,ATTEMPTED_AT,REFRESH_FAILURE,FAILURE_REASON)
          VALUES(:imo,:status,TO_TIMESTAMP_TZ(:checkedAt,'${mask}'),
          TO_TIMESTAMP_TZ(:nextAt,'${mask}'),
          TO_TIMESTAMP_TZ(:attemptedAt,'${mask}'),:refreshFailure,:failureReason)`,
        records.map(r=>({imo:r.imo,status:r.status==='COMPLETED'?'COMPLETED':'FAILED',
          checkedAt:utc(r.lastCheckedAt),nextAt:utc(r.nextCheckAt),
          attemptedAt:utc(r.attemptedAt),refreshFailure:r.refreshFailure||null,
          failureReason:r.reasonCode||null})));
      await con.commit();
    }catch{await con.rollback();throw new Error('ORACLE_STATE_WRITE_FAILED');}
    finally{await con.close();}
  }

  async history(imo){
    const con=await this.pool.getConnection();
    try{
      const assessments=await con.execute(`SELECT ASSESSMENT_ID,RISK_SCORE,RISK_LEVEL,
        OPERATIONAL_PRIORITY,RULESET_VERSION,${time('ASSESSED_AT')} ASSESSED_AT
        FROM NMC_AI_ASSESSMENT WHERE IMO=:imo
        ORDER BY ASSESSED_AT DESC FETCH FIRST 100 ROWS ONLY`,
        {imo},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      const events=await con.execute(`SELECT EVENT_TYPE,EVENT_DESCRIPTION,
        PREVIOUS_RISK_SCORE,NEW_RISK_SCORE,${time('OCCURRED_AT')} OCCURRED_AT
        FROM NMC_INTELLIGENCE_EVENT WHERE IMO=:imo
        ORDER BY OCCURRED_AT DESC FETCH FIRST 100 ROWS ONLY`,
        {imo},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return {imo,assessments:assessments.rows,events:events.rows,
        dataNature:'SYNTHETIC_POC_NOT_OFFICIAL'};
    }finally{await con.close();}
  }
}
