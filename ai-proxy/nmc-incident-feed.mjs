/**
 * NMC Incident POC source feed and incident-specific AI triage.
 * Separate from A01/A02 official vessel score and PSC findings.
 * Google Sheets is the POC source and the assessment audit ledger.
 * No case, detention, port ban, or vessel risk is changed.
 */
import {createHash,createSign,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

const INCIDENT_COLUMNS=[
 'Incident_ID','Source_Type','Source_Organization','Source_Reference',
 'Reported_At_UTC','Occurred_At_UTC','IMO','Vessel_Name','Incident_Type',
 'Port_or_Zone','Latitude','Longitude','Incident_Description',
 'Source_Incident_Status','Operational_Status','Reported_Severity',
 'Persons_Affected','Pollution_Reported','Evidence_Reference','Source_URL',
 'Received_At_UTC','Updated_At_UTC','Assigned_Officer','Officer_Notes',
 'Data_Nature','AI_Review_Request'
];
const ASSESSMENT_COLUMNS=[
 'Incident_ID','Description_SHA256','Assessment_ID','Assessed_At_UTC',
 'AI_Provider','AI_Model','AI_Incident_Category','AI_Impact_0_5',
 'AI_Urgency_0_5','AI_Exposure_0_5','AI_Recurrence_0_5',
 'Incident_Risk_Score_0_100','Incident_Risk_Band','AI_Proposed_Followup',
 'AI_Reasoning','AI_Confidence_0_1','Missing_Information',
 'Officer_Decision','Officer_Name','Officer_Reviewed_At_UTC',
 'Approved_Followup_Status','Linked_Case_ID','Assessment_Status','Governance_Notice',
 'AI_Suggested_Followup_State','Officer_Approved_Followup_State','Officer_Review_Reason',
 'A01_Incident_Evidence_IDs','A02_Incident_Compliance_Status',
 'A02_Incident_Evidence_IDs','A02_Incident_Reasoning',
 'Incident_Agent_Contract_Version'
];
const STATUS=new Set(['RECEIVED','UNDER_VERIFICATION','MONITORING',
 'REFERRED_FOR_INSPECTION','ESCALATED_TO_AUTHORITY','RESPONSE_IN_PROGRESS',
 'RESOLVED','CLOSED']);
export const FOLLOWUP_OPTIONS=Object.freeze([
 'VERIFY_INFORMATION','ACTIVE_MONITORING','REFER_SMART_INSPECTION',
 'ESCALATE_TO_AUTHORITY','INCIDENT_RESPONSE','CLOSE_AFTER_VERIFICATION'
]);
/** Next-step routing states, NOT executed / reported incident statuses. */
export const INCIDENT_FOLLOWUP_STATES=Object.freeze({
 VERIFY_INFORMATION:'VERIFICATION_REQUIRED',
 ACTIVE_MONITORING:'MONITORING_TO_ASSIGN',
 REFER_SMART_INSPECTION:'INSPECTION_REFERRAL_PENDING',
 ESCALATE_TO_AUTHORITY:'AUTHORITY_ESCALATION_PENDING',
 INCIDENT_RESPONSE:'RESPONSE_COORDINATION_PENDING',
 CLOSE_AFTER_VERIFICATION:'CLOSURE_EVIDENCE_REQUIRED'
});
const SOURCE_TYPES=new Set(['REPORTING_PLATFORM','PORT_AUTHORITY']);
const CATEGORY_TYPES=new Set([
 'FIRE','COLLISION','GROUNDING','ENGINE_FAILURE','STEERING_FAILURE',
 'POLLUTION','SECURITY','MEDICAL','NEAR_MISS','OTHER'
]);
const SCORE_VERSION='INCIDENT-TRIAGE-1.0';
const notice='POC AI advice only; not vessel overall risk, verified incident fact or legal order. Human decision required.';
const hash=text=>createHash('sha256').update(text).digest('hex');
const compact=(v,max=1000)=>String(v??'').trim().slice(0,max);
const enc=encodeURIComponent;
const iso=()=>new Date().toISOString();
export class IncidentTriageError extends Error {
 constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const trimJson=value=>{
 if(typeof value==='object'&&value!==null)return value;
 if(typeof value!=='string')throw new IncidentTriageError('INCIDENT_AI_RESPONSE_INVALID',502);
 let clean=value.trim().replace(/^\x60\x60\x60(?:json)?/i,'').replace(/\x60\x60\x60$/,'').trim();
 try{return JSON.parse(clean);}catch{throw new IncidentTriageError('INCIDENT_AI_RESPONSE_INVALID',502);}
};
const num=(x,low,high)=>Number.isInteger(x)&&x>=low&&x<=high;
export function validateIncidentAI(raw){
 const data=trimJson(raw);
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw new IncidentTriageError('INCIDENT_AI_RESPONSE_INVALID',502);
 const dims=['impact','urgency','exposure','recurrence'];
 if(dims.some(x=>!num(data[x],0,5))||!FOLLOWUP_OPTIONS.includes(data.recommendedFollowup)||
   !CATEGORY_TYPES.has(data.category)||typeof data.reasoning!=='string'||
   data.reasoning.trim().length<30||data.reasoning.length>2200||
   !Number.isFinite(data.confidence)||data.confidence<0||data.confidence>1||
   !Array.isArray(data.missingInformation)||data.missingInformation.length>8||
   data.missingInformation.some(x=>typeof x!=='string'||x.length>160))
  throw new IncidentTriageError('INCIDENT_AI_RESPONSE_INVALID',502);
 const riskScore=Math.round((data.impact*35+data.urgency*30+
   data.exposure*20+data.recurrence*15)/5);
 const riskBand=riskScore>=75?'CRITICAL':riskScore>=50?'HIGH':
   riskScore>=25?'MODERATE':'LOW';
 return {
   category:data.category,impact:data.impact,urgency:data.urgency,
   exposure:data.exposure,recurrence:data.recurrence,
   incidentRiskScore:riskScore,incidentRiskBand:riskBand,
   aiProposedFollowup:data.recommendedFollowup,
   suggestedFollowupState:INCIDENT_FOLLOWUP_STATES[data.recommendedFollowup],
   aiReasoning:data.reasoning.trim(),confidence:data.confidence,
   missingInformation:data.missingInformation.map(x=>x.trim()).filter(Boolean),
   requiresHumanReview:true,requiresImmediateReview:riskScore>=75||data.urgency>=4,
   riskPolicyVersion:SCORE_VERSION,regulatoryEffect:'NONE_POC_ONLY'
 };
}
export function parseIncidentSheet(values){
 if(!Array.isArray(values)||!Array.isArray(values[0])||
   INCIDENT_COLUMNS.some((h,i)=>values[0][i]!==h))
   throw new IncidentTriageError('INCIDENT_SHEET_HEADER_MISMATCH',503);
 const seen=new Set(),result=[];
 for(let ri=1;ri<values.length;ri++){
  const raw=values[ri]||[];
  if(!raw.some(v=>String(v??'').trim()))continue;
  const o=Object.fromEntries(INCIDENT_COLUMNS.map((key,i)=>[key,compact(raw[i],key==='Incident_Description'?4000:300)]));
  if(!/^INC-[A-Za-z0-9-]{3,70}$/.test(o.Incident_ID)||
    seen.has(o.Incident_ID)||!SOURCE_TYPES.has(o.Source_Type)||
    !o.Source_Reference||!o.Source_Organization||
    !CATEGORY_TYPES.has(o.Incident_Type)||!STATUS.has(o.Operational_Status)||
    o.Incident_Description.length<30||!/^SYNTHETIC_POC$/.test(o.Data_Nature)||
    !['YES','NO'].includes(o.AI_Review_Request)||
    (o.IMO&&!/^\d{7}$/.test(o.IMO)))
    throw new IncidentTriageError('INCIDENT_SHEET_ROW_INVALID_'+String(ri+1),422);
  seen.add(o.Incident_ID);
  result.push({
   incidentId:o.Incident_ID,sourceType:o.Source_Type,
   sourceOrganization:o.Source_Organization,sourceReference:o.Source_Reference,
   reportedAt:o.Reported_At_UTC,occurredAt:o.Occurred_At_UTC,
   imo:o.IMO||null,vesselName:o.Vessel_Name,incidentType:o.Incident_Type,
   portOrZone:o.Port_or_Zone,latitude:o.Latitude,longitude:o.Longitude,
   description:o.Incident_Description,
   sourceIncidentStatus:o.Source_Incident_Status,
   operationalStatus:o.Operational_Status,reportedSeverity:o.Reported_Severity,
   personsAffected:o.Persons_Affected,pollutionReported:o.Pollution_Reported,
   evidenceReference:o.Evidence_Reference,receivedAt:o.Received_At_UTC,
   updatedAt:o.Updated_At_UTC,assignedOfficer:o.Assigned_Officer,
   dataNature:o.Data_Nature,aiReviewRequested:o.AI_Review_Request==='YES',
   rowNumber:ri+1,descriptionHash:hash(o.Incident_Description)
  });
 }
 return result;
}
/**
 * For manually maintained Google Sheets, a half-filled new row must not
 * hide all valid previously received incidents from the Command Center.
 * Invalid or duplicate rows are omitted *with explicit row diagnostics*.
 * The strict parser remains available for contract tests/import validation.
 */
export function parseIncidentFeedRows(values){
  if(!Array.isArray(values)||!Array.isArray(values[0])||
    INCIDENT_COLUMNS.some((h,i)=>values[0][i]!==h))
    throw new IncidentTriageError('INCIDENT_SHEET_HEADER_MISMATCH',503);
  const incidents=[],rejectedRows=[];
  const seen=new Set();
  for(let index=1;index<values.length;index++){
    const row=values[index]||[];
    if(!row.some(v=>String(v??'').trim()))continue;
    try{
      const incident=parseIncidentSheet([values[0],row])[0];
      if(seen.has(incident.incidentId))
        throw new IncidentTriageError('INCIDENT_DUPLICATE_ID',422);
      seen.add(incident.incidentId);
      incidents.push({...incident,rowNumber:index+1});
    }catch(e){
      rejectedRows.push({rowNumber:index+1,
        code:e instanceof IncidentTriageError?e.code:'INCIDENT_ROW_INVALID'});
    }
  }
  return {incidents,rejectedRows};
}
const unpackAssessments=values=>{
 if(!Array.isArray(values)||!Array.isArray(values[0])||
   ASSESSMENT_COLUMNS.some((h,i)=>values[0][i]!==h))
  throw new IncidentTriageError('INCIDENT_AI_SHEET_HEADER_MISMATCH',503);
 return values.slice(1).filter(r=>r?.[0]).map(r=>({
  incidentId:r[0],descriptionHash:r[1],assessmentId:r[2],assessedAt:r[3],
  aiProvider:r[4],aiModel:r[5],category:r[6],
  impact:Number(r[7]),urgency:Number(r[8]),exposure:Number(r[9]),
  recurrence:Number(r[10]),incidentRiskScore:Number(r[11]),
  incidentRiskBand:r[12],aiProposedFollowup:r[13],
  aiReasoning:r[14],confidence:Number(r[15]),
  missingInformation:String(r[16]||'').split(' | ').filter(Boolean),
  officerDecision:r[17]||null,officerName:r[18]||null,
  officerReviewedAt:r[19]||null,approvedFollowupStatus:r[20]||null,
  linkedCaseId:r[21]||null,assessmentStatus:r[22]||null,
  suggestedFollowupState:r[24]||
    INCIDENT_FOLLOWUP_STATES[r[13]]||'VERIFICATION_REQUIRED',
  approvedFollowupState:r[25]||null,
  officerReviewReason:r[26]||null,
  aiEvidenceIds:String(r[27]||'').split(' | ').filter(Boolean),
  a02IncidentCompliance:{
    status:r[28]||'NOT_AVAILABLE',
    evidenceIds:String(r[29]||'').split(' | ').filter(Boolean),
    reasoning:r[30]||'',
    authoritative:false
  },
  contractVersion:r[31]||null
 }));
};

export class NmcIncidentFeed {
 constructor({sheetId=process.env.NMC_INCIDENT_SHEET_ID||'',
   credentialsPath=process.env.NMC_INCIDENT_CREDENTIALS_PATH||
     '/run/secrets/nmc-psc-google.json',
   // Reuse existing A01/A02 Airia pipeline execution; NEVER a separate LLM.
   executeIncidentAgents=null,
   agentEnabled=()=>false,
   autoEnabled=process.env.NMC_INCIDENT_AUTO_TRIAGE_ENABLED==='true'&&
     process.env.NMC_INCIDENT_AIRIA_EXTENSION_CONFIRMED==='true',
   autoMaxPerCycle=Number(process.env.NMC_INCIDENT_AUTO_MAX_PER_CYCLE||2),
   fetchImpl=globalThis.fetch,
   credentials=null
  }={}){
  this.sheetId=sheetId.trim();this.credentialsPath=credentialsPath;
  this.provider='airia_a01_a02';this.model='EXISTING_A01_A02_PIPELINES';
  this.executeIncidentAgents=executeIncidentAgents;
  this.agentEnabled=agentEnabled;
  this.fetch=fetchImpl;this.credentials=credentials;
  this.token=null;this.inFlight=new Set();this.reviewInFlight=new Set();
  // Strict opt-in for scheduled billable calls, never from a browser read.
  this.autoEnabled=autoEnabled===true;
  this.autoMaxPerCycle=Math.min(5,Math.max(1,Math.trunc(
    Number.isFinite(autoMaxPerCycle)?autoMaxPerCycle:2)));
  this.autoRunning=false;
  this.lastAutoRun=null;
  this.autoFailedDescriptions=new Set(); // do not repeatedly bill failing rows
 }
 get configured(){return !!this.sheetId;}
 get aiConfigured(){return typeof this.executeIncidentAgents==='function'&&
   this.agentEnabled()===true;}
 health(){return {sourceConfigured:this.configured,aiConfigured:this.aiConfigured,
   aiProvider:this.provider,scorePolicy:SCORE_VERSION,
   incidentAgentContract:'NMC_INCIDENT_A01_A02_EXT_V1',
   incidentContractRuntimeVerified:false,
   automaticTriageEnabled:this.autoEnabled,
   autoMaxPerCycle:this.autoMaxPerCycle,lastAutoRun:this.lastAutoRun,
   sourceStatus:this.configured?'READY_TO_FETCH':'NOT_CONFIGURED',
   realEnforcementEnabled:false,officialVesselRiskAffected:false};}
 async accessToken(){
  if(this.token&&this.token.until>Date.now()+90000)return this.token.value;
  let id=this.credentials;
  if(!id){try{id=JSON.parse(readFileSync(this.credentialsPath,'utf8'));}
   catch{throw new IncidentTriageError('INCIDENT_GOOGLE_CREDENTIALS_MISSING',503);}}
  if(id?.type!=='service_account'||!id.client_email||!id.private_key)
   throw new IncidentTriageError('INCIDENT_GOOGLE_CREDENTIALS_INVALID',503);
  const sec=Math.floor(Date.now()/1000);
  const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const header=b({alg:'RS256',typ:'JWT'});
  const body=b({iss:id.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',
    aud:'https://oauth2.googleapis.com/token',iat:sec,exp:sec+3600});
  const signingInput=header+'.'+body;
  const signature=createSign('RSA-SHA256');
  signature.update(signingInput);signature.end();
  const assertion=signingInput+'.'+signature.sign(id.private_key).toString('base64url');
  let response;
  try{response=await this.fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
    signal:AbortSignal.timeout(20000)
  });}catch{throw new IncidentTriageError('INCIDENT_GOOGLE_TOKEN_UNAVAILABLE',503);}
  if(!response.ok)throw new IncidentTriageError('INCIDENT_GOOGLE_TOKEN_DENIED',503);
  const data=await response.json();
  if(!data.access_token)throw new IncidentTriageError('INCIDENT_GOOGLE_TOKEN_INVALID',503);
  this.token={value:data.access_token,until:Date.now()+Number(data.expires_in||3500)*1000};
  return this.token.value;
 }
 async sheets(method,range,{values,append=false}={}){
  if(!this.configured)throw new IncidentTriageError('INCIDENT_SHEET_NOT_CONFIGURED',503);
  const token=await this.accessToken();
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+enc(this.sheetId)+
    '/values/'+enc(range);
  const url=append?base+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS':base;
  let response;
  try{response=await this.fetch(url,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(values?{body:JSON.stringify({values,majorDimension:'ROWS'})}:{}),
    signal:AbortSignal.timeout(25000)
  });}catch{throw new IncidentTriageError('INCIDENT_SHEET_UNAVAILABLE',503);}
  if(!response.ok)throw new IncidentTriageError(
    response.status===403?'INCIDENT_SHEET_ACCESS_DENIED':'INCIDENT_SHEET_REQUEST_FAILED',503);
  return await response.json();
 }
 async load(){
  const [raw,ai]=await Promise.all([
    this.sheets('GET','Incident_Registry!A1:Z1500'),
    this.sheets('GET','AI_Assessments!A1:AF1500')
  ]);
  const {incidents,rejectedRows}=parseIncidentFeedRows(raw.values||[]);
  const allAssessments=unpackAssessments(ai.values||[]);
  const latest=new Map();
  for(const row of allAssessments)latest.set(row.incidentId,row);
  return {status:'ok',source:'GOOGLE_SHEETS_SYNTHETIC_POC',
    rejectedRows,sourceValidationWarnings:rejectedRows.length,
    incidents:incidents.map(row=>{
      const aiRow=latest.get(row.incidentId);
      const fresh=aiRow?.descriptionHash===row.descriptionHash;
      const current=fresh?aiRow:null;
      return {...row,aiAssessment:current,aiAssessmentStale:!!aiRow&&!fresh,
        nextFollowup:current?{
          status:current.approvedFollowupState||
            current.suggestedFollowupState,
          approval:current.assessmentStatus==='HUMAN_REVIEWED'?
            'OFFICER_APPROVED':'AI_PROPOSED',
          reason:current.officerReviewReason||current.aiReasoning
        }:null};
    }),
    summary:{
      total:incidents.length,unresolved:incidents.filter(x=>!['CLOSED','RESOLVED'].includes(x.operationalStatus)).length,
      pendingAi:incidents.filter(x=>x.aiReviewRequested&&
        latest.get(x.incidentId)?.descriptionHash!==x.descriptionHash).length,
      aiAnalyzed:[...latest.keys()].length
    },
    aiEnabled:this.aiConfigured,riskMode:'INCIDENT_SPECIFIC_NOT_VESSEL_RISK'};
 }
 async review(id,{assessmentId,decision,approvedFollowup,note,officer}={}){
  if(!/^INC-[A-Za-z0-9-]{3,70}$/.test(id))
   throw new IncidentTriageError('INCIDENT_ID_INVALID');
  if(this.reviewInFlight.has(id)||this.inFlight.has(id))
   throw new IncidentTriageError('INCIDENT_REVIEW_ALREADY_RUNNING',409);
  this.reviewInFlight.add(id);
  try{
  if(!['ACCEPT','MODIFY','REJECT'].includes(decision)||
    !FOLLOWUP_OPTIONS.includes(approvedFollowup)||
    !/^[\p{L}\p{M}\p{N} .'-]{3,80}$/u.test(String(officer||''))||
    typeof note!=='string'||note.trim().length<15||note.length>1000)
   throw new IncidentTriageError('INCIDENT_OFFICER_REVIEW_INVALID',422);
  const feed=await this.load();
  const source=feed.incidents.find(x=>x.incidentId===id);
  if(!source?.aiAssessment||source.aiAssessment.assessmentId!==assessmentId)
   throw new IncidentTriageError('INCIDENT_AI_ASSESSMENT_CHANGED',409);
  if(source.aiAssessment.assessmentStatus==='HUMAN_REVIEWED')
   throw new IncidentTriageError('INCIDENT_ALREADY_REVIEWED',409);
  if((decision==='ACCEPT'&&approvedFollowup!==source.aiAssessment.aiProposedFollowup)||
     (decision==='MODIFY'&&approvedFollowup===source.aiAssessment.aiProposedFollowup)||
     (decision==='REJECT'&&approvedFollowup!=='VERIFY_INFORMATION'))
   throw new IncidentTriageError('INCIDENT_OFFICER_DECISION_MISMATCH',422);
  const prior=source.aiAssessment;
  // Source fields and model output are preserved byte-for-byte: append an
  // auditable review record, never overwrite AI's original recommendation.
  const record=[id,source.descriptionHash,assessmentId,prior.assessedAt,
    prior.aiProvider,prior.aiModel,prior.category,prior.impact,
    prior.urgency,prior.exposure,prior.recurrence,prior.incidentRiskScore,
    prior.incidentRiskBand,prior.aiProposedFollowup,prior.aiReasoning,
    prior.confidence,prior.missingInformation.join(' | '),
    decision,officer.trim(),iso(),approvedFollowup,'','HUMAN_REVIEWED',
    notice+' Officer reason: '+note.trim(),
    prior.suggestedFollowupState||INCIDENT_FOLLOWUP_STATES[prior.aiProposedFollowup],
    INCIDENT_FOLLOWUP_STATES[approvedFollowup],note.trim(),
    prior.aiEvidenceIds.join(' | '),
    prior.a02IncidentCompliance.status,
    prior.a02IncidentCompliance.evidenceIds.join(' | '),
    prior.a02IncidentCompliance.reasoning,
    prior.contractVersion||'UNVERSIONED'];
  await this.sheets('POST','AI_Assessments!A:AF',{values:[record],append:true});
  return {status:'ok',incidentId:id,assessmentId,decision,approvedFollowup,
    officer:officer.trim(),officerNote:note.trim(),
    approvedFollowupState:INCIDENT_FOLLOWUP_STATES[approvedFollowup],
    saved:true,operationalStatusNotChanged:true,officialRiskNotChanged:true};
  }finally{this.reviewInFlight.delete(id);}
 }
 async runAI(incident){
  if(!this.aiConfigured)
   throw new IncidentTriageError('AIRIA_A01_A02_NOT_ENABLED',503);
  // The backend adapter uses the EXISTING A01/A02 Airia pipeline IDs.
  // The agents must explicitly return the incident extension contract;
  // never fake a score from normal vessel-risk signals.
  return await this.executeIncidentAgents(incident);
 }
 /**
  * Optional source ingestion processor. No browser GET or map refresh calls AI.
  * Charges are bounded by per-row AI_Review_Request and per-cycle limits.
  */
 async autoTick(){
  if(!this.autoEnabled||!this.aiConfigured)
    return {enabled:false,assessed:0};
  if(this.autoRunning)return {enabled:true,skipped:'ALREADY_RUNNING'};
  this.autoRunning=true;
  const result={enabled:true,assessed:0,failed:0,skipped:0};
  try{
   const feed=await this.load();
   const pending=feed.incidents.filter(x=>
     x.aiReviewRequested&&!x.aiAssessment&&
     !this.autoFailedDescriptions.has(x.incidentId+':'+x.descriptionHash)&&
     !['CLOSED','RESOLVED'].includes(x.operationalStatus));
   for(const incident of pending.slice(0,this.autoMaxPerCycle)){
    try{
     await this.analyze(incident.incidentId,{confirmCost:true});
     result.assessed++;
    }catch{
     // Never repeatedly charge A01/A02 for the same failing description.
     // A changed incident description receives a new hash and may be retried.
     this.autoFailedDescriptions.add(incident.incidentId+':'+incident.descriptionHash);
     result.failed++;
    }
   }
   result.skipped=Math.max(0,pending.length-this.autoMaxPerCycle);
   this.lastAutoRun={at:iso(),...result};
   return result;
  }finally{this.autoRunning=false;}
 }
 async analyze(id,{confirmCost=false,force=false}={}){
  if(confirmCost!==true)throw new IncidentTriageError('INCIDENT_AI_CONFIRMATION_REQUIRED');
  if(!/^INC-[A-Za-z0-9-]{3,70}$/.test(id))throw new IncidentTriageError('INCIDENT_ID_INVALID');
  if(this.inFlight.has(id)||this.reviewInFlight.has(id))
   throw new IncidentTriageError('INCIDENT_AI_ALREADY_RUNNING',409);
  this.inFlight.add(id);
  try{
   const before=await this.load();
   const incident=before.incidents.find(v=>v.incidentId===id);
   if(!incident)throw new IncidentTriageError('INCIDENT_NOT_FOUND',404);
   if(!incident.aiReviewRequested)throw new IncidentTriageError('INCIDENT_AI_OPTIN_REQUIRED',409);
   if(incident.aiAssessment&&!force)return {status:'ok',reused:true,assessment:incident.aiAssessment};
   if(incident.aiAssessment?.assessmentStatus==='HUMAN_REVIEWED'&&force)
     throw new IncidentTriageError('INCIDENT_ALREADY_REVIEWED',409);
   const classification=await this.runAI(incident);
   // Race safe: refuse to save AI inference for description altered mid-request.
   const after=await this.load();
   const latest=after.incidents.find(v=>v.incidentId===id);
   if(!latest||latest.descriptionHash!==incident.descriptionHash)
    throw new IncidentTriageError('INCIDENT_SOURCE_CHANGED_DURING_AI',409);
   const row={
    incidentId:id,descriptionHash:incident.descriptionHash,
    assessmentId:randomUUID(),assessedAt:iso(),
    aiProvider:this.provider,aiModel:this.model,...classification,
    assessmentStatus:'AI_COMPLETE'
   };
   const values=[row.incidentId,row.descriptionHash,row.assessmentId,row.assessedAt,
     row.aiProvider,row.aiModel,row.category,row.impact,row.urgency,row.exposure,
     row.recurrence,row.incidentRiskScore,row.incidentRiskBand,row.aiProposedFollowup,
     row.aiReasoning,row.confidence,row.missingInformation.join(' | '),
     '','','','','','AI_COMPLETE',notice,row.suggestedFollowupState,'','',
     row.aiEvidenceIds.join(' | '),
     row.a02IncidentCompliance.status,
     row.a02IncidentCompliance.evidenceIds.join(' | '),
     row.a02IncidentCompliance.reasoning,
     row.contractVersion];
   await this.sheets('POST','AI_Assessments!A:AF',{values:[values],append:true});
   return {status:'ok',reused:false,assessment:row};
  }finally{this.inFlight.delete(id);}
 }
}
