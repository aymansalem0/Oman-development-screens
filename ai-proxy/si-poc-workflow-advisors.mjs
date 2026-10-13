/**
 * SI POC future-state assistants without an approved Airia interface.
 *
 * These internal adapters emit stable, schema-tagged responses so the Angular
 * business journey can be demonstrated before the provider supplies signed
 * contracts. They DO NOT call AI, inspect photos, authenticate certificates,
 * declare deficiencies, schedule a vessel or make a statutory decision.
 * Airia C01/P01/A04 continue through their existing validated pathways.
 */
export const SI_FUTURE_MOCK_LABEL='MOCK_POC_NOT_REAL_AI';
const supported=new Set(['SI-S01','SI-V01','SI-R01','SI-X01']);
const demo='RECURRING_DEFICIENCY_CERT_EXPIRY_CONFLICT';
export class SiPocAdvisorError extends Error{
 constructor(code,status=422){super(code);this.code=code;this.status=status;}
}
export function siFutureAdvisorCoverage(){
 return {
  contract:'SI-POC-ADVICE-v1-PROVISIONAL',
  provider:'MOCK',externalCalls:0,formalApprovalRequired:true,
  supported:[...supported],
  liveProviderStatus:'AIRIA_RESPONSE_CONTRACT_NOT_RECEIVED',
  notice:'Internal response contract only. Replace after Airia schema review.'};
}
export function runSiPocAdvisor(request,view){
 const {agentCode,caseId,scenario=null}=request||{};
 if(!supported.has(agentCode)||!view?.inspectionCase||caseId!==view.inspectionCase.id||
    !['',null,demo].includes(scenario))
  throw new SiPocAdvisorError('SI_POC_ADVISOR_INPUT_INVALID');
 const r=view.record||null;
 const findings=(r?.findings||[]).filter(x=>x.status==='CONFIRMED_BY_INSPECTOR');
 const refs=[...new Set([...(r?.checks||[]).flatMap(c=>c.evidenceRefs||[]),
  ...findings.flatMap(f=>f.evidenceRefs||[])])].slice(0,30);
 const basis={caseId,imo:view.inspectionCase.imo,
  caseVersion:r?.version||0,stage:r?.stage||'NOT_STARTED',
  recordedEvidenceRefs:refs,preparationStatus:view.preparation?.status||'UNKNOWN',
  sourceReferences:(view.inspectionCase.inspectionReasons||[])
   .map(x=>x.sourceReference).filter(Boolean)};
 const advice=[];
 let draft=null;
 if(agentCode==='SI-S01'){
  advice.push({code:'ASSIGNMENT_OPTIONS_REVIEW',severity:'INFO',
   title:'Review inspector availability and confirmed arrival before scheduling',
   explanation:view.nmcBooking?.status==='SCHEDULED'
    ?'A pre-existing human-confirmed NMC scheduling record is available; keep that booking authoritative.'
    :'No confirmed NMC scheduling data exists. Obtain an available ERP inspector slot and operational confirmation.',
   evidenceRefs:[],requiresHumanReview:true});
 }
 if(agentCode==='SI-V01'){
  advice.push({code:'FIELD_EVIDENCE_REVIEW',severity:'REVIEW_REQUIRED',
   title:refs.length?'Verify recorded evidence references and original media':'Field evidence has not yet been captured',
   explanation:refs.length?'References are metadata only; no image recognition, originality check or photograph assessment was performed.':
    'Capture a photo/notes/checklist item before recording a finding. This mock does not infer observations.',
   evidenceRefs:refs,requiresHumanReview:true});
 }
 if(agentCode==='SI-R01'){
  draft={status:'DRAFT_FOR_INSPECTOR_REVIEW',
   title:'Inspection report assistance — MOCK',
   summary:r?.report?.summary||
    ('Saved inspector record: '+(r?.checks?.length||0)+' checks; '+
     findings.length+' human-confirmed deficiencies.'),
   findingRefs:findings.map(f=>({findingId:f.id,severity:f.severity,
     description:f.description,evidenceRefs:f.evidenceRefs||[]})),
   evidenceRefs:refs,aiGenerated:false,autoIssued:false};
  advice.push({code:'REPORT_REVIEW_REQUIRED',severity:'INFO',
    title:'Inspector and independent supervisor must verify report',
    explanation:'Only human-recorded checks/findings were included. This preview does not update the official report.',
    evidenceRefs:refs,requiresHumanReview:true});
 }
 if(agentCode==='SI-X01'){
  if(findings.some(f=>['MAJOR','CRITICAL'].includes(f.severity))){
   advice.push({code:'HIGH_SEVERITY_FINDING_REVIEW',severity:'REVIEW_REQUIRED',
    title:'Recorded major/critical finding requires formal follow-up',
    explanation:'This flags the already recorded inspector finding; severity and enforcement remain human decisions.',
    evidenceRefs:findings.filter(f=>['MAJOR','CRITICAL'].includes(f.severity))
     .flatMap(f=>f.evidenceRefs||[]),requiresHumanReview:true});
  }
  if(scenario===demo){
   const names=[
    ['RECURRING_DEFICIENCY','Previously unresolved recurring deficiency (SAMPLE)'],
    ['CERTIFICATE_EXPIRY','Certificate nearing expiry (SAMPLE)'],
    ['CONFLICTING_EVIDENCE','Field evidence conflicts with prior information (SAMPLE)']
   ];
   for(const [code,title] of names)advice.push({
    code,severity:'SCENARIO_ONLY',title,
    explanation:'Demonstration assumption from the MOEI POC exception scenario. No real certificate, history or photo was verified.',
    evidenceRefs:[],requiresHumanReview:true,synthetic:true});
  }
  if(!advice.length)advice.push({code:'NO_VERIFIED_EXCEPTION',severity:'INFO',
   title:'No supported exception inferred from saved case state',
   explanation:'Lack of saved evidence is not proof of compliance. Inspector review remains required.',
   evidenceRefs:refs,requiresHumanReview:true});
 }
 return {
  status:'MOCK_ADVISORY_REVIEW_REQUIRED',
  schemaVersion:'SI-POC-ADVICE-v1-PROVISIONAL',
  agentCode,provider:'MOCK',simulationLabel:SI_FUTURE_MOCK_LABEL,
  scenario:scenario||null,snapshot:basis,advice,draft,
  externalCalls:0,caseMutations:0,regulatoryDecision:false,
  humanApprovalRequired:true,
  warning:'No Airia contract. Deterministic backend simulation; no model/media/certificate analysis.'};
}
