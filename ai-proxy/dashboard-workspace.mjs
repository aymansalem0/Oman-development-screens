import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import oracledb from 'oracledb';

export class DashboardError extends Error {
  constructor(code, status=400) { super(code); this.code=code; this.status=status; }
}

const TYPES=Object.freeze({
  kpi:['vesselCount','assessedCount','attentionCount','highCriticalCount','priorityCount','averageRisk'],
  bar:['byRisk','byFlag','byType','byZone'],
  table:['vesselTable'],
  position:['vesselPositions']
});
const RISK=['All','Normal','Watch','High','Critical','Pending'];
const ROLES=['EDITOR','PUBLISHER'];
const MAX_DASHBOARDS=60;
const keyPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const clone=x=>JSON.parse(JSON.stringify(x));
const now=()=>new Date().toISOString();

function normalize(input,{id,status='DRAFT',version=1}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new DashboardError('DASHBOARD_INVALID');
  const title=String(input.title??'').trim();
  const description=String(input.description??'').trim();
  if(!title||title.length>100||description.length>500)throw new DashboardError('DASHBOARD_FIELDS_INVALID');
  const widgets=input.widgets;
  if(!Array.isArray(widgets)||widgets.length>30)throw new DashboardError('DASHBOARD_WIDGET_LIMIT');
  const ids=new Set();
  const safeWidgets=widgets.map(w=>{
    if(!w||typeof w!=='object'||typeof w.id!=='string'||!keyPattern.test(w.id)||
       ids.has(w.id)||!Object.hasOwn(TYPES,w.type)||!TYPES[w.type].includes(w.metric)||
       typeof w.title!=='string'||!w.title.trim()||w.title.length>100||
       !['half','full'].includes(w.span))throw new DashboardError('DASHBOARD_WIDGET_INVALID');
    ids.add(w.id);
    return {id:w.id,type:w.type,metric:w.metric,title:w.title.trim(),span:w.span};
  });
  const f=input.filters;
  if(!f||typeof f!=='object'||!RISK.includes(f.risk)||
     typeof f.type!=='string'||f.type.length>80||
     typeof f.flag!=='string'||f.flag.length>80||
     typeof f.search!=='string'||f.search.length>120)
    throw new DashboardError('DASHBOARD_FILTERS_INVALID');
  return {
    id,status,version,title,description,
    updatedAt:now(),widgets:safeWidgets,
    filters:{risk:f.risk,type:f.type,flag:f.flag,search:f.search}
  };
}

function secretEqual(input, secret){
  if(typeof input!=='string'||typeof secret!=='string'||secret.length<24)return false;
  const a=Buffer.from(input,'utf8'),b=Buffer.from(secret,'utf8');
  return a.length===b.length && timingSafeEqual(a,b);
}
const clob=value=>({val:JSON.stringify(value),type:oracledb.DB_TYPE_CLOB});
const stamp=column=>`TO_CHAR(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')`;

export class DashboardWorkspace {
  constructor({
    mode='json',oracleRepository=null,
    file=process.env.NMC_DASHBOARD_STORE_PATH||'/data/nmc-dashboard-workspace.json',
    editorKey=process.env.NMC_DASHBOARD_EDITOR_KEY||'',
    publisherKey=process.env.NMC_DASHBOARD_PUBLISHER_KEY||''
  }={}){
    this.mode=mode;this.oracle=oracleRepository;
    this.file=file;this.editorKey=editorKey;this.publisherKey=publisherKey;
  }

  assertRole(req,role){
    const provided=req.headers['x-nmc-dashboard-key'];
    const valid=role==='PUBLISHER'
      ? secretEqual(provided,this.publisherKey)
      : secretEqual(provided,this.editorKey)||secretEqual(provided,this.publisherKey);
    if(!valid){
      const configured=role==='PUBLISHER'
        ?this.publisherKey?.length>=24
        :this.editorKey?.length>=24||this.publisherKey?.length>=24;
      throw new DashboardError(configured?'DASHBOARD_ACCESS_DENIED':'DASHBOARD_WRITE_NOT_CONFIGURED',
        configured?403:503);
    }
  }

