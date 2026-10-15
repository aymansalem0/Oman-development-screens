/**
 * Redacted, actionable diagnostics for supervisor integrated-plan approval.
 * This classifies UNKNOWN exceptions after all typed 4xx business errors
 * have already been handled by the SI router.
 * No SQL, Oracle error message, personal data or internal stack is returned.
 */
const knownStages=new Set([
 'PLAN_STATE_LOCK','PLAN_SOURCE_REVALIDATION','PLAN_STATE_WRITE',
 'PLAN_VERSION_WRITE','APPROVED_VESSEL_WRITE',
 'APPROVED_SOURCE_REASON_WRITE','PLAN_APPROVAL_AUDIT',
 'SCHEDULE_WORK_ORDER_WRITE','ORACLE_COMMIT'
]);
export function classifySiApprovalFailure(error){
 const stage=knownStages.has(error?.approvalStage)?
  error.approvalStage:'PREAPPROVAL_OR_DEPENDENCY';
 const num=Number(error?.errorNum);
 const match=/^ORA-(\d{5})$/.exec(String(error?.code||''));
 const oracleNumber=Number.isInteger(num)&&num>0&&num<100000?num:
  match?Number(match[1]):null;
 const oracleCode=oracleNumber===null?null:
  'ORA-'+String(oracleNumber).padStart(5,'0');
 const timeout=[1013,12170,12535,12541,12514,3113,3114,3135,60];
 const integrity=[1,1400,2290,2291,2292,12899,1438];
 const date=[1830,1843,1858,1861,1867,1882,30076];
 const kind=oracleNumber===null?'UNCLASSIFIED':
  timeout.includes(oracleNumber)?'ORACLE_TRANSIENT':
  integrity.includes(oracleNumber)?'ORACLE_CONSTRAINT':
  date.includes(oracleNumber)?'ORACLE_DATE_BIND':
  'ORACLE_OPERATION';
 return {
  error:'SI_APPROVAL_TRANSACTION_FAILED',
  stage,
  failureType:kind,
  ...(oracleCode?{oracleCode}:{}),
  status:kind==='ORACLE_TRANSIENT'?503:500
 };
}
