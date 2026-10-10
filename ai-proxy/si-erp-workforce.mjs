/**
 * Smart Inspection POC: Excel ERP workforce adapter.
 * Excel remains a simulated upstream source. Validated snapshots are persisted
 * in /data and never modify NMC Oracle assessments/cases or trigger AI calls.
 */
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * ExcelJS 4.x cannot read otherwise standards-compliant OOXML with the
 * SpreadsheetML elements bound via <x:worksheet> / <x:workbook> prefixes.
 * Some spreadsheet exporters (including our original POC template) emit
 * exactly that legal namespace representation. Normalize XML names in-memory
 * ONLY for that well-identified case; all business validation remains intact.
 *
 * Nothing is modified in the user's source file or stored before preview/commit.
 */
const SHEET_NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
async function normalizeNamespacedXlsx(buffer){
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  const entries=Object.keys(zip.files);
  if(entries.length>160)throw new SiError('ERP_INVALID_XLSX');
  const parts=entries.filter(name=>/^xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name));
  if(!parts.includes('xl/workbook.xml')||parts.length<2)
    throw new SiError('ERP_INVALID_XLSX');
  let updated=0,total=0;
  for(const name of parts){
    const file=zip.file(name);
    if(!file)continue;
    const xml=await file.async('string');
    total+=xml.length;
    if(total>24*1024*1024)throw new SiError('ERP_INVALID_XLSX');
    const startsWithPrefix=new RegExp('<x:(?:workbook|worksheet|styleSheet|sst)\\b').test(xml);
    if(!startsWithPrefix||!xml.includes('xmlns:x="'+SHEET_NS+'"'))continue;
    const fixed=xml.replace(/<(\/?)x:([A-Za-z][A-Za-z0-9_.-]*)/g,'<$1$2')
      .replace('xmlns:x="'+SHEET_NS+'"','xmlns="'+SHEET_NS+'"');
    zip.file(name,fixed);
    updated++;
  }
  if(updated<2)throw new SiError('ERP_INVALID_XLSX');
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
}