  async list(){
    if(this.mode==='json')return Object.values(this._load().dashboards)
      .filter(row=>row.status!=='ARCHIVED').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    return this._db(async con=>{
      const out=await con.execute(`SELECT DOC_JSON FROM NMC_DASHBOARD
        WHERE STATUS<>'ARCHIVED' ORDER BY UPDATED_AT DESC`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return out.rows.map(row=>JSON.parse(row.DOC_JSON));
    });
  }

  async get(id){
    if(!keyPattern.test(id))throw new DashboardError('DASHBOARD_ID_INVALID');
    if(this.mode==='json')return clone(this._load().dashboards[id]||null);
    return this._db(async con=>{
      const out=await con.execute(`SELECT DOC_JSON FROM NMC_DASHBOARD WHERE DASHBOARD_ID=:id
        AND STATUS<>'ARCHIVED'`,{id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return out.rows.length?JSON.parse(out.rows[0].DOC_JSON):null;
    });
  }

  async revisions(id){
    if(!keyPattern.test(id))throw new DashboardError('DASHBOARD_ID_INVALID');
    if(this.mode==='json')return clone(this._load().revisions[id]||[]);
    return this._db(async con=>{
      const out=await con.execute(`SELECT VERSION_NO,ACTION_NAME,ACTOR_ROLE,
        ${stamp('CHANGED_AT')} CHANGED_AT FROM NMC_DASHBOARD_REVISION
        WHERE DASHBOARD_ID=:id ORDER BY VERSION_NO DESC`,{id},{outFormat:oracledb.OUT_FORMAT_OBJECT});
      return out.rows.map(r=>({
        version:r.VERSION_NO,action:r.ACTION_NAME,role:r.ACTOR_ROLE,at:r.CHANGED_AT
      }));
    });
  }

  async create(input,role='EDITOR'){
    const id=typeof input?.id==='string'&&keyPattern.test(input.id)?input.id:randomUUID();
    const record=normalize(input,{id});
    if(this.mode==='json'){
      const db=this._load();
      if(db.dashboards[id])throw new DashboardError('DASHBOARD_ALREADY_EXISTS',409);
      if(Object.keys(db.dashboards).length>=MAX_DASHBOARDS)throw new DashboardError('DASHBOARD_LIMIT_REACHED',409);
      db.dashboards[id]=record;
      db.revisions[id]=[{version:1,action:'CREATED',role,at:record.updatedAt}];
      this._write(db);return clone(record);
    }
    return this._db(async con=>{
      try{
        await con.execute(`INSERT INTO NMC_DASHBOARD
          (DASHBOARD_ID,TITLE,STATUS,VERSION_NO,DOC_JSON,UPDATED_ROLE)
          VALUES(:id,:title,'DRAFT',1,:doc,:role)`,
          {id,title:record.title,doc:clob(record),role});
        await this._insertRevision(con,record,'CREATED',role);
        await con.commit();
        return record;
      }catch(error){await con.rollback();if(error?.errorNum===1)throw new DashboardError('DASHBOARD_ALREADY_EXISTS',409);throw error;}
    });
  }

  async save(id,input,role='EDITOR'){
    const expected=Number(input?.version);
    if(!Number.isInteger(expected)||expected<1)throw new DashboardError('DASHBOARD_VERSION_REQUIRED');
    const current=await this.get(id);
    if(!current)throw new DashboardError('DASHBOARD_NOT_FOUND',404);
    if(current.status==='PUBLISHED')throw new DashboardError('PUBLISHED_DASHBOARD_LOCKED',409);
    if(current.version!==expected)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
    const next=normalize(input,{id,status:'DRAFT',version:expected+1});
    if(this.mode==='json'){
      const db=this._load();
      if(db.dashboards[id]?.version!==expected)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
      db.dashboards[id]=next;
      db.revisions[id]=[{version:next.version,action:'UPDATED',role,at:next.updatedAt},...(db.revisions[id]||[])];
      this._write(db);return clone(next);
    }
    return this._db(async con=>{
      try {
        const change=await con.execute(`UPDATE NMC_DASHBOARD
          SET TITLE=:title,VERSION_NO=:nextVersion,DOC_JSON=:doc,
          UPDATED_AT=SYSTIMESTAMP,UPDATED_ROLE=:role
          WHERE DASHBOARD_ID=:id AND VERSION_NO=:expected AND STATUS='DRAFT'`,
          {id,title:next.title,nextVersion:next.version,doc:clob(next),role,expected});
        if(change.rowsAffected!==1)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
        await this._insertRevision(con,next,'UPDATED',role);
        await con.commit();
        return next;
      }catch(error){await con.rollback();throw error;}
    });
  }

  async publish(id,version,role='PUBLISHER'){
    if(!Number.isInteger(version)||version<1)throw new DashboardError('DASHBOARD_VERSION_REQUIRED');
    const current=await this.get(id);
    if(!current)throw new DashboardError('DASHBOARD_NOT_FOUND',404);
    if(current.version!==version)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
    if(current.status!=='DRAFT')throw new DashboardError('DASHBOARD_ALREADY_PUBLISHED',409);
    const next={...current,status:'PUBLISHED',version:version+1,updatedAt:now()};
    if(this.mode==='json'){
      const db=this._load();
      if(db.dashboards[id]?.version!==version)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
      db.dashboards[id]=next;
      db.revisions[id]=[{version:next.version,action:'PUBLISHED',role,at:next.updatedAt},...(db.revisions[id]||[])];
      this._write(db);return clone(next);
    }
    return this._db(async con=>{
      try{
        const result=await con.execute(`UPDATE NMC_DASHBOARD
          SET STATUS='PUBLISHED',VERSION_NO=:newVersion,DOC_JSON=:doc,
          UPDATED_AT=SYSTIMESTAMP,UPDATED_ROLE=:role
          WHERE DASHBOARD_ID=:id AND VERSION_NO=:version AND STATUS='DRAFT'`,
          {id,newVersion:next.version,doc:clob(next),role,version});
        if(result.rowsAffected!==1)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
        await this._insertRevision(con,next,'PUBLISHED',role);
        await con.commit();return next;
      }catch(error){await con.rollback();throw error;}
    });
  }

  async archive(id,version,role='EDITOR'){
    if(!Number.isInteger(version)||version<1)throw new DashboardError('DASHBOARD_VERSION_REQUIRED');
    const current=await this.get(id);
    if(!current)throw new DashboardError('DASHBOARD_NOT_FOUND',404);
    if(current.status==='PUBLISHED')throw new DashboardError('PUBLISHED_DASHBOARD_LOCKED',409);
    if(current.version!==version)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
    const next={...current,status:'ARCHIVED',version:version+1,updatedAt:now()};
    if(this.mode==='json'){
      const db=this._load();
      if(db.dashboards[id]?.version!==version)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
      db.dashboards[id]=next;
      db.revisions[id]=[{version:next.version,action:'ARCHIVED',role,at:next.updatedAt},...(db.revisions[id]||[])];
      this._write(db);return next;
    }
    return this._db(async con=>{
      try{
        const result=await con.execute(`UPDATE NMC_DASHBOARD SET
          STATUS='ARCHIVED',VERSION_NO=:newVersion,DOC_JSON=:doc,
          UPDATED_AT=SYSTIMESTAMP,UPDATED_ROLE=:role
          WHERE DASHBOARD_ID=:id AND VERSION_NO=:version AND STATUS='DRAFT'`,
          {id,newVersion:next.version,doc:clob(next),role,version});
        if(result.rowsAffected!==1)throw new DashboardError('DASHBOARD_VERSION_CONFLICT',409);
        await this._insertRevision(con,next,'ARCHIVED',role);
        await con.commit();return next;
      }catch(error){await con.rollback();throw error;}
    });
  }

  async _insertRevision(con,record,action,role){
    await con.execute(`INSERT INTO NMC_DASHBOARD_REVISION
      (DASHBOARD_ID,VERSION_NO,ACTION_NAME,ACTOR_ROLE,DOC_JSON)
      VALUES(:id,:version,:action,:role,:doc)`,
      {id:record.id,version:record.version,action,role,doc:clob(record)});
  }

  async _db(run){
    if(!this.oracle?.pool)throw new DashboardError('DASHBOARD_STORE_UNAVAILABLE',503);
    const con=await this.oracle.pool.getConnection();
    try{return await run(con);}
    catch(error){
      if(error instanceof DashboardError)throw error;
      // Migration intentionally independent of the existing NMC risk schema.
      if(error?.errorNum===942||error?.errorNum===904)throw new DashboardError('DASHBOARD_SCHEMA_NOT_READY',503);
      throw new DashboardError('DASHBOARD_STORE_UNAVAILABLE',503);
    }finally{await con.close();}
  }

  _load(){
    if(!existsSync(this.file))return {schema:1,dashboards:{},revisions:{}};
    try{
      const body=JSON.parse(readFileSync(this.file,'utf8'));
      if(body.schema===1&&body.dashboards&&body.revisions)return body;
    }catch{throw new DashboardError('DASHBOARD_STORE_UNAVAILABLE',503);}
    throw new DashboardError('DASHBOARD_STORE_UNAVAILABLE',503);
  }

  _write(content){
    try{
      mkdirSync(dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp';
      writeFileSync(tmp,JSON.stringify(content),{encoding:'utf8',mode:0o600});
      renameSync(tmp,this.file);
    }catch{throw new DashboardError('DASHBOARD_STORE_UNAVAILABLE',503);}
  }
}
