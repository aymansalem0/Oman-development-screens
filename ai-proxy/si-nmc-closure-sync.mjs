/**
 * SI -> NMC CASE closure handoff.
 * No fabricated post-inspection risk, regulatory approval, or case resolution.
 * Idempotent by SI inspection case UUID. Uses existing NmcCaseWorkspace.inspection().
 */
export class SiNmcClosureSyncError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export async function syncSiClosureToNmc({caseId,inspectionCase,record,cases,actor='SUPERVISOR'}){
 if(!inspectionCase?.nmcReferralId)return {status:'NOT_NMC_ORIGIN'};
 if(record?.stage!=='CLOSED'||record?.report?.status!=='APPROVED'||
    !record.report.supervisor||record.caseId!==caseId||
    record.imo!==inspectionCase.imo)
  throw new SiNmcClosureSyncError('SI_NMC_APPROVED_CLOSURE_REQUIRED',409);
 const nmcRows=await cases.list();
 const refs=nmcRows.filter(row=>row.imo===inspectionCase.imo&&
   (!inspectionCase.nmcCaseId||row.id===inspectionCase.nmcCaseId)&&
   (row.inspectionRequests||[]).some(request=>request.id===inspectionCase.nmcReferralId));
 if(refs.length!==1)
  throw new SiNmcClosureSyncError('SI_NMC_SOURCE_REFERRAL_NOT_UNIQUE',409);
 const nmc=refs[0];
 const previous=nmc.inspectionHistory||[];
 if(previous.some(x=>x.inspectionId===caseId)||
    nmc.inspectionOutcome?.inspectionId===caseId)
   return {status:'ALREADY_RECORDED',nmcCaseId:nmc.id,nmcCaseStatus:nmc.status};
 const req=(nmc.inspectionRequests||[]).find(x=>x.id===inspectionCase.nmcReferralId);
 if(req?.status!=='SCHEDULED')
  throw new SiNmcClosureSyncError('SI_NMC_REFERRAL_NOT_SCHEDULED',409);
 if(nmc.status==='RESOLVED')
  throw new SiNmcClosureSyncError('SI_NMC_ALREADY_RESOLVED',409);
 const findings=Array.isArray(record.findings)?record.findings:[];
 const result=await cases.inspection(nmc.id,nmc.version,{
   inspectionId:caseId,result:findings.length?'Completed with Findings':'Completed',
   findingsCount:findings.length,
   criticalFindings:findings.filter(x=>x.severity==='CRITICAL').length,
   summary:String(record.report.summary||'Supervisor-approved inspection completed').slice(0,500)
 },'SI_SUPERVISOR');
 return {status:'RECORDED',nmcCaseId:result.id||nmc.id,
   nmcCaseStatus:result.status||'IN_PROGRESS',
   riskRecalculated:false,regulatoryCaseResolved:false};
}
