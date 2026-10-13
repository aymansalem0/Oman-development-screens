/**
 * MOEI / NMC / Smart Inspection Oracle schema + master-data reconciliation.
 *
 * DEFAULT = READ-ONLY. --apply requires --backup-confirmed and NMC_DB_* creds.
 * Only creates missing tables/indexes from reviewed 002..017 migrations,
 * repairs nullable SI_CHK_ columns, and inserts absent technical master codes.
 * NEVER drops/truncates tables, rewrites values, changes official risk, or
 * replays ALTER/DROP CONSTRAINT migrations (005/008/014/016).
 *
 * Run in the existing ai-proxy image:
 *   node tools/reconcile-moei-schema.mjs --plan
 *   node tools/reconcile-moei-schema.mjs --apply --backup-confirmed=VERIFIED
 */
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';

const scriptsDir=resolve(dirname(fileURLToPath(import.meta.url)),'../migrations');
export const BASELINE_TABLES=[
 'NMC_SCHEMA_VERSION','NMC_VESSEL','NMC_DATA_SOURCE','NMC_AI_JOB',
 'NMC_AI_ASSESSMENT','NMC_AI_RISK_FACTOR','NMC_VESSEL_CURRENT_STATE',
 'NMC_DATA_QUALITY'
];
// Operational POC lookup vocabularies, NOT approved maritime legal requirements.
export const TECHNICAL_MASTER={
 ANSWER_FIELD_TYPE:['BOOLEAN','NOTE','EXPIRY_DATE','DATE','NUMBER','TEXT'],
 BOOLEAN_RESULT:['YES','NO','NA'],
 SOURCE_TYPE:['NMC_CASE','PSC_PORT_CALL','SERVICE_REQUEST'],
 INSPECTION_REGIME:['FOCUSED_INSPECTION','FOLLOW_UP_INSPECTION',
  'PORT_STATE_CONTROL','UAE_SERVICE_INSPECTION'],
 AI_SCOPE_LEVEL:['TEMPLATE','GROUP','ITEM'],
 AI_REVIEW_DECISION:['ACCEPT','EDIT','REJECT'],
 CHECKLIST_STATUS:['IN_PROGRESS','SUBMITTED_FOR_REVIEW']
};
export const NMC_SYNTHETIC_SOURCES=[
 {id:'NMC_INTERNAL_SIM',name:'NMC Vessel 360 synthetic fixture',kind:'INTERNAL_SIMULATION'},
 {id:'PSC_GOOGLE_SIM',name:'Google Sheets synthetic PSC dataset',kind:'EXTERNAL_SIMULATION'},
 {id:'A03_GOOGLE_DRIVE_SIM',name:'Google Drive A03 synthetic maritime evidence packs',kind:'EXTERNAL_SIMULATION'}
];
const say=message=>process.stdout.write(String(message)+'\n');
const stripComments=s=>s.replace(/^\s*--[^\n]*/gm,'');
function closingParen(s,open){
 let level=0,quote=false;
 for(let i=open;i<s.length;i++){
  const ch=s[i];
  if(ch==="'"){
   if(quote&&s[i+1]==="'"){i++;continue;}
   quote=!quote;continue;
  }
  if(quote)continue;
  if(ch==='(')level++;
  if(ch===')'&&--level===0)return i;
 }
 throw new Error('MOEI_SQL_DDL_UNBALANCED');
}
function splitColumns(str){
 const items=[];let last=0,level=0,quoted=false;
 for(let i=0;i<str.length;i++){
  if(str[i]==="'"){
   if(quoted&&str[i+1]==="'"){i++;continue;}
   quoted=!quoted;continue;
  }
  if(quoted)continue;
  if(str[i]==='(')level++;
  if(str[i]===')')level--;
  if(str[i]===','&&level===0){items.push(str.slice(last,i).trim());last=i+1;}
 }
 items.push(str.slice(last).trim());return items.filter(Boolean);
}
export function schemaManifest({directory=scriptsDir}={}){
 const files=readdirSync(directory).filter(x=>/^0(?:0[2-9]|1[0-7])_.*\.sql$/i.test(x)).sort();
 if(!files.some(x=>x.startsWith('017_')))throw new Error('SI_CHECKLIST_MIGRATION_017_MISSING');
 const tables=new Map(),indexes=new Map(),migrationWarnings=[];
 for(const filename of files){
  const text=stripComments(readFileSync(join(directory,filename),'utf8'));
  const tableRe=/\bCREATE\s+TABLE\s+([A-Z][A-Z0-9_]*)\s*\(/gi;
  let match;
  while((match=tableRe.exec(text))){
   const open=tableRe.lastIndex-1,close=closingParen(text,open);
   const sql=text.slice(match.index,close+1).trim();
   const columnDefinitions=splitColumns(text.slice(open+1,close));
   const cols=new Map();
   for(const def of columnDefinitions){
    const m=/^([A-Z][A-Z0-9_]*)\s+([\s\S]+)$/i.exec(def);
    if(!m||['CONSTRAINT','PRIMARY','FOREIGN','UNIQUE','CHECK'].includes(m[1].toUpperCase()))
     continue;
    const col=m[1].toUpperCase();
    cols.set(col,{definition:def,name:col,
     required:/\bNOT\s+NULL\b/i.test(def)||/\bPRIMARY\s+KEY\b/i.test(def)});
   }
   if(tables.has(match[1].toUpperCase()))
    throw new Error('MOEI_SCHEMA_DUPLICATE_TABLE_IN_MIGRATIONS_'+match[1]);
   tables.set(match[1].toUpperCase(),{name:match[1].toUpperCase(),sql,cols,
    migration:filename});
   tableRe.lastIndex=close+1;
  }
  const indexRe=/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Z][A-Z0-9_]*)\s+ON\s+([A-Z][A-Z0-9_]*)\s*\(/gi;
  while((match=indexRe.exec(text))){
   const open=indexRe.lastIndex-1,close=closingParen(text,open);
   indexes.set(match[1].toUpperCase(),{name:match[1].toUpperCase(),
    table:match[2].toUpperCase(),sql:text.slice(match.index,close+1).trim(),
    migration:filename});
   indexRe.lastIndex=close+1;
  }
  if(/\bALTER\s+TABLE\s+/i.test(text))
   migrationWarnings.push(filename+': existing constraints/alter operations require DBA drift review; NOT replayed');
 }
 return {files,tables,indexes,migrationWarnings};
}
export function planReconcile(manifest,{tableNames=[],columnPairs=[],indexNames=[]}={}){
 const existingTables=new Set(tableNames.map(x=>x.toUpperCase()));
 const existingCols=new Set(columnPairs.map(x=>x.toUpperCase()));
 const existingIndexes=new Set(indexNames.map(x=>x.toUpperCase()));
 const missingBaseline=BASELINE_TABLES.filter(x=>!existingTables.has(x));
 const createTables=[...manifest.tables.values()].filter(x=>!existingTables.has(x.name));
 const createIndexes=[...manifest.indexes.values()].filter(x=>!existingIndexes.has(x.name));
 const missingColumns=[];
 for(const t of manifest.tables.values()){
  if(!existingTables.has(t.name))continue;
  for(const col of t.cols.values()){
   if(!existingCols.has(t.name+'.'+col.name)){
    const safe=t.name.startsWith('SI_CHK_')&&!col.required&&
      !/\bREFERENCES\b|\bCONSTRAINT\b|\bUNIQUE\b/i.test(col.definition);
    missingColumns.push({table:t.name,column:col.name,definition:col.definition,
     safeAutoAdd:safe,migration:t.migration});
   }
  }
 }
 return {missingBaseline,createTables,createIndexes,missingColumns,
  manualReview:manifest.migrationWarnings};
}
const ddb=async(con,query,binds={})=>{
 const r=await con.execute(query,binds,{outFormat:4002});
 return r.rows||[];
};
function cliOptions(argv=process.argv.slice(2)){
 const opts={apply:false,confirmed:false,report:null};
 for(const arg of argv){
  if(arg==='--plan')opts.apply=false;
  else if(arg==='--apply')opts.apply=true;
  else if(arg==='--backup-confirmed=VERIFIED')opts.confirmed=true;
  else if(arg.startsWith('--report='))opts.report=arg.slice('--report='.length);
  else throw new Error('MOEI_SCHEMA_UNSUPPORTED_OPTION: '+arg);
 }
 if(opts.apply&&!opts.confirmed)
  throw new Error('MOEI_SCHEMA_APPLY_REQUIRES_VERIFIED_RESTORABLE_BACKUP');
 return opts;
}
const masterGroupLabels={
 ANSWER_FIELD_TYPE:'Checklist answer fields',
 BOOLEAN_RESULT:'Boolean answer values',
 SOURCE_TYPE:'Maritime inspection source types',
 INSPECTION_REGIME:'Inspection regime codes (not statutory endorsement)',
 AI_SCOPE_LEVEL:'AI assistant scope levels',
 AI_REVIEW_DECISION:'Human AI recommendation decisions',
 CHECKLIST_STATUS:'Checklist execution status'
};
async function inspectMaster(con,{apply=false,actions=[]}={}){
 const available=(await ddb(con,"SELECT TABLE_NAME FROM USER_TABLES WHERE TABLE_NAME IN ('SI_CHK_MD_GROUP','SI_CHK_MD_VALUE','NMC_DATA_SOURCE')")).map(x=>x.TABLE_NAME);
 const gaps=[];
 if(available.includes('SI_CHK_MD_GROUP')&&available.includes('SI_CHK_MD_VALUE')){
  const groups=new Set((await ddb(con,'SELECT GROUP_CODE FROM SI_CHK_MD_GROUP')).map(x=>x.GROUP_CODE));
  const vals=new Set((await ddb(con,'SELECT GROUP_CODE,VALUE_CODE FROM SI_CHK_MD_VALUE'))
   .map(x=>x.GROUP_CODE+'.'+x.VALUE_CODE));
  for(const [group,codes] of Object.entries(TECHNICAL_MASTER)){
   if(!groups.has(group)){
    gaps.push({table:'SI_CHK_MD_GROUP',code:group});
    if(apply){
     await con.execute(`MERGE INTO SI_CHK_MD_GROUP d USING
      (SELECT :code code,:title title FROM DUAL) s ON(d.GROUP_CODE=s.code)
      WHEN NOT MATCHED THEN INSERT(GROUP_CODE,NAME_EN) VALUES(s.code,s.title)`,
     {code:group,title:masterGroupLabels[group]});actions.push('SEED SI_CHK_MD_GROUP '+group);
    }
   }
   for(let k=0;k<codes.length;k++){
    const value=codes[k];
    if(!vals.has(group+'.'+value)){
     gaps.push({table:'SI_CHK_MD_VALUE',code:group+'.'+value});
     if(apply){
      await con.execute(`MERGE INTO SI_CHK_MD_VALUE d USING
       (SELECT :grp grp,:code code,:label label,:position position FROM DUAL) s
       ON(d.GROUP_CODE=s.grp AND d.VALUE_CODE=s.code)
       WHEN NOT MATCHED THEN INSERT(GROUP_CODE,VALUE_CODE,NAME_EN,SORT_ORDER)
        VALUES(s.grp,s.code,s.label,s.position)`,
      {grp:group,code:value,label:value.replaceAll('_',' '),position:k+1});
      actions.push('SEED SI_CHK_MD_VALUE '+group+'.'+value);
     }
    }
   }
  }
 }else gaps.push({table:'SI_CHK_MD_*',code:'MASTER_TABLES_NOT_INSTALLED'});
 if(available.includes('NMC_DATA_SOURCE')){
  const known=new Set((await ddb(con,'SELECT SOURCE_ID FROM NMC_DATA_SOURCE')).map(x=>x.SOURCE_ID));
  for(const src of NMC_SYNTHETIC_SOURCES){
   if(!known.has(src.id)){
    gaps.push({table:'NMC_DATA_SOURCE',code:src.id});
    if(apply){
      await con.execute(`MERGE INTO NMC_DATA_SOURCE d
       USING(SELECT :id id,:name nm,:cls cls FROM DUAL) s
       ON(d.SOURCE_ID=s.id)
       WHEN NOT MATCHED THEN INSERT(SOURCE_ID,SOURCE_NAME,SOURCE_CLASS)
        VALUES(s.id,s.nm,s.cls)`,
      {id:src.id,name:src.name,cls:src.kind});
      actions.push('SEED NMC_DATA_SOURCE '+src.id);
    }
   }
  }
 }else gaps.push({table:'NMC_DATA_SOURCE',code:'BASELINE_REFERENCE_TABLE_MISSING'});
 return gaps;
}
async function connect(){
 const oracledb=(await import('oracledb')).default;
 const {NMC_DB_USER:user,NMC_DB_PASSWORD:password,
  NMC_DB_CONNECT_STRING:connectString}=process.env;
 if(!user||!password||!connectString)
  throw new Error('MOEI_SCHEMA_ORACLE_CREDENTIALS_NOT_CONFIGURED');
 return oracledb.getConnection({user,password,connectString});
}
export async function reconcile({opts=cliOptions(),connectOracle=connect,
  directory=scriptsDir}={}){
 const manifest=schemaManifest({directory}),con=await connectOracle();
 const actions=[],problems=[];
 try{
  const [identity]=await ddb(con,"SELECT USER AS OWNER, SYS_CONTEXT('USERENV','CON_NAME') AS PDB_NAME FROM DUAL");
  if(!identity?.OWNER||['SYS','SYSTEM'].includes(identity.OWNER)||
   identity.OWNER.toUpperCase()!==String(process.env.NMC_DB_USER||identity.OWNER).toUpperCase())
   throw new Error('MOEI_SCHEMA_UNSAFE_OWNER');
  const currentTables=await ddb(con,'SELECT TABLE_NAME FROM USER_TABLES');
  const existingCols=await ddb(con,'SELECT TABLE_NAME,COLUMN_NAME FROM USER_TAB_COLUMNS');
  const indexes=await ddb(con,'SELECT INDEX_NAME FROM USER_INDEXES');
  const plan=planReconcile(manifest,{
   tableNames:currentTables.map(x=>x.TABLE_NAME),
   columnPairs:existingCols.map(x=>x.TABLE_NAME+'.'+x.COLUMN_NAME),
   indexNames:indexes.map(x=>x.INDEX_NAME)});
  say('[MOEI schema] mode='+(opts.apply?'APPLY':'PLAN')+
   ' owner='+identity.OWNER+' PDB='+identity.PDB_NAME);
  say('[MOEI schema] expected known tables='+manifest.tables.size+
   ' indexes='+manifest.indexes.size+' missing baseline='+plan.missingBaseline.length+
   ' missing tables='+plan.createTables.length+' missing columns='+plan.missingColumns.length+
   ' missing indexes='+plan.createIndexes.length);
  if(plan.missingBaseline.length){
   problems.push('BASELINE_TABLES_MISSING '+plan.missingBaseline.join(', '));
   say('STOP: Base NMC v1 tables missing, initial schema is not bundled: '+
    plan.missingBaseline.join(', '));
  }
  if(opts.apply&&!plan.missingBaseline.length){
   // Fully trusted DDL from reviewed migration SQL only; ordered by migration.
   for(const t of plan.createTables){
    try{
     await con.execute(t.sql);
     actions.push('CREATE TABLE '+t.name+' ['+t.migration+']');
    }catch(e){
     problems.push('CREATE_TABLE_FAILED '+t.name+' code='+String(e.code||'ORACLE'));
     // Stop without proceeding to dependent objects. Oracle DDL AUTO-COMMITS.
     break;
    }
   }
   if(!problems.length){
    for(const col of plan.missingColumns){
     if(!col.safeAutoAdd){problems.push('MANUAL_COLUMN_REVIEW '+col.table+'.'+col.column);continue;}
     try{
      await con.execute('ALTER TABLE '+col.table+' ADD ('+col.definition+')');
      actions.push('ADD NULLABLE COLUMN '+col.table+'.'+col.column);
     }catch(e){problems.push('COLUMN_ADD_FAILED '+col.table+'.'+col.column+' '+String(e.code||'ORACLE'));break;}
    }
   }
   if(!problems.some(x=>x.startsWith('CREATE_TABLE_FAILED')||x.startsWith('COLUMN_ADD_FAILED'))){
    for(const ix of plan.createIndexes){
     try{
      await con.execute(ix.sql);
      actions.push('CREATE INDEX '+ix.name);
     }catch(e){
      problems.push('INDEX_CREATE_FAILED '+ix.name+' '+String(e.code||'ORACLE'));break;
     }
    }
   }
  }else if(opts.apply)problems.push('DDL_APPLY_BLOCKED');
  let masterData=[];
  if(!opts.apply||!problems.some(x=>/^(?:CREATE_TABLE_FAILED|COLUMN_ADD_FAILED|INDEX_CREATE_FAILED|DDL_APPLY_BLOCKED)/.test(x))){
   masterData=await inspectMaster(con,{apply:opts.apply,actions});
   if(opts.apply)await con.commit();
  }
  const summary={timestamp:new Date().toISOString(),mode:opts.apply?'APPLY':'PLAN',
   owner:identity.OWNER,pdb:identity.PDB_NAME,
   knownMigrations:manifest.files,baselineMissing:plan.missingBaseline,
   expectedTables:manifest.tables.size,expectedIndexes:manifest.indexes.size,
   tablesMissing:plan.createTables.map(x=>x.name),
   columnsMissing:plan.missingColumns.map(x=>({
    table:x.table,column:x.column,autoRepair:x.safeAutoAdd})),
   indexesMissing:plan.createIndexes.map(x=>x.name),
   masterMissing:masterData,actions,problems,manualReview:plan.manualReview,
   warning:'Oracle DDL auto-commits. Existing rows never modified/deleted. NMC legacy ALTER CONSTRAINT revisions require DBA review. All master values are platform POC enums.'};
  if(opts.report){
   const filename=resolve(opts.report);mkdirSync(dirname(filename),{recursive:true});
   writeFileSync(filename,JSON.stringify(summary,null,2),{mode:0o600});
  }
  say(JSON.stringify(summary,null,2));
  if(problems.length)process.exitCode=2;
  return summary;
 }finally{await con.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 reconcile().catch(error=>{
  const errCode=String(error?.message||'MOEI_SCHEMA_RECONCILE_FAILED');
  say('[MOEI schema] FAILED '+(/^[A-Z0-9_:\s.-]{1,140}$/.test(errCode)?
   errCode:'MOEI_SCHEMA_RECONCILE_FAILED'));
  process.exitCode=1;
 });
}
