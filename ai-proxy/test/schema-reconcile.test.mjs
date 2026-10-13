import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 schemaManifest,planReconcile,BASELINE_TABLES,TECHNICAL_MASTER,
 NMC_SYNTHETIC_SOURCES
} from '../tools/reconcile-moei-schema.mjs';
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../migrations');
test('Checklist settings API must be routed BEFORE /api/si/v1 generic 405 catch-all',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const specific=server.indexOf("if(path==='/api/si/v1/checklists'||path.startsWith('/api/si/v1/checklists/'))");
 const generic=server.indexOf("if(path==='/api/si/v1'||path.startsWith('/api/si/v1/'))");
 assert.ok(specific>0);assert.ok(generic>0);
 assert.ok(specific<generic,'specific /api/si/v1/checklists must be evaluated first');
 assert.match(server,/siChecklistLibrary\.create\(/);
 assert.match(server,/siChecklistLibrary\.publish\(/);
});
test('Oracle 017 lists all checklist authoring, applicability, answers, AI review and audit tables',()=>{
 const m=schemaManifest({directory});
 const required=['SI_CHK_MD_GROUP','SI_CHK_MD_VALUE','SI_CHK_TEMPLATE',
  'SI_CHK_REVISION','SI_CHK_APPLICABILITY','SI_CHK_GROUP','SI_CHK_ITEM',
  'SI_CHK_ITEM_FIELD','SI_CHK_CASE_RUN','SI_CHK_CASE_ITEM',
  'SI_CHK_AI_PROPOSAL','SI_CHK_AI_REVIEW','SI_CHK_EVIDENCE','SI_CHK_AUDIT'];
 for(const name of required){
  assert.ok(m.tables.has(name),'Missing table '+name);
  assert.ok(m.tables.get(name).cols.size>=4,'Missing columns for '+name);
 }
 assert.equal(m.tables.size>=35,true);
 assert.ok(m.indexes.has('IDX_SI_CHK_CASE_REF'));
 assert.ok(m.migrationWarnings.some(x=>x.includes('014_')),
  'unsafe legacy constraint upgrades must be flagged for DBA, not replayed');
 const field=m.tables.get('SI_CHK_ITEM_FIELD');
 assert.match(field.sql,/SI_CHK_MD_VALUE\(GROUP_CODE,VALUE_CODE\)/);
 assert.equal(field.cols.get('FIELD_TYPE').required,true);
});
test('Reconcile plan checks all known tables and baseline without making any DB calls',()=>{
 const m=schemaManifest({directory});
 const plan=planReconcile(m,{tableNames:BASELINE_TABLES,columnPairs:[],indexNames:[]});
 assert.equal(plan.missingBaseline.length,0);
 assert.equal(plan.createTables.length,m.tables.size);
 assert.equal(plan.createIndexes.length,m.indexes.size);
 assert.equal(plan.missingColumns.length,0);
});
test('Existing dynamic checklist table with missing nullable column is repairable; required key is manual',()=>{
 const m=schemaManifest({directory});
 const t=m.tables.get('SI_CHK_TEMPLATE');
 const plan=planReconcile(m,{tableNames:[...BASELINE_TABLES,t.name],
  columnPairs:['SI_CHK_TEMPLATE.TEMPLATE_ID'],indexNames:[]});
 const title=plan.missingColumns.find(x=>x.column==='TITLE_EN');
 const description=plan.missingColumns.find(x=>x.column==='DESCRIPTION_TEXT');
 assert.equal(title.safeAutoAdd,false);
 assert.equal(description.safeAutoAdd,true);
});
test('Technical master data includes multi-field answers, multiple sources and human AI decisions',()=>{
 assert.deepEqual(TECHNICAL_MASTER.ANSWER_FIELD_TYPE,
  ['BOOLEAN','NOTE','EXPIRY_DATE','DATE','NUMBER','TEXT']);
 assert.deepEqual(TECHNICAL_MASTER.SOURCE_TYPE,
  ['NMC_CASE','PSC_PORT_CALL','SERVICE_REQUEST']);
 assert.deepEqual(TECHNICAL_MASTER.AI_REVIEW_DECISION,['ACCEPT','EDIT','REJECT']);
 assert.ok(NMC_SYNTHETIC_SOURCES.some(x=>x.id==='A03_GOOGLE_DRIVE_SIM'));
 const sql=readFileSync(new URL('../migrations/017_si_dynamic_checklist_schema_and_master_data.sql',import.meta.url),'utf8');
 for(const [group,codes] of Object.entries(TECHNICAL_MASTER)){
  assert.match(sql,new RegExp("ensure_md_group\\('"+group+"'"));
  for(const code of codes)assert.ok(sql.includes("'"+group+"','"+code+"'"));
 }
 assert.match(sql,/WHEN NOT MATCHED THEN INSERT/);
 assert.doesNotMatch(sql,/TRUNCATE TABLE|DROP TABLE|DELETE FROM/i);
});
