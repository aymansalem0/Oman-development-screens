/** 
 * Regulatory review preparation ledger. This DOES NOT transmit to Riyadh MoU,
 * detain a vessel, create an NMC case or issue an official regulatory order.
 * All source links are persisted for a human officer's later authorization.
 */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
const TYPES=new Set(['PREPARE_RIYADH_MOU_REPORT','REFER_DETENTION_REVIEW',
 'REQUEST_ADDITIONAL_INSPECTION','PREPARE_NMC_NOTIFICATION']);
export class SiRegulatoryDraftError extends Error{
 constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export class SiRegulatoryDrafts{
 constructor({file=process.env.SI_SUPERVISOR_REGULATORY_PATH||
   '/data/si-supervisor-regulatory-drafts.json'}={}){
  this.file=file;
 }
 list(caseId){
  let rows=[];
  if(existsSync(this.file)){
   try{rows=JSON.parse(readFileSync(this.file,'utf8'));}
   catch{throw new SiRegulatoryDraftError('SI_REGULATORY_DRAFT_STORE_INVALID',503);}
  }
  return rows.filter(x=>x.caseId===caseId);
 }
 prepare({view,type,reason,actor}={}){
  if(!TYPES.has(type)||typeof reason!=='string'||reason.trim().length<8||
     reason.length>1200||typeof actor!=='string'||!actor.trim())
   throw new SiRegulatoryDraftError('SI_REGULATORY_PREPARATION_INVALID');
  if(!view?.record?.report||view.record.report.status!=='APPROVED'||
     !['REPORT_APPROVED','ACTIONS_OPEN','FOLLOW_UP_PENDING',
       'READY_TO_CLOSE','CLOSED'].includes(view.record.stage))
   throw new SiRegulatoryDraftError('SI_REGULATORY_APPROVED_REPORT_REQUIRED',409);
  const isPsc=/(?:^|[^A-Z])PSC(?:[^A-Z]|$)|PORT.STATE.CONTROL/i.test(
   view.inspectionCase.regime||'');
  if(type==='PREPARE_RIYADH_MOU_REPORT'&&!isPsc)
   throw new SiRegulatoryDraftError('SI_REGULATORY_PSC_REVIEW_REQUIRED',409);
  const existing=this.list(view.inspectionCase.id);
  const source={
   caseId:view.inspectionCase.id,imo:view.inspectionCase.imo,
   regime:view.inspectionCase.regime,reportId:view.record.report.id,
   inspector:view.record.report.submittedBy||null,
   supervisor:view.record.report.supervisor||null,
   findingsCount:view.record.findings?.length||0,
   criticalFindings:view.record.findings?.filter(x=>x.severity==='CRITICAL').length||0,
   nmcReferralId:view.inspectionCase.nmcReferralId||null
  };
  const record={...source,id:randomUUID(),type,reason:reason.trim(),preparedBy:actor,
   preparedAt:new Date().toISOString(),
   state:'PREPARED_NOT_SUBMITTED',officialSubmission:false,
   externalTransmissionAttempted:false,regulatoryDecisionExecuted:false,
   sourceReportApproved:true};
  mkdirSync(dirname(this.file),{recursive:true});
  // Read entire ledger to preserve drafts from other cases.
  let all=[];
  if(existsSync(this.file)){
   try{all=JSON.parse(readFileSync(this.file,'utf8'));}
   catch{throw new SiRegulatoryDraftError('SI_REGULATORY_DRAFT_STORE_INVALID',503);}
  }
  if(!Array.isArray(all))throw new SiRegulatoryDraftError('SI_REGULATORY_DRAFT_STORE_INVALID',503);
  const tmp=this.file+'.tmp-'+record.id;
  writeFileSync(tmp,JSON.stringify([...all,record].slice(-5000)),{mode:0o600});
  renameSync(tmp,this.file);
  return record;
 }
}
