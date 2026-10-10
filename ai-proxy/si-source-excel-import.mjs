/**
 * Smart Inspection — source-specific POC Excel feeds.
 * NMC CASE is never imported: it stays an authoritative live integration with
 * the existing NMC human-approved case workspace.
 *
 * Excel sources are POC_SIMULATOR / UNVERIFIED, never certified authority data.
 * One preview -> one explicit atomic commit; zero Airia calls; no Oracle DDL.
 * Uses SI_CANDIDATE_EVENT from migration 009 (sourceImport metadata in JSON).
 */
import {randomUUID,createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import oracledb from 'oracledb';
import {SiTargetingError} from './si-candidate-targeting.mjs';

const sourceDefs=Object.freeze({
  SERVICE_REQUEST:{
    sheet:'SERVICE_REQUESTS',
    display:'Maritime Service Requests',
    fields:['request_id','request_reference','imo','port','request_date','service_type','notes'],
    map:r=>({sourceType:'SERVICE_REQUEST',sourceEventId:r.request_id,
      sourceReference:r.request_reference,imo:r.imo,requestedRegime:'UAE_SERVICE_INSPECTION',
      port:r.port,eta:null,note:r.notes?('Service type: '+r.service_type+'; '+r.notes):('Service type: '+r.service_type)})
  },
  PSC_PORT_CALL:{
    sheet:'PSC_PORT_CALLS',
    display:'PSC Port Call Notifications',
    fields:['port_call_id','port_call_reference','imo','port','eta_local','visit_purpose','notes'],
    map:r=>({sourceType:'PSC_PORT_CALL',sourceEventId:r.port_call_id,
      sourceReference:r.port_call_reference,imo:r.imo,requestedRegime:'PORT_STATE_CONTROL',
      port:r.port,eta:r.eta_local,note:r.notes?('Visit: '+r.visit_purpose+'; '+r.notes):('Visit: '+r.visit_purpose)})
  }
});
export const SI_SOURCE_DEFINITIONS=sourceDefs;
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const eventKey=p=>digest(Buffer.from(p.sourceType+'|'+p.sourceEventId+'|'+p.requestedRegime));
const textCell=v=>{
  if(v===null||v===undefined)return '';
  if(typeof v==='string'||typeof v==='number')return String(v).trim();
  return null;
};
const storedBase=p=>{
  const clone={...p};
  // sourceImport metadata belongs on the event wrapper, not the payload.
  return clone;
};
function parseIssue(row,code,detail=''){
  return {row,code,detail:String(detail).slice(0,100)};
}
function decodeBase64(s){
  if(typeof s!=='string'||s.length<270||s.length>2.8*1024*1024||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(s)||s.length%4)
    throw new SiTargetingError('SI_XLSX_INVALID_BASE64',422);
  const bytes=Buffer.from(s,'base64');
  if(bytes.length<200||bytes.length>2*1024*1024||
    bytes.toString('hex',0,4)!=='504b0304')
    throw new SiTargetingError('SI_XLSX_INVALID_FILE',422);
  return bytes;
}
export class SiSourceExcelImport{
  constructor({targeting,clock=()=>Date.now()}={}){
    if(!targeting)throw Error('SI_SOURCE_IMPORT_NEEDS_TARGETING');
    this.targeting=targeting;
    this.clock=clock;
    this.previews=new Map();
  }
  definition(source){
    if(!Object.hasOwn(sourceDefs,source))
      throw new SiTargetingError('SI_XLSX_UNKNOWN_SOURCE',404);
    return sourceDefs[source];
  }
  async template(source){
    const def=this.definition(source),book=new ExcelJS.Workbook();
    book.creator='MOEI Maritime Unified Platform — POC Only';
    const info=book.addWorksheet('README');
    info.addRow(['MOEI SMART INSPECTION — SOURCE-SPECIFIC POC XLSX TEMPLATE']);
    info.addRow(['Source',def.display]);
    info.addRow(['Usage','Import under Settings > Inspection Settings > Candidate Source Imports']);
    info.addRow(['Source authority','POC SIMULATOR — UNVERIFIED; officer review is mandatory']);
    info.addRow(['NMC live referrals','Cannot be uploaded or overwritten by Excel']);
    info.addRow(['Sheet required',def.sheet]);
    info.addRow(['Headers','Row 1 exactly; records begin at row 2']);
    info.addRow(['Date examples','Service Request: YYYY-MM-DD; PSC ETA: YYYY-MM-DDTHH:mm (Dubai local)']);
    info.addRow(['File limit','2 MB, up to 1000 records; formulas forbidden']);
    info.getColumn(1).width=34;info.getColumn(2).width=86;
    const sheet=book.addWorksheet(def.sheet);
    sheet.addRow(def.fields);
    const imo=this.targeting.bundles[0]?.imo;
    if(imo){
      sheet.addRow(source==='SERVICE_REQUEST'
        ?['SR-POC-001','UAE-SVC-POC-001',imo,'Jebel Ali','2026-10-10',
          'Initial maritime inspection','POC test case — replace with source export']
        :['PSC-POC-001','UAE-PORT-POC-001',imo,'Jebel Ali','2026-10-15T08:00',
          'Port call inspection','POC test case — replace with source export']);
    }
    sheet.views=[{state:'frozen',ySplit:1}];
    def.fields.forEach((x,i)=>{sheet.getColumn(i+1).width=x==='notes'?48:Math.max(18,x.length+6)});
    const first=sheet.getRow(1);first.height=28;
    first.eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF075C72'}};
      cell.alignment={vertical:'middle'};});
    sheet.autoFilter={from:'A1',to:sheet.getRow(1).getCell(def.fields.length).address};
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  async status(){
    const state=await this.targeting._state();
    const batches=new Map();
    for(const event of state.events){
      const m=event.sourceImport;
      if(!m||!sourceDefs[m.sourceType])continue;
      if(!batches.has(m.batchId))batches.set(m.batchId,{
        batchId:m.batchId,sourceType:m.sourceType,fileName:m.fileName,
        fileSha256:m.fileSha256,actor:m.actor,importedAt:m.importedAt,importedCount:0
      });
      batches.get(m.batchId).importedCount++;
    }
    const history=[...batches.values()].sort((a,b)=>b.importedAt.localeCompare(a.importedAt));
    const dashboard=await this.targeting.dashboard();
    return {status:'ok',nmc:{mode:'LIVE_NMC_READ_ONLY',currentReferrals:dashboard.summary.bySource.NMC_CASE,
        details:'Existing approved NMC case workspace — no Excel upload'},
      excelSources:Object.fromEntries(Object.entries(sourceDefs).map(([name,def])=>[
        name,{display:def.display,sheet:def.sheet,fields:def.fields,
          importedEvents:state.events.filter(e=>e.payload.sourceType===name&&e.sourceImport).length,
          candidateVessels:dashboard.summary.bySource[name],lastImport:history.find(x=>x.sourceType===name)||null}
      ])),recentBatches:history.slice(0,20)};
  }
  async parse(source,buffer){
    const def=this.definition(source);
    let book;
    try{
      book=new ExcelJS.Workbook();
      await book.xlsx.load(buffer);
    }catch{
      throw new SiTargetingError('SI_XLSX_PARSE_FAILED',422);
    }
    const sheet=book.getWorksheet(def.sheet);
    if(!sheet)throw new SiTargetingError('SI_XLSX_SHEET_REQUIRED_'+def.sheet,422);
    if(sheet.rowCount>1001)throw new SiTargetingError('SI_XLSX_ROW_LIMIT',413);
    if(sheet.columnCount>40)throw new SiTargetingError('SI_XLSX_COLUMN_LIMIT',413);
    const cols=def.fields;
    if(cols.some((k,i)=>textCell(sheet.getRow(1).getCell(i+1).value)!==k))
      throw new SiTargetingError('SI_XLSX_HEADER_MISMATCH',422);
    const out=[],issues=[],withinFile=new Set();
    for(let i=2;i<=sheet.rowCount;i++){
      const row=sheet.getRow(i);
      let values={},empty=true,bad=false;
      for(let j=0;j<cols.length;j++){
        const cell=row.getCell(j+1);
        if(cell.formula||cell.sharedFormula){issues.push(parseIssue(i,'SI_XLSX_FORMULA_NOT_ALLOWED',cols[j]));bad=true;break;}
        const value=textCell(cell.value);
        if(value===null){issues.push(parseIssue(i,'SI_XLSX_LITERAL_ONLY',cols[j]));bad=true;break;}
        if(value)empty=false;
        values[cols[j]]=value;
      }
      if(empty&&!bad)continue;
      if(bad)continue;
      if(!values[cols[0]]||!values[cols[1]]||!values.imo||!values.port||
        !values[cols[4]]||!values[cols[5]]){
        issues.push(parseIssue(i,'SI_XLSX_REQUIRED_FIELDS'));continue;
      }
      if(source==='SERVICE_REQUEST'&&
         (!/^20\d\d-\d\d-\d\d$/.test(values.request_date)||
          !Number.isFinite(Date.parse(values.request_date+'T00:00:00Z')))){
        issues.push(parseIssue(i,'SI_XLSX_REQUEST_DATE_INVALID'));continue;
      }
      if(source==='PSC_PORT_CALL'&&
         (!/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(values.eta_local)||
          !Number.isFinite(Date.parse(values.eta_local+':00Z')))){
        issues.push(parseIssue(i,'SI_XLSX_ETA_INVALID'));continue;
      }
      try{
        const mapped=def.map(values);
        mapped.provenance='POC_SIMULATOR';
        mapped.sourceApprovalStatus='UNVERIFIED';
        mapped.evidenceIds=[];
        mapped.createdBy='POC_EXCEL_IMPORT';
        const clean=this.targeting._validateEvent(mapped);
        const key=eventKey(clean);
        if(withinFile.has(key)){issues.push(parseIssue(i,'SI_XLSX_DUPLICATE_EVENT'));continue;}
        withinFile.add(key);
        out.push({row:i,key,payload:clean});
      }catch(e){
        issues.push(parseIssue(i,e instanceof SiTargetingError?
          (this.targeting.imoSet.has(values.imo)?e.code:'SI_XLSX_UNKNOWN_FLEET_IMO'):
          'SI_XLSX_INVALID_ROW'));
      }
    }
    if(!out.length&&!issues.length)issues.push(parseIssue(1,'SI_XLSX_NO_EVENTS'));
    return {rows:out,issues};
  }
  prune(){for(const [k,v] of this.previews)if(v.expiresAt<=this.clock())this.previews.delete(k);}
  async preview({sourceType,workbookBase64,fileName}={}){
    const def=this.definition(sourceType);
    if(typeof fileName!=='string'||!/^[-.\w ()]{1,110}\.xlsx$/i.test(fileName))
      throw new SiTargetingError('SI_XLSX_FILENAME_INVALID',422);
    const bytes=decodeBase64(workbookBase64);
    const {rows,issues}=await this.parse(sourceType,bytes);
    const state=await this.targeting._state();
    const existing=new Map(state.events.map(x=>[x.eventKey,x]));
    let replays=0;
    const fresh=[];
    for(const r of rows){
      const found=existing.get(r.key);
      if(found){
        if(JSON.stringify(storedBase(found.payload))!==JSON.stringify(r.payload))
          issues.push(parseIssue(r.row,'SI_XLSX_EVENT_ID_CONFLICT',r.payload.sourceEventId));
        else replays++;
      }else fresh.push(r);
    }
    this.prune();
    if(this.previews.size>90)throw new SiTargetingError('SI_XLSX_PREVIEW_CAPACITY',429);
    const id=randomUUID(),expiresAt=this.clock()+10*60*1000,sha256=digest(bytes);
    const entry={id,sourceType,fileName,sha256,expiresAt,rows,issues,
      replays,fresh:fresh.map(r=>r.key)};
    this.previews.set(id,entry);
    return {status:issues.length?'VALIDATION_FAILED':'PREVIEW_READY',
      previewId:id,sourceType,sheet:def.sheet,fileName,fileSha256:sha256,
      expiresAt:new Date(expiresAt).toISOString(),
      totalRows:rows.length+issues.length,validRows:rows.length,
      newEvents:fresh.length,replayedEvents:replays,
      issues:issues.slice(0,100),
      sample:rows.slice(0,15).map(x=>({row:x.row,imo:x.payload.imo,
        reference:x.payload.sourceReference,port:x.payload.port})),
      canCommit:issues.length===0&&rows.length>0};
  }
  async commit({previewId,sourceType,actor}={}){
    this.definition(sourceType);
    this.prune();
    const p=this.previews.get(previewId);
    if(!p||p.sourceType!==sourceType)throw new SiTargetingError('SI_XLSX_PREVIEW_EXPIRED',409);
    if(p.issues.length||!p.rows.length)throw new SiTargetingError('SI_XLSX_PREVIEW_NOT_VALID',409);
    if(typeof actor!=='string'||actor.trim().length<3||actor.trim().length>120)
      throw new SiTargetingError('SI_XLSX_IMPORT_ACTOR_REQUIRED',422);
    const state=await this.targeting._state();
    const existing=new Map(state.events.map(e=>[e.eventKey,e]));
    const fresh=[],duplicates=[];
    for(const item of p.rows){
      const match=existing.get(item.key);
      if(match){
        if(JSON.stringify(storedBase(match.payload))!==JSON.stringify(item.payload))
          throw new SiTargetingError('SI_XLSX_EVENT_ID_CONFLICT',409);
        duplicates.push(item);
      }else fresh.push(item);
    }
    const time=new Date(this.clock()).toISOString(),batchId=randomUUID();
    const audit={batchId,sourceType,fileName:p.fileName,
      fileSha256:p.sha256,actor:actor.trim(),importedAt:time};
    const events=fresh.map(x=>({
      id:randomUUID(),eventKey:x.key,createdAt:time,payload:x.payload,
      sourceImport:{...audit,excelRow:x.row}
    }));
    if(this.targeting.mode==='json'){
      // Snapshot is a single atomic JSON write and never partially imports rows.
      const cur=this.targeting._load();
      if(cur.events.some(e=>events.some(x=>x.eventKey===e.eventKey)))
        throw new SiTargetingError('SI_XLSX_SOURCE_MODIFIED_REPREVIEW',409);
      cur.events.push(...events);
      this.targeting._save(cur);
    }else if(events.length){
      await this.targeting._db(async con=>{
        try{
          for(const e of events){
            await con.execute(`INSERT INTO SI_CANDIDATE_EVENT
              (EVENT_KEY,IMO,SOURCE_TYPE,REGIME,DOC_JSON)
              VALUES (:key,:imo,:source,:regime,:doc)`,{
              key:e.eventKey,imo:e.payload.imo,source:e.payload.sourceType,
              regime:e.payload.requestedRegime,
              doc:{type:oracledb.DB_TYPE_CLOB,val:JSON.stringify(e)}
            });
          }
          await con.commit();
        }catch(e){
          await con.rollback();
          if(e.code==='ORA-00001')throw new SiTargetingError('SI_XLSX_SOURCE_MODIFIED_REPREVIEW',409);
          throw e;
        }
      });
    }
    this.previews.delete(previewId);
    return {status:'COMMITTED',sourceType,batchId,importedEvents:events.length,
      duplicateEvents:duplicates.length,fileSha256:p.sha256,
      nmcChanged:false,requiresOfficerReview:true,airiaCalls:0};
  }
}
