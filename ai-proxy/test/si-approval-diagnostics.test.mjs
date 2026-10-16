import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySiApprovalFailure} from '../si-approval-diagnostics.mjs';

test('Oracle integrity failure is reported with non-sensitive stage and numeric code',()=>{
 const error=new Error('sensitive SQL and bind data MUST NEVER LEAK');
 error.errorNum=1400;error.code='ORA-01400';
 error.approvalStage='APPROVED_SOURCE_REASON_WRITE';
 const details=classifySiApprovalFailure(error);
 assert.deepEqual(details,{
  error:'SI_APPROVAL_TRANSACTION_FAILED',
  stage:'APPROVED_SOURCE_REASON_WRITE',
  failureType:'ORACLE_CONSTRAINT',
  oracleCode:'ORA-01400',status:500
 });
 assert.ok(!JSON.stringify(details).includes('sensitive'));
});
test('Oracle date/time bind issue exposes stable code, not Oracle message',()=>{
 const e=Object.assign(new Error('bad bind details'),{
  code:'ORA-01861',approvalStage:'SCHEDULE_WORK_ORDER_WRITE'});
 const result=classifySiApprovalFailure(e);
 assert.equal(result.oracleCode,'ORA-01861');
 assert.equal(result.failureType,'ORACLE_DATE_BIND');
 assert.equal(result.stage,'SCHEDULE_WORK_ORDER_WRITE');
 assert.equal(result.status,500);
});
test('transient Oracle connection failure is retry-classified but never silently retried',()=>{
 const e=Object.assign(new Error('credentials'),{
  errorNum:3113,approvalStage:'PLAN_STATE_LOCK'});
 const result=classifySiApprovalFailure(e);
 assert.equal(result.status,503);
 assert.equal(result.failureType,'ORACLE_TRANSIENT');
 assert.equal(result.oracleCode,'ORA-03113');
});
test('invalid caller stage, driver secrets and arbitrary error text are suppressed',()=>{
 const e=Object.assign(new TypeError('SECRET DATA'),{
  approvalStage:'DROP TABLE ...',code:'HIDDEN_SQL'});
 const result=classifySiApprovalFailure(e);
 assert.equal(result.stage,'PREAPPROVAL_OR_DEPENDENCY');
 assert.equal(result.failureType,'UNCLASSIFIED');
 assert.equal(result.oracleCode,undefined);
 assert.ok(!JSON.stringify(result).includes('SECRET DATA'));
});

test('ORA-01745 reports only allowed Oracle 019 schedule insert location and no SQL/bind values',()=>{
 const e=Object.assign(new Error('private work order values'),{
  code:'ORA-01745',errorNum:1745,
  approvalStage:'SCHEDULE_WORK_ORDER_WRITE',
  scheduleSqlStage:'WORK_ORDER_INSERT'
 });
 const out=classifySiApprovalFailure(e);
 assert.equal(out.error,'SI_APPROVAL_TRANSACTION_FAILED');
 assert.equal(out.stage,'SCHEDULE_WORK_ORDER_WRITE');
 assert.equal(out.scheduleSqlStage,'WORK_ORDER_INSERT');
 assert.equal(out.oracleCode,'ORA-01745');
 assert.equal(out.status,500);
 assert.equal(JSON.stringify(out).includes('private work order'),false);
 const injected=classifySiApprovalFailure({...e,
   scheduleSqlStage:'DROP TABLE WITH PRIVATE_SQL'});
 assert.equal(injected.scheduleSqlStage,undefined,
   'unknown SQL identifiers are never reflected to the UI');
});
