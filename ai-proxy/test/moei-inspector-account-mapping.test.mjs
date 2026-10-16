import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MoeiGoogleUsers} from '../moei-google-users.mjs';
import {SiScheduleOrders} from '../si-schedule-orders.mjs';
import {matchesAssignedInspector} from '../si-inspector-identity.mjs';

const first='first@example.test',second='second@example.test';
const order=(inspectorId,id,imo)=>({
 id,imo,status:'READY_FOR_FIELD',caseId:null,
 assignment:{inspectorId,inspectorName:'Existing Inspector '+inspectorId}
});
const id=x=>x+'-0000-4000-8000-000000000000';
const schedules=[{id:id('11111111'),planId:id('22222222'),mode:'ERP_VERIFIED',
 orders:[order('INS-007',id('33333333'),'9400643'),
         order('INS-008',id('44444444'),'9400644')]}];

test('admin links distinct Google users to different existing inspector IDs; mapping is persisted and audited',()=>{
 const dir=mkdtempSync(join(tmpdir(),'moei-mapping-'));
 try{
  const file=join(dir,'users.json'),store=new MoeiGoogleUsers({path:file});
  store.add({email:first,role:'VIEWER'},'admin');
  store.add({email:second,role:'VIEWER'},'admin');
  store.update(first,{inspectorId:'INS-007'},'admin');
  store.update(second,{inspectorId:'INS-008'},'admin');
  assert.equal(store.find(first).inspectorId,'INS-007');
  assert.equal(store.find(second).inspectorId,'INS-008');
  assert.equal(new MoeiGoogleUsers({path:file}).find(second).inspectorId,'INS-008');
  assert.ok(store.audit.some(x=>x.action==='UPDATE'&&x.email===first));
  assert.throws(()=>store.update(second,{inspectorId:'INS-007'},'admin'),
   e=>e.code==='MOEI_INSPECTOR_ALREADY_LINKED');
  assert.throws(()=>store.update(second,{inspectorId:'../../../'},'admin'),
   e=>e.code==='MOEI_INSPECTOR_ID_INVALID');
  store.update(first,{inspectorId:null},'admin');
  assert.equal(store.find(first).inspectorId,null);
  store.update(second,{inspectorId:'INS-007'},'admin');
  assert.equal(store.find(second).inspectorId,'INS-007');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('work-order My Inspections and case access use a server-only authenticated inspector mapping',async()=>{
 const linked={[first]:'INS-007',[second]:'INS-008'};
 const matcher=(actor,assignment,mode)=>{
  const mapped=linked[actor];
  if(mapped)return mapped===assignment?.inspectorId?
   {id:mapped,name:assignment.inspectorName,serverProvisioned:true}:null;
  return matchesAssignedInspector(actor,assignment,mode);
 };
 const orders=Object.create(SiScheduleOrders.prototype);
 orders.ready=true;
 orders.targeting={bundles:[{imo:'9400643',inlineContext:{vessel:{name:'Vessel A'}}},
  {imo:'9400644',inlineContext:{vessel:{name:'Vessel B'}}}]};
 orders.resolveInspectorIdentity=matcher;
 orders.all=async()=>schedules;
 const view1=await orders.mine(first);
 const view2=await orders.mine(second);
 assert.deepEqual(view1.map(x=>x.imo),['9400643']);
 assert.deepEqual(view2.map(x=>x.imo),['9400644']);
 assert.equal(view1[0].assignment.inspectorId,'INS-007');
 await assert.rejects(orders.mineOrder(first,id('44444444')),
  e=>e.code==='SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION');
 await assert.rejects(orders.mineOrder('unlinked@example.test',id('33333333')),
  e=>e.code==='SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION');
 const result=await orders.mineOrder(first,id('33333333'));
 assert.equal(result.order.imo,'9400643');
 linked[first]='INS-008';
 assert.deepEqual((await orders.mine(first)).map(x=>x.imo),['9400644'],
  'changing server mapping takes effect immediately');
 await assert.rejects(orders.mineOrder(first,id('33333333')),
  e=>e.code==='SI_WORK_ORDER_NOT_ASSIGNED_TO_SESSION');
});

test('inspector pairing never weakens Google ADMIN/VIEWER separation or user deactivation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'moei-mapping-'));
 try{
  const store=new MoeiGoogleUsers({path:join(dir,'u.json')});
  const before=store.find('aymansalem0@gmail.com');
  assert.equal(before.role,'ADMIN');
  assert.equal(before.inspectorId,undefined);
  store.update('aymansalem0@gmail.com',{inspectorId:'INS-007'},'admin');
  assert.equal(store.find('aymansalem0@gmail.com').role,'ADMIN');
  assert.equal(store.find('aymansalem0@gmail.com').inspectorId,'INS-007');
  assert.throws(()=>store.update('aymansalem0@gmail.com',
   {role:'VIEWER'},'admin'),e=>e.code==='MOEI_LAST_ADMIN_REQUIRED');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
