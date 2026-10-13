import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ExcelJS from 'exceljs';
import {generateMswPocFiles,MSW_DEMO_FEEDS} from '../tools/generate-msw-demo-feeds.mjs';
import {AIRIA_DEMO_99_RECORDS} from '../airia-demo-cohort.mjs';
import {SiCandidateTargeting} from '../si-candidate-targeting.mjs';
import {SiSourceExcelImport} from '../si-source-excel-import.mjs';

test('Two Excel files are source-import compatible and cover only the 99 Airia partner vessels',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'msw-poc-import-'));
 try{
  const output=await generateMswPocFiles(dir);
  assert.equal(output.length,2);
  const expectedImos=new Set(AIRIA_DEMO_99_RECORDS.map(r=>r.imo));
  const observed=new Set();
  const target=new SiCandidateTargeting({mode:'json',
   file:join(dir,'candidate-targeting.json'),
   bundles:AIRIA_DEMO_99_RECORDS.map(r=>({
    imo:r.imo,inlineContext:{vessel:{name:r.name,flag:'UAE',vesselType:'CARGO'}}
   })),
   cases:{listInspectionRequests:async()=>[]},
   riskPolicy:{ready:true,projectCurrent:async()=>({policyRevision:1,projections:[]})}
  });
  const importer=new SiSourceExcelImport({targeting:target});
  for(const info of output){
   assert.ok(existsSync(info.path));
   const spec=MSW_DEMO_FEEDS[info.sourceType];
   const buffer=readFileSync(info.path);
   const {rows,issues}=await importer.parse(info.sourceType,buffer);
   assert.deepEqual(issues,[],info.sourceType+' must conform to real importer');
   assert.equal(rows.length,spec.rows.length);
   const book=new ExcelJS.Workbook();
   await book.xlsx.load(buffer);
   const sheet=book.getWorksheet(spec.sheet);
   assert.ok(sheet);
   assert.deepEqual(spec.headers.map((_,i)=>sheet.getRow(1).getCell(i+1).value),spec.headers);
   assert.ok(book.getWorksheet('README'));
   for(const row of rows)observed.add(row.payload.imo);
  }
  assert.equal(observed.size,99);
  assert.deepEqual(observed,expectedImos);
  await assert.rejects(generateMswPocFiles(dir),/MSW_POC_OUTPUT_EXISTS/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
