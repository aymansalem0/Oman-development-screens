/**
 * Exactly one NMC Case may be notified about a human supervisor report
 * decision for a matching scheduled inspection referral. Never issue a
 * regulatory decision or rewrite the vessel's A01/A02 risk score.
 */
export class SiNmcReviewSyncError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export async function syncSiSupervisorReviewToNmc({caseId,inspectionCase,
 record,cases}={}){
 if(!inspectionCase?.nmcReferralId)
   return {status:'NOT_NMC_ORIGIN',notificationCreated:false};
 if(!record?.report||!['APPROVED','RETURNED'].includes(record.report.status)||
    record.caseId!==caseId||record.imo!==inspectionCase.imo)
   throw new SiNmcReviewSyncError('SI_NMC_REVIEW_NOT_FINALIZED');
 const nmcRows=await cases.list();
 const found=nmcRows.filter(c=>c.imo===inspectionCase.imo&&
  (!inspectionCase.nmcCaseId||c.id===inspectionCase.nmcCaseId)&&
  c.inspectionRequests?.some(x=>x.id===inspectionCase.nmcReferralId));
 if(found.length!==1)
   throw new SiNmcReviewSyncError('SI_NMC_REPORT_SOURCE_NOT_UNIQUE');
 const nmc=found[0];
 const decision=record.report.status;
 const eventId=caseId+':'+record.report.id+':'+decision;
 if(nmc.inspectionReviewHistory?.some(x=>x.eventId===eventId))
  return {status:'ALREADY_RECORDED',nmcCaseId:nmc.id,
   nmcCaseStatus:nmc.status,notificationCreated:false};
 const update={
  inspectionId:caseId,referralId:inspectionCase.nmcReferralId,
  reportId:record.report.id,decision,
  inspector:record.report.submittedBy||null,
  supervisor:record.report.supervisor||null,
  summary:String(record.report.summary||'Supervisor inspection report decision').slice(0,500)
 };
 const result=await cases.inspectionReview(nmc.id,nmc.version,update,'SI_SUPERVISOR');
 return {status:'RECORDED',nmcCaseId:result.id||nmc.id,
   nmcCaseStatus:result.status,notificationCreated:true,
   riskRecalculated:false,officialCaseClosed:false};
}
