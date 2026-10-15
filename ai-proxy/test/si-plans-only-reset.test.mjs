import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resetSiPlans} from '../tools/reset-si-plans-only.mjs';

const tmp=()=>mkdtempSync(join(tmpdir(),'si-plans-only-'));
const write=(dir,name,doc)=>writeFileSync(join(dir,name),JSON.stringify(doc,null,2));
const read=(dir,name)=>JSON.parse(readFileSync(join(dir,name),'utf8'));
test('Plan reset is read-only until backup and maintenance confirmed, preserving all sources, policies and cases',async()=>{
 const dir=tmp();
 try{
  const source={events:[{id:'MSW-REQ-001',imo:'9328471'}],
   decisions:[{source:'SERVICE_REQUEST',selected:true}],cases:[{id:'SI-CASE-001'}],
   rules:[{version:2,config:{ranking:{criteria:['DEPARTURE_SOON','INCIDENT_SEVERITY']}}}]};
  const approval={version:1,plans:[{id:'draft',status:'DRAFT'},
    {id:'approval',status:'APPROVED'}]};
  const overrides={revision:4,overrides:{'9328471':{selected:true}},latest:{rows:[]},audit:[{event:'PRIORITY_RUN'}]};
  const bulk={version:1,jobs:[{id:'bulk-1',status:'COMPLETED'}]};
  write(dir,'si-candidate-targeting.json',source);
  write(dir,'si-rolling-plans.json',approval);
  write(dir,'si-inspection-plan.json',overrides);
  write(dir,'si-approved-batch-plans.json',bulk);
  const argv=['--mode=json','--root='+dir,'--backup-dir='+join(dir,'backups')];
  const plan=await resetSiPlans([...argv,'--plan']);
  assert.equal(plan.dryRun,true);
  assert.equal(plan.json.filter(x=>x.status==='RESET').length,3);
  assert.deepEqual(read(dir,'si-rolling-plans.json'),approval);
  await assert.rejects(resetSiPlans([...argv,'--apply']),/SI_PLANS_RESET_CONFIRM_STOP_AND_BACKUP_REQUIRED/);
  const guarded=[...argv,'--apply','--ack=RESET_INSPECTION_PLANS_ONLY',
    '--backup-confirmed=VERIFIED','--maintenance-confirmed=STOPPED'];
  await assert.rejects(resetSiPlans(guarded),/SI_PLANS_RESET_APPROVED_PLANS_REQUIRE_EXTRA_CONFIRMATION/);
  const out=await resetSiPlans([...guarded,'--include-approved=YES']);
  assert.equal(out.status,'APPLIED');
  assert.deepEqual(read(dir,'si-rolling-plans.json'),{version:1,plans:[]});
  assert.deepEqual(read(dir,'si-inspection-plan.json'),
    {revision:0,overrides:{},latest:null,audit:[]});
  assert.deepEqual(read(dir,'si-approved-batch-plans.json'),{version:1,jobs:[]});
  assert.deepEqual(read(dir,'si-candidate-targeting.json'),source);
  assert.ok(existsSync(join(out.backupDirectory,'json','si-rolling-plans.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(out.backupDirectory,'json','si-rolling-plans.json'),'utf8')),approval);
  const again=await resetSiPlans([...argv,'--plan']);
  assert.equal(again.json.filter(x=>x.status==='RESET').length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
