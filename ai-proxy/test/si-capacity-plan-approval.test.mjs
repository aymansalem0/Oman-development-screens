import test from 'node:test';
import assert from 'node:assert/strict';
import {commitCapacityFirstPlan} from '../si-capacity-plan-approval.mjs';

const planId='44444444-4444-4444-8444-444444444444';
const now='2026-10-20T06:00:00.000Z';
const approvedSource=[{eventKey:'SR-9400796',sourceType:'SERVICE_REQUEST',
 sourceReference:'SR-POC-1',inspectionRegime:'UAE_SERVICE_INSPECTION'}];
const selection={sourceHash:'selected-source-hash',vessels:[{
 imo:'9400796',rank:1,inspectionRegimes:['UAE_SERVICE_INSPECTION'],
 reasons:approvedSource
}]};
const before={id:planId,revision:4,status:'READY_FOR_APPROVAL',
 selectionSourceHash:'selected-source-hash',savedPlanRows:[
  {imo:'9400796',planSelected:true}],audit:[],approvedVessels:[]};
const plan={...before};
const assignment={imo:'9400796',inspectorId:'DEMO-INS-02',
 inspectorName:'POC Demo Inspector 02',portId:'JEA',portName:'Jebel Ali',
 startUtc:now,endUtc:'2026-10-20T08:00:00.000Z',
 startLocal:'2026-10-20 10:00',endLocal:'2026-10-20 12:00',
 optionId:'SLOT-02',crossPort:false,manualReasons:[]};
const proposal={proposalHash:'a'.repeat(64),erpSnapshotId:'POC-DEMO-SNAPSHOT',
 summary:{total:1,proposed:1,unscheduled:0},
 variants:[{optionId:'SI-S01-VALID-PLAN',assignments:[assignment]}]};
const capacity={planId,planRevision:4,sourceHash:'selected-source-hash',
 capacityHash:'b'.repeat(64),mode:'POC_MOCK',
 weights:{NMC_CASE:30,SERVICE_REQUEST:25,PSC_PORT_CALL:20,RISK_FACTOR:25},
 priorityAdvisory:[],readyForApproval:true,proposal};
const args={plan,selection,capacity,selectedOptionId:'SI-S01-VALID-PLAN',
 actor:'supervisor@moei.example',reason:'Approved verified capacity allocation',
 expectedRevision:4,expectedSourceHash:'selected-source-hash'};

function store({failSql='',existingOrders=[]}={}){
 const calls=[],audits=[];let commits=0,rollbacks=0;
 const conn={
  execute:async(sql,binds)=>{
   calls.push({sql,binds});
   if(failSql&&sql.includes(failSql))throw Error('ORACLE_TEST_INSERT_FAILURE');
   if(sql.startsWith('SELECT INSPECTOR_ID'))return {rows:existingOrders};
   if(sql.startsWith('UPDATE SI_PLAN_ROLLING'))return {rowsAffected:1};
   return {rows:[],rowsAffected:1};
  },
  commit:async()=>{commits++;},
  rollback:async()=>{rollbacks++;}
 };
 const rolling={mode:'oracle',oracle:{pool:{}},
  db:async fn=>fn(conn),
  query:async()=>[{STATE_JSON:JSON.stringify(before)}],
  audit:async(conn,id,action,actor,details)=>{
   audits.push({id,action,actor,details});
  }
 };
 return {rolling,calls,audits,get commits(){return commits;},
  get rollbacks(){return rollbacks;}};
}

test('capacity-first single approval atomically issues only approved IMOs and keeps all referral evidence',async()=>{
 const x=store();
 const result=await commitCapacityFirstPlan({rolling:x.rolling,...args});
 assert.equal(x.commits,1);
 assert.equal(x.rollbacks,0);
 assert.equal(result.plan.status,'APPROVED');
 assert.equal(result.plan.scheduleMode,'CAPACITY_VERIFIED_PLAN_AND_ASSIGNMENTS_APPROVED');
 assert.equal(result.plan.approvedVessels.length,1);
 assert.deepEqual(result.plan.approvedVessels[0].inspectionReasons,approvedSource);
 assert.equal(result.plan.capacityWeights.RISK_FACTOR,25);
 assert.equal(result.schedule.orders.length,1);
 assert.equal(result.schedule.orders[0].imo,'9400796');
 assert.equal(result.schedule.orders[0].status,'ISSUED');
 assert.equal(result.schedule.operationalBookingConfirmed,false);
 assert.equal(result.schedule.officialRegulatoryInspectionAuthorized,false);
 assert.equal(x.calls.filter(c=>c.sql.includes('INSERT INTO SI_PLAN_ROLLING_VESSEL')).length,1);
 assert.equal(x.calls.filter(c=>c.sql.includes('INSERT INTO SI_PLAN_ROLLING_REASON')).length,1);
 assert.equal(x.calls.filter(c=>c.sql.includes('INSERT INTO SI_SCHED_WORK_ORDER')).length,1);
 assert.equal(x.audits.length,1);
});
test('approval fails closed unless a real Oracle transaction can hold plan + orders',async()=>{
 await assert.rejects(()=>commitCapacityFirstPlan({...args,rolling:{mode:'json'}}),
  e=>e.code==='SI_CAPACITY_FIRST_ATOMIC_APPROVAL_REQUIRES_ORACLE');
});
test('reject cross-port assignment without separately confirmed supervisor approval',async()=>{
 const x=store();
 const remote={...assignment,crossPort:true,originPortId:'FUJ',
  originPortName:'Fujairah',travelMinutes:30,
  manualReasons:['CROSS_PORT_REQUIRES_APPROVAL']};
 const cap={...capacity,proposal:{...proposal,variants:[
  {optionId:'SI-S01-VALID-PLAN',assignments:[remote]}]}};
 await assert.rejects(()=>commitCapacityFirstPlan({
  rolling:x.rolling,...args,capacity:cap,confirmCrossPort:false
 }),e=>e.code==='SI_CAPACITY_FIRST_CROSS_PORT_SUPERVISOR_APPROVAL_REQUIRED');
 assert.equal(x.calls.length,0);
});
test('new concurrent inspector work order forces transaction rollback, not duplicate task',async()=>{
 const x=store({existingOrders:[{
  INSPECTOR_ID:'DEMO-INS-02',START_UTC:'2026-10-20T07:00:00.000Z',
  END_UTC:'2026-10-20T09:00:00.000Z'
 }]});
 await assert.rejects(()=>commitCapacityFirstPlan({...args,rolling:x.rolling}),
  e=>e.code==='SI_CAPACITY_FIRST_INSPECTOR_COLLISION_REPREVIEW');
 assert.equal(x.commits,0);
 assert.equal(x.rollbacks,1);
});
test('failed insertion into work orders rolls back approved plan and source links',async()=>{
 const x=store({failSql:'INSERT INTO SI_SCHED_WORK_ORDER'});
 await assert.rejects(()=>commitCapacityFirstPlan({...args,rolling:x.rolling}),
  /ORACLE_TEST_INSERT_FAILURE/);
 assert.equal(x.commits,0);
 assert.equal(x.rollbacks,1);
});
