import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAssignedInspector} from '../si-inspector-identity.mjs';
const assigned={inspectorId:'ERP-INS-007',inspectorName:'Field Engineer 7'};
test('only authenticated identity mapped to assigned ERP inspector is accepted',()=>{
 const config=JSON.stringify({'inspector@example.org':'ERP-INS-007'});
 assert.deepEqual(resolveAssignedInspector('INSPECTOR@EXAMPLE.ORG',assigned,config),
  {id:'ERP-INS-007',name:'Field Engineer 7'});
 for(const actor of ['supervisor@example.org','ERP-INS-007','unassigned@example.org',null])
  assert.equal(resolveAssignedInspector(actor,assigned,config),null);
});
test('bad or absent identity mapping fails closed',()=>{
 for(const config of ['{','null','[]','{}','{"inspector@example.org":"ERP-INS-008"}'])
  assert.equal(resolveAssignedInspector('inspector@example.org',assigned,config),null);
});
test('MOCK delegation is a separate publisher-only server authorization, not an identity mapping',()=>{
 assert.equal(resolveAssignedInspector('supervisor@example.org',assigned,
   '{"supervisor@example.org":"SOME-OTHER-INS"}'),null);
});

test('admin-provisioned employee mapping authorizes ONLY the canonical assigned inspector',()=>{
 const actor='operator@example.org';
 const valid=resolveAssignedInspector(actor,assigned,'{}','ERP-INS-007');
 assert.deepEqual(valid,{id:'ERP-INS-007',name:'Field Engineer 7',
  source:'ADMIN_VERIFIED_GOOGLE_INSPECTOR_MAPPING'});
 assert.equal(resolveAssignedInspector(actor,assigned,'{}','ERP-INS-008'),null);
 assert.equal(resolveAssignedInspector('',assigned,'{}','ERP-INS-007'),null);
});