export class SiError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const TABLES={
  Ports:['port_id','port_name','city','emirate','timezone','active','window_start','window_end'],
  Inspectors:['inspector_id','erp_employee_id','display_name','active','role','home_port_id','home_city','daily_capacity','weekly_hours_limit','source_updated_at'],
  Inspector_Ports:['inspector_id','port_id','assignment_type','active','effective_from','effective_to'],
  Qualifications:['inspector_id','inspection_regime','vessel_type','qualification_code','valid_until','active'],
  Shifts:['inspector_id','weekday','start_local','end_local','status','effective_from','effective_to'],
  Leaves:['leave_id','inspector_id','start_local','end_local','leave_type','approval_status','source_updated_at'],
  Blackouts:['blackout_id','port_id_or_ALL','start_local','end_local','reason_code','blocks_booking','notes'],
  Travel_Matrix:['from_port_id','to_port_id','one_way_minutes','route_allowed','travel_approval_required'],
  Bookings:['booking_id','inspection_id','inspector_id','port_id','start_local','end_local','booking_status'],
  Scheduling_Policy:['group','setting_key','suggested_value','type','scope','meaning'],
  POC_Requests:['referral_id','imo','risk_level','requested_port','eta_local','deadline_local','regime','vessel_type','duration_minutes','nmc_case_ref','nmc_action_approved','expected_demo_route','notes']
};
const clean=x=>{
  if(x===null||x===undefined)return '';
  if(x instanceof Date)return [
    x.getUTCFullYear(),String(x.getUTCMonth()+1).padStart(2,'0'),String(x.getUTCDate()).padStart(2,'0')
  ].join('-')+' '+String(x.getUTCHours()).padStart(2,'0')+':'+String(x.getUTCMinutes()).padStart(2,'0');
  if(typeof x==='string'||typeof x==='number'||typeof x==='boolean')
    return String(x).trim();
  throw new SiError('ERP_UNSUPPORTED_CELL_TYPE');
};
function assert(ok,code){if(!ok)throw new SiError(code,422);}
function mustLocal(value){
  assert(/^\d{4}-\d\d-\d\d(?: \d\d:\d\d)?$/.test(value),'ERP_INVALID_LOCAL_DATE');
  const text=value.length===10?value+' 00:00':value;
  const ms=Date.parse(text.replace(' ','T')+':00+04:00');
  assert(Number.isFinite(ms),'ERP_INVALID_LOCAL_DATE');
  return ms;
}
function referentialCheck(data){
  const ports=new Set(data.Ports.map(r=>r.port_id));
  const people=new Set(data.Inspectors.map(r=>r.inspector_id));
  assert(ports.size===data.Ports.length&&people.size===data.Inspectors.length,'ERP_DUPLICATE_MASTER_ID');
  for(const p of data.Ports)assert(p.timezone==='Asia/Dubai','ERP_INVALID_TIMEZONE');
  for(const p of data.Inspectors){
    assert(ports.has(p.home_port_id),'ERP_UNKNOWN_HOME_PORT');
    assert(Number.isInteger(Number(p.daily_capacity))&&Number(p.daily_capacity)>0,'ERP_INVALID_DAILY_CAPACITY');
  }
  for(const name of ['Inspector_Ports','Qualifications','Shifts','Leaves','Bookings']){
    for(const row of data[name])assert(people.has(row.inspector_id),'ERP_UNKNOWN_INSPECTOR');
  }
  for(const name of ['Inspector_Ports','Bookings']){
    for(const row of data[name])assert(ports.has(row.port_id),'ERP_UNKNOWN_PORT');
  }
  for(const row of data.Blackouts)assert(row.port_id_or_ALL==='ALL'||ports.has(row.port_id_or_ALL),'ERP_UNKNOWN_BLACKOUT_PORT');
  for(const row of data.Travel_Matrix){
    assert(ports.has(row.from_port_id)&&ports.has(row.to_port_id),'ERP_UNKNOWN_TRAVEL_PORT');
    assert(Number.isFinite(Number(row.one_way_minutes))&&Number(row.one_way_minutes)>=0,'ERP_INVALID_TRAVEL_TIME');
  }
  for(const name of ['Leaves','Bookings','Blackouts']){
    for(const row of data[name]){
      const start=mustLocal(row.start_local),end=mustLocal(row.end_local);
      assert(end>start,'ERP_INVALID_TIME_RANGE');
    }
  }
  for(const row of data.Shifts){
    assert(['SUN','MON','TUE','WED','THU','FRI','SAT'].includes(row.weekday),'ERP_INVALID_WEEKDAY');
    assert(/^\d\d:\d\d$/.test(row.start_local)&&/^\d\d:\d\d$/.test(row.end_local),'ERP_INVALID_SHIFT');
  }
  for(const row of data.Qualifications)mustLocal(row.valid_until);
  for(const row of data.Inspector_Ports)if(row.effective_from)mustLocal(row.effective_from);
  for(const row of data.Inspector_Ports)if(row.effective_to)mustLocal(row.effective_to);
  for(const row of data.Shifts)if(row.effective_from)mustLocal(row.effective_from);
  for(const row of data.Shifts)if(row.effective_to)mustLocal(row.effective_to);
  assert(data.Inspectors.length>0&&data.Ports.length>0,'ERP_EMPTY_WORKFORCE');
}
export async function parseErpExcel(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length<200||buffer.length>3*1024*1024)
    throw new SiError('ERP_FILE_SIZE_INVALID',413);
  if(buffer.toString('hex',0,4)!=='504b0304')throw new SiError('ERP_XLSX_REQUIRED');
  let book;
  try{
    book=new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
  }catch(originalError){
    try{
      // Compatibility fallback, not a bypass of required sheet headers,
      // formula rejection, workforce constraints, or source-reference checks.
      const normalized=await normalizeNamespacedXlsx(buffer);
      book=new ExcelJS.Workbook();
      await book.xlsx.load(normalized);
    }catch{
      console.error('[si-erp] XLSX_PARSE_UNSUPPORTED_OR_CORRUPT',
        String(originalError?.message||'').slice(0,180));
      throw new SiError('ERP_INVALID_XLSX');
    }
  }
  const data={};
  for(const [name,headers] of Object.entries(TABLES)){
    const sheet=book.getWorksheet(name);
    if(!sheet)throw new SiError('ERP_SHEET_MISSING_'+name,422);
    if(sheet.rowCount>10004)throw new SiError('ERP_SHEET_TOO_LARGE',413);
    if(headers.some((h,i)=>clean(sheet.getRow(4).getCell(i+1).value)!==h))
      throw new SiError('ERP_HEADER_MISMATCH_'+name,422);
    const records=[];
    for(let i=5;i<=sheet.rowCount;i++){
      const row=sheet.getRow(i);
      if(headers.every((h,j)=>!clean(row.getCell(j+1).value)))continue;
      const record={};
      for(let j=0;j<headers.length;j++){
        const cell=row.getCell(j+1);
        if(cell.formula||cell.sharedFormula)throw new SiError('ERP_FORMULAS_NOT_ALLOWED',422);
        record[headers[j]]=clean(cell.value);
      }
      records.push(record);
    }
    data[name]=records;
  }
  referentialCheck(data);
  return data;
}
function writeAtomic(path,value){
  mkdirSync(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});
  renameSync(tmp,path);
}
export class ErpWorkforceStore{
  constructor({path=process.env.SI_ERP_STORE_PATH||'/data/si-erp-workforce.json'}={}){
    this.path=path;this.pending=null;this.snapshot=null;
    if(existsSync(path)){
      try{const loaded=JSON.parse(readFileSync(path,'utf8'));
        if(loaded?.schema===1&&loaded.data?.Inspectors)this.snapshot=loaded;
      }catch{console.error('[si-erp] existing workforce snapshot unreadable; fail closed');}
    }
  }
  status(){return {
    ready:!!this.snapshot,source:'EXCEL_POC_SIMULATOR',
    snapshotId:this.snapshot?.snapshotId||null,
    importedAt:this.snapshot?.importedAt||null,
    counts:this.snapshot?Object.fromEntries(Object.entries(this.snapshot.data)
      .map(([k,v])=>[k,v.length])):null
  };}
  async previewBase64(base64){
    if(typeof base64!=='string'||base64.length>4*1024*1024||!/^[A-Za-z0-9+/=\r\n]+$/.test(base64))
      throw new SiError('ERP_FILE_SIZE_INVALID',413);
    const bytes=Buffer.from(base64,'base64');
    const data=await parseErpExcel(bytes);
    const snapshotId=createHash('sha256').update(bytes).digest('hex');
    this.pending={snapshotId,data,expires:Date.now()+10*60*1000};
    return {status:'ok',snapshotId,expiresAt:new Date(this.pending.expires).toISOString(),
      counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),
      replacedSnapshot:this.snapshot?.snapshotId||null,
      warnings:['SYNTHETIC_POC_WORKFORCE','COMMIT_REQUIRED','NO_REAL_ERP_CONNECTION']};
  }
  commit(snapshotId){
    if(!this.pending||Date.now()>this.pending.expires||
       !/^[a-f0-9]{64}$/.test(String(snapshotId))||
       this.pending.snapshotId!==snapshotId)throw new SiError('ERP_PREVIEW_EXPIRED',409);
    const next={schema:1,snapshotId,importedAt:new Date().toISOString(),data:this.pending.data};
    writeAtomic(this.path,next);this.snapshot=next;this.pending=null;
    return this.status();
  }
  requireSnapshot(){
    if(!this.snapshot)throw new SiError('ERP_SNAPSHOT_NOT_IMPORTED',409);
    return this.snapshot;
  }
}
