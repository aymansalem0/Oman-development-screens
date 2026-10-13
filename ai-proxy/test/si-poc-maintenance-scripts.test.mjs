import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resetPocActions} from '../tools/reset-si-poc-actions.mjs';
import {seedChecklists,mandatoryTemplates} from '../tools/seed-si-mandatory-checklists.mjs';
import {SiChecklistLibrary} from '../si-checklist-library.mjs';

const temp=()=>mkdtempSync(join(tmpdir(),'si-maintenance-'));
const write=(dir,file,data)=>writeFileSync(join(dir,file),JSON.stringify(data));
test('Default reset is read-only; apply requires explicit backup and maintenance acknowledgement',async()=>{
 const dir=temp(),backup=join(dir,'backups');
 try{
  const a={events:[{eventKey:'source'}],decisions:[{id:'decision'}],
   cases:[{id:'approved'}],rules:[{version:4,config:{ranking:{criteria:[
    'DEPARTURE_SOON','INCIDENT_SEVERITY']}}}]};
  const p={policies:[{version:6,config:{quota:7}}],decisions:[{id:1}]};
  write(dir,'si-candidate-targeting.json',a);
  write(dir,'si-psc-selection.json',p);
  write(dir,'si-rolling-plans.json',{version:1,plans:[{id:'a'}]});
  write(dir,'si-checklist-case-answers.json',{version:1,cases:{'a':{version:3}}});
  write(dir,'si-checklist-library.json',{version:1,templates:[{title:'DO_NOT_DELETE'}]});
  const read=()=>JSON.parse(readFileSync(join(dir,'si-candidate-targeting.json'),'utf8'));
  const flags=['--mode=json','--root='+dir,'--backup-dir='+backup];
  const plan=await resetPocActions([...flags,'--plan']);
  assert.equal(plan.apply,false);
  assert.equal(read().decisions.length,1);
  await assert.rejects(resetPocActions([...flags,'--apply']),/SI_RESET_EXPLICIT_ACK_BACKUP_AND_STOPPED_SERVICE_REQUIRED/);
  const reset=await resetPocActions([...flags,'--apply',
   '--ack=RESET_SI_POC_ACTIONS','--backup-confirmed=VERIFIED',
   '--maintenance-confirmed=STOPPED']);
  assert.equal(reset.result,'RESET_APPLIED');
  assert.ok(existsSync(join(reset.backupDirectory,'json','si-candidate-targeting.json')));
  assert.deepEqual(read().decisions,[]);
  assert.deepEqual(read().cases,[]);
  assert.deepEqual(read().events,a.events);
  assert.deepEqual(read().rules,a.rules);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'si-psc-selection.json'),'utf8')).policies,p.policies);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'si-rolling-plans.json'),'utf8')).plans,[]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'si-checklist-case-answers.json'),'utf8')).cases,{});
  assert.equal(JSON.parse(readFileSync(join(dir,'si-checklist-library.json'),'utf8')).templates.length,1);
  const again=await resetPocActions([...flags,'--plan']);
  assert.equal(again.json.filter(x=>x.status==='RESET').length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Five mandatory POC templates seed as DRAFT, are repeatable, resolve by regime',async()=>{
 const dir=temp();
 try{
  const library=new SiChecklistLibrary({file:join(dir,'library.json')});
  assert.equal(mandatoryTemplates.length,5);
  const plan=await seedChecklists(['--mode=json','--plan'],library);
  assert.equal(plan.created,0);
  assert.equal((await library.list()).length,0);
  await assert.rejects(seedChecklists(['--mode=json','--apply'],library),
    /SI_CHECKLIST_SEED_EXPLICIT_ACK_REQUIRED/);
  const created=await seedChecklists(['--mode=json','--apply',
   '--ack=SEED_MANDATORY_CHECKLISTS'],library);
  assert.equal(created.created,5);
  assert.equal((await library.list()).filter(x=>x.mandatory&&!x.published).length,5);
  const repeat=await seedChecklists(['--mode=json','--apply',
   '--ack=SEED_MANDATORY_CHECKLISTS'],library);
  assert.equal(repeat.created,0);
  await assert.rejects(seedChecklists(['--mode=json','--apply','--publish',
   '--ack=SEED_MANDATORY_CHECKLISTS'],library),/SI_CHECKLIST_SEED_PUBLICATION_REQUIRES_REVIEW/);
  const published=await seedChecklists(['--mode=json','--apply','--publish',
   '--ack=SEED_MANDATORY_CHECKLISTS','--review-confirmed=YES'],library);
  assert.equal(published.published,5);
  const caseInfo={regimes:['UAE_SERVICE_INSPECTION'],
   inspectionReasons:[{sourceType:'SERVICE_REQUEST'}]};
  const resolved=library.resolve({vessel:{imo:'9328471',vesselType:'Cargo',
    grossTonnage:'28,450 GT',deadweight:'46,820 DWT'},inspectionCase:caseInfo});
  assert.equal(resolved.templates.length,2,'Core + service; PSC/NMC/follow-up should not match');
  assert.ok(resolved.templates.every(t=>t.mandatory&&t.regulatoryApprovalVerified===false));
  assert.equal((await library.list()).length,5);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
