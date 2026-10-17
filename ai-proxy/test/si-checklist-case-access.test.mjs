import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeChecklistCase} from '../si-checklist-case-access.mjs';
import {pocInspectorIdForActor} from '../si-inspector-identity.mjs';

const A='a@example.test',B='b@example.test',ADMIN='supervisor@example.test';
const POC='poc-inspector@example.test';
const CASE_A='11111111-1111-4111-8111-111111111111';
const CASE_B='22222222-2222-4222-8222-222222222222';
const CASE_POC_FIELD='33333333-3333-4333-8333-333333333333';
const CASE_POC_READY='44444444-4444-4444-8444-444444444444';
const CASE_POC_OFFICIAL='55555555-5555-4555-8555-555555555555';
const allOrders=[
 {caseId:CASE_A,status:'FIELD_STARTED',assignment:{inspectorId:'INS-007'}},
 {caseId:CASE_B,status:'READY_FOR_FIELD',assignment:{inspectorId:'INS-008'}},
 {caseId:CASE_POC_FIELD,status:'FIELD_STARTED',mode:'POC_MOCK',
  assignment:{inspectorId:pocInspectorIdForActor(POC)}},
 {caseId:CASE_POC_READY,status:'READY_FOR_SCOPE_REVIEW',mode:'POC_MOCK',
  assignment:{inspectorId:pocInspectorIdForActor(POC)}},
 {caseId:CASE_POC_OFFICIAL,status:'FIELD_STARTED',mode:'ERP_EXCEL_POC',
  assignment:{inspectorId:pocInspectorIdForActor(POC)}}
];
function fixture(){
 const users=[
  {email:A,active:true,inspectorId:'INS-007'},
  {email:B,active:true,inspectorId:'INS-008'},
  {email:ADMIN,active:true,inspectorId:null},
  {email:POC,active:true,inspectorId:null}
 ];
 const traces=[],orders=[...allOrders];
 const scheduleOrders={ready:true,async mine(email){
  traces.push(email);
  const inspector=users.find(u=>u.email===email&&u.active)?.inspectorId;
  const pocId=pocInspectorIdForActor(email);
  return orders.filter(row=>
    inspector&&row.assignment.inspectorId===inspector||
    row.mode==='POC_MOCK'&&row.assignment.inspectorId===pocId
   ).map(row=>({...row,isMyPocEngineer:
     row.mode==='POC_MOCK'&&row.assignment.inspectorId===pocId}));
 }};
 const identity=(email,role='VIEWER')=>({email,role,provider:'google'});
 const check=(email,caseId,role='VIEWER')=>authorizeChecklistCase({
  identity:identity(email,role),caseId,googleUsers:{users},scheduleOrders
 });
 return {users,traces,orders,scheduleOrders,identity,check};
}
test('Google VIEWER inspector opens ONLY their assigned checklist case, including supporting evidence boundary',async()=>{
 const f=fixture();
 const a=await f.check(A,CASE_A);
 const b=await f.check(B,CASE_B);
 assert.equal(a.kind,'ASSIGNED_INSPECTOR');
 assert.equal(b.inspectorId,'INS-008');
 await assert.rejects(f.check(A,CASE_B),e=>e.code==='SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION'&&e.status===403);
 await assert.rejects(f.check(B,CASE_A),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 await assert.rejects(f.check(A,'33333333-3333-4333-8333-333333333333'),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 assert.deepEqual(f.traces,[A,B,A,B,A]);
});
test('Google ADMIN explicitly assigned to workforce is bound to the same per-case inspector constraints',async()=>{
 const f=fixture();
 f.users.find(x=>x.email===ADMIN).inspectorId='INS-007';
 assert.equal((await f.check(ADMIN,CASE_A,'ADMIN')).kind,'ASSIGNED_INSPECTOR');
 await assert.rejects(f.check(ADMIN,CASE_B,'ADMIN'),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
});
test('Unmapped ADMIN remains separately authorised as supervisor, never granting inspector identity to VIEWER',async()=>{
 const f=fixture();
 const superUser=await f.check(ADMIN,CASE_B,'ADMIN');
 assert.equal(superUser.kind,'SUPERVISOR');
 assert.deepEqual(f.traces,[ADMIN],'supervisor checked assigned order roster without impersonation');
 await assert.rejects(f.check('unmapped@example.test',CASE_A),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 await assert.rejects(f.check('unmapped@example.test',CASE_A,'ADMIN'),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
});
test('Mapping revocation, account deactivation, stale role and scheduling unavailability fail closed',async()=>{
 const f=fixture();
 f.users.find(x=>x.email===A).inspectorId=null;
 await assert.rejects(f.check(A,CASE_A),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 f.users.find(x=>x.email===B).active=false;
 await assert.rejects(f.check(B,CASE_B),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 f.scheduleOrders.ready=false;
 await assert.rejects(f.check(A,CASE_A),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 f.users.find(x=>x.email===ADMIN).active=false;
 await assert.rejects(f.check(ADMIN,CASE_A,'ADMIN'),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
});
test('Client-supplied role, inspectorId or claimed email cannot grant an additional case',async()=>{
 const f=fixture();
 const crafted={...f.identity(A),inspectorId:'INS-008',role:'VIEWER'};
 await assert.rejects(authorizeChecklistCase({
  identity:crafted,caseId:CASE_B,googleUsers:{users:f.users},
  scheduleOrders:f.scheduleOrders
 }),/SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
});

test('Assigned inspector may read pre-field context but cannot upload, ask AI or submit before FIELD_STARTED',async()=>{
 const f=fixture();
 const ctx={identity:f.identity(B),caseId:CASE_B,googleUsers:{users:f.users},
  scheduleOrders:f.scheduleOrders};
 assert.equal((await authorizeChecklistCase(ctx)).kind,'ASSIGNED_INSPECTOR');
 await assert.rejects(authorizeChecklistCase({...ctx,mutation:true}),
   e=>e.code==='SI_CHECKLIST_FIELD_NOT_STARTED'&&e.status===409);
 assert.equal((await authorizeChecklistCase({...ctx,identity:f.identity(A),
   caseId:CASE_A,mutation:true})).kind,'ASSIGNED_INSPECTOR');
});

test('POC mock inspector without ERP ID opens only their session-owned Dynamic Checklist',async()=>{
 const f=fixture();
 const active=await f.check(POC,CASE_POC_FIELD);
 assert.equal(active.kind,'ASSIGNED_INSPECTOR');
 assert.equal(active.mode,'POC_MOCK');
 assert.equal(active.inspectionStatus,'FIELD_STARTED');
 assert.equal(active.inspectorId,pocInspectorIdForActor(POC));
 assert.equal((await authorizeChecklistCase({
  identity:f.identity(POC),caseId:CASE_POC_FIELD,googleUsers:{users:f.users},
  scheduleOrders:f.scheduleOrders,mutation:true
 })).kind,'ASSIGNED_INSPECTOR');
 assert.equal((await f.check(POC,CASE_POC_READY)).inspectionStatus,'READY_FOR_SCOPE_REVIEW');
 await assert.rejects(authorizeChecklistCase({
  identity:f.identity(POC),caseId:CASE_POC_READY,googleUsers:{users:f.users},
  scheduleOrders:f.scheduleOrders,mutation:true
 }),e=>e.code==='SI_CHECKLIST_FIELD_NOT_STARTED'&&e.status===409);
 await assert.rejects(f.check(POC,CASE_POC_OFFICIAL),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 await assert.rejects(f.check(A,CASE_POC_FIELD),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
 f.users.find(x=>x.email===POC).active=false;
 await assert.rejects(f.check(POC,CASE_POC_FIELD),
  /SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION/);
});

test('POC-assigned Google ADMIN remains an inspector, not an early-mutation supervisor',async()=>{
 const f=fixture(),id=pocInspectorIdForActor(ADMIN);
 f.orders.push({caseId:'66666666-6666-4666-8666-666666666666',
  status:'READY_FOR_SCOPE_REVIEW',mode:'POC_MOCK',
  assignment:{inspectorId:id}});
 const ctx={identity:f.identity(ADMIN,'ADMIN'),
  caseId:'66666666-6666-4666-8666-666666666666',
  googleUsers:{users:f.users},scheduleOrders:f.scheduleOrders};
 const grant=await authorizeChecklistCase(ctx);
 assert.equal(grant.kind,'ASSIGNED_INSPECTOR');
 assert.equal(grant.mode,'POC_MOCK');
 await assert.rejects(authorizeChecklistCase({...ctx,mutation:true}),
  e=>e.code==='SI_CHECKLIST_FIELD_NOT_STARTED');
});
