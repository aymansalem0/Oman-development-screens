import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resetNmcActions} from '../tools/reset-nmc-poc-actions.mjs';
import {resetIncidentLedger} from '../tools/reset-nmc-incident-ledger.mjs';
const dir=()=>mkdtempSync(join(tmpdir(),'nmc-action-reset-'));
const save=(base,file,value)=>writeFileSync(join(base,file),JSON.stringify(value));
test('NMC read-only plan; guarded action reset preserves saved risk, fleet and configs',async()=>{
 const root=dir();
 try{
  const originalCase={schema:1,cases:{
   id1:{id:'id1',inspectionRequests:[{id:'approval'}],decisions:[{id:'action'}]}
  },history:{id1:[{action:'DECISION_RECORDED'}]}};
  const originalAlert={schema:1,alerts:{id1:{status:'ACKNOWLEDGED'}},
   history:{id1:[{action:'ACKNOWLEDGE'}]}};
  save(root,'nmc-case-workspace.json',originalCase);
  save(root,'nmc-alert-workspace.json',originalAlert);
  save(root,'fleet-assessments.json',{schema:1,results:{'9328471':{score:99}}});
  save(root,'nmc-risk-policy.json',{version:9});
  save(root,'si-checklist-library.json',{version:1,templates:[{mandatory:true}]});
  const a=['--mode=json','--root='+root,'--backup-dir='+join(root,'backups')];
  const plan=await resetNmcActions([...a,'--plan']);
  assert.equal(plan.dryRun,true);
  assert.equal(plan.json.filter(x=>x.status==='RESET').length,2);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'nmc-case-workspace.json'))),originalCase);
  await assert.rejects(resetNmcActions([...a,'--apply','--ack=RESET_NMC_POC_ACTIONS']),
   /NMC_RESET_BACKUP_MAINTENANCE_AND_SI_PREREQUISITES_REQUIRED/);
  const done=await resetNmcActions([...a,'--apply','--ack=RESET_NMC_POC_ACTIONS',
   '--backup-confirmed=VERIFIED','--maintenance-confirmed=STOPPED',
   '--si-reset-confirmed=YES']);
  assert.equal(done.result,'APPLIED');
  assert.ok(existsSync(join(done.backupDirectory,'json','nmc-case-workspace.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(root,'nmc-case-workspace.json'))),
   {schema:1,cases:{},history:{}});
  assert.deepEqual(JSON.parse(readFileSync(join(root,'nmc-alert-workspace.json'))),
   {schema:1,alerts:{},history:{}});
  assert.deepEqual(JSON.parse(readFileSync(join(root,'fleet-assessments.json'))),
   {schema:1,results:{'9328471':{score:99}}});
  assert.deepEqual(JSON.parse(readFileSync(join(root,'nmc-risk-policy.json'))),{version:9});
  assert.equal(JSON.parse(readFileSync(join(root,'si-checklist-library.json'))).templates.length,1);
  const second=await resetNmcActions([...a,'--plan']);
  assert.equal(second.json.filter(x=>x.status==='RESET').length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Incident reset defaults read only and rejects apply without explicit external backups',async()=>{
 let sheetWrites=0;
 const source={values:[[...[
   'Incident_ID','Source_Type','Source_Organization','Source_Reference',
   'Reported_At_UTC','Occurred_At_UTC','IMO','Vessel_Name','Incident_Type',
   'Port_or_Zone','Latitude','Longitude','Incident_Description',
   'Source_Incident_Status','Operational_Status','Reported_Severity',
   'Persons_Affected','Pollution_Reported','Evidence_Reference','Source_URL',
   'Received_At_UTC','Updated_At_UTC','Assigned_Officer','Officer_Notes',
   'Data_Nature','AI_Review_Request'
 ]]]};
 const ledger={values:[['Incident_ID']]};
 const feed={configured:true,sheetId:'synthetic-only',sheets:async(method,name)=>{
  assert.equal(method,'GET');
  return name.startsWith('Incident_Registry')?source:ledger;
 },load:async()=>({sourceValidationWarnings:0,incidents:[]})};
 const plan=await resetIncidentLedger(['--plan'],{feed,fetchImpl:async()=>{sheetWrites++;throw Error('WRITE_CALLED')}});
 assert.equal(plan.mode,'PLAN');assert.equal(plan.incidentSourcePreserved,true);
 assert.equal(plan.assessmentLedgerRowCount,0);assert.equal(sheetWrites,0);
 await assert.rejects(resetIncidentLedger(['--apply'],{feed}),
  /NMC_INCIDENT_RESET_BACKUP_ACK_AND_STOPPED_SERVICE_REQUIRED/);
});
