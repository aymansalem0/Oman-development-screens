/**
 * Exactly one NMC Case may be notified about a human supervisor report
 * decision for a matching scheduled inspection referral. Never issue a
 * regulatory decision or rewrite the vessel's A01/A02 risk score.
 */
export class SiNmcReviewSyncError extends Error{
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export async function syncSiSupervisorReviewToNmc({caseId,inspectionCase,
 record,cases,forwardToNmc=false}={}){
 if(!inspectionCase?.nmcReferralId&&forwardToNmc!==true)
   return {status:'NOT_FORWARDED_TO_NMC',notificationCreated:false};
 if(!record?.report||!['APPROVED','RETURNED'].includes(record.report.status)||
    record.caseId!==caseId||record.imo!==inspectionCase.imo)
   throw new SiNmcReviewSyncError('SI_NMC_REVIEW_NOT_FINALIZED');
 if(!inspectionCase.nmcReferralId){
   // A supervisor-selected forward from a purely SI-origin report becomes a
   // central NMC case. No fake request, official action or detention.
   const created=await cases.fromSiInspection({
     inspectionId:caseId,imo:inspectionCase.imo,reportId:record.report.id,
     summary:String(record.report.summary||'Approved inspector report').slice(0,500),
     supervisor:record.report.supervisor
   });
   return {status:'RECORDED',nmcCaseId:created.id,nmcCaseStatus:created.status,
     notificationCreated:true,riskRecalculated:false,
     officialCaseClosed:false};
 }
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
