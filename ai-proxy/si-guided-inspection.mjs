/**
 * One inspector-facing guided execution view from immutable published checklist
 * snapshots, the eight legacy case checks and SUPERVISOR-APPROVED A04 scope.
 * Read-only projection: no models, source writes, inspection approvals or
 * statutory decisions occur when a vessel is selected.
 */
import {createHash} from 'node:crypto';
import {SI_BASE_CHECKLIST} from './si-inspection-preparation.mjs';

const unique=v=>[...new Set(v.filter(Boolean))];
const text=v=>typeof v==='string'?v.trim():'';
const list=v=>Array.isArray(v)?v:[];
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,20);
const base={
 'fire-safety':{
  en:'Fire safety',ar:'السلامة ومكافحة الحريق',
  action:'Inspect the fire-safety equipment and accessible arrangements; verify the applicable onboard documents and maintenance evidence. Record observed condition and photographs where available.'},
 certificates:{
  en:'Certificates and documents',ar:'الشهادات والمستندات',
  action:'Check original or verified vessel certificates, names, IMO, validity dates and supporting evidence. Record any missing or inconsistent document for officer review.'},
 navigation:{
  en:'Navigation equipment',ar:'معدات الملاحة',
  action:'Observe the navigation and bridge equipment accessible during the visit. Compare onboard records with the documented inspection requirement; record readings or missing proof without inventing compliance.'},
 lifesaving:{
  en:'Life-saving appliances',ar:'معدات الإنقاذ',
  action:'Locate the applicable life-saving appliances, check their visible condition, markings and available service records, and document observable gaps.'},
 pollution:{
  en:'Pollution prevention',ar:'منع التلوث',
  action:'Review the pollution-control equipment and the vessel records relevant to this inspection. Inspect visible condition and record objective evidence; no automatic MARPOL finding.'},
 manning:{
  en:'Crew and manning',ar:'الطاقم والتأهيل',
  action:'Verify the recorded crew, qualifications and certificates against the documents available onboard. Capture evidence for absent or inconsistent records.'},
 'hull-machinery':{
  en:'Hull and machinery',ar:'الهيكل والآلات',
  action:'Inspect the accessible machinery and hull condition relevant to the approved scope. Record safety observations, limits of access and documentary evidence.'},
 security:{
  en:'Security arrangements',ar:'ترتيبات الأمن',
  action:'Confirm the available ship-security documentation and observable access-control arrangements within the approved scope. Record what was actually inspected.'}
};
export const SI_LEGACY_STEP_CATALOG=Object.freeze(base);
export function normalizeInspectionQuestion(value){
 return text(value).toLowerCase()
  .normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g,'')
  .replace(/[\u0623\u0625\u0622]/g,'ا').replace(/\u0649/g,'ي')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .trim().replace(/\s+/g,' ');
}
const canonicalKey=(title,id)=>normalizeInspectionQuestion(title)||text(id).toLowerCase();
const priority={LEGACY:0,PUBLISHED:1,A04_APPROVED:2};
function stepIdentity(title,id){return 'SI-STEP-'+hash(canonicalKey(title,id));}
function riskGrade(c){return c?.status==='DEFICIENCY'?'DEFICIENCY':
 c?.status==='PASS'?'PASS':c?.status==='NOT_APPLICABLE'?'NA':'PENDING';}
function checkIdForStep(step){
 // Exact category identity only, not a fuzzy "fire safety" guess. Do not
 // conflate distinct statutory questions because they share a category.
 return Object.keys(base).find(x=>
  normalizeInspectionQuestion(base[x].en)===normalizeInspectionQuestion(step.title)||
  normalizeInspectionQuestion(base[x].ar)===normalizeInspectionQuestion(step.title))||null;
}
export function projectGuidedInspection({order,preparation,checklist,lifecycle}={}){
 if(!order?.id||!order?.caseId||!preparation?.context||
   !lifecycle?.record)throw Error('SI_GUIDED_APPROVED_CASE_REQUIRED');
 const record=lifecycle.record,saved=checklist?.saved||null;
 const approved=preparation.saved?.status==='APPROVED'&&!preparation.stale;
 const scopeNames=new Set(list(record.checks)
   .filter(c=>c.mandatory===false&&text(c.title)).map(c=>c.title));
 const additional=list(preparation.saved?.dossier?.suggestedAdditionalItems);
 const suggestions=approved?additional.filter(x=>scopeNames.has(x.title)):[];
 const nonSelected=additional.filter(x=>!approved||!scopeNames.has(x.title));
 const focus=approved?list(preparation.saved?.dossier?.checklistFocus):[];
 const grouped=new Map();
 const make=(title,kind,info={})=>{
  const key=canonicalKey(title,info.id);
  let s=grouped.get(key);
  if(!s){
   s={stepId:stepIdentity(title,info.id),title,category:info.category||title,
    origin:kind,mandatory:kind==='LEGACY',fields:[],
    requiredFields:[],references:[],members:[],systemAction:'',
    aiAdvice:[],currentStatus:'PENDING',savedAnswer:{},
    note:'',naReason:'',severity:null,answered:false,aiSuggestedOnly:false};
   grouped.set(key,s);
  }
  s.mandatory ||=kind==='LEGACY';
  if(priority[kind]<priority[s.origin])s.origin=kind;
  return s;
 };
 // BASE case checks are frozen when the case is initialized. Never remove
 // mandatory records, even if no configurable template was published.
 for(const c of list(record.checks).filter(x=>x.mandatory===true)){
  const info=base[c.id]||{en:c.id,ar:c.id,
   action:'Inspect this mandatory case scope using the available source evidence, record your observations and note any missing proof.'};
  const step=make(info.en,'LEGACY',{id:c.id,category:info.ar});
  step.members.push({kind:'LIFECYCLE',id:c.id,required:true});
  step.fields=unique([...step.fields,'BOOLEAN','NOTE']);
  step.requiredFields=unique([...step.requiredFields,'BOOLEAN']);
  step.systemAction=info.action;
  if(c.status!=='PENDING'){
   step.currentStatus=riskGrade(c);step.answered=true;
   step.savedAnswer.BOOLEAN=c.status==='PASS'?'YES':
    c.status==='NOT_APPLICABLE'?'NA':'NO';
   step.note=c.note||'';step.naReason=c.naReason||'';
   step.severity=c.severity||null;
  }
 }
 // Add EVERY published mandatory instance; group truly identical question
 // text, but preserve ALL underlying pinned IDs for answer fan-out.
 for(const t of list(saved?.templates))
  for(const g of list(t.groups))
   for(const item of list(g.items)){
    const question=text(item.title);
    if(!question)continue;
    const step=make(question,'PUBLISHED',
      {id:item.instanceId,category:g.title||t.title});
    step.members.push({kind:'PUBLISHED',id:item.instanceId,
      templateId:t.templateId,revision:t.revision,
      required:item.mandatory!==false,fields:list(item.fields)});
    step.fields=unique([...step.fields,...list(item.fields)]);
    step.requiredFields=unique([...step.requiredFields,...list(item.requiredFields)]);
    step.mandatory ||=item.mandatory!==false;
    step.references=unique([...step.references,...list(item.sourceReferences)]);
    if(!step.systemAction)
     step.systemAction=text(item.description)||
      'Inspect this checklist question using the specified onboard evidence; record only your own verified observation.';
    if(item.answerStatus==='RECORDED'){
     step.answered=true;step.currentStatus=
      item.answers?.BOOLEAN==='NO'?'DEFICIENCY':
      item.answers?.BOOLEAN==='NA'?'NA':'PASS';
     step.savedAnswer={...step.savedAnswer,...item.answers};
     if(item.answers?.NOTE)step.note=item.answers.NOTE;
    }
   }
 // AI additions are NOT active until BOTH A04 dossier and scope are signed
 // by supervisor. Case records still retain their own independent IDs.
 for(const c of list(record.checks).filter(x=>x.mandatory===false)){
  const advice=suggestions.find(x=>x.title===c.title);
  if(!advice)continue; // no unsigned AI scope may become an executable step.
  const step=make(c.title,'A04_APPROVED',
    {id:c.id,category:'A04 - Supervisor approved'});
  step.members.push({kind:'LIFECYCLE',id:c.id,required:false});
  step.fields=unique([...step.fields,'BOOLEAN','NOTE']);
  step.systemAction ||=text(advice.reason)||
   'Perform this approved additional inspection and record verified observations.';
  step.references=unique([...step.references,...list(advice.evidenceIds)]);
  step.aiAdvice.push({source:'SI-A04',instruction:advice.reason,
   evidenceRefs:list(advice.evidenceIds),approval:'APPROVED_SCOPE_ONLY',
   modelConfidence:preparation.saved?.dossier?.agentConfidence??null});
  if(c.status!=='PENDING'){
   step.currentStatus=riskGrade(c);step.answered=true;
   step.savedAnswer.BOOLEAN=c.status==='PASS'?'YES':
    c.status==='NOT_APPLICABLE'?'NA':'NO';
   step.note=c.note||'';step.naReason=c.naReason||'';
   step.severity=c.severity||null;
  }
 }
 // A04 focus can support an EXISTING check; do not create another question.
 for(const step of grouped.values()){
  const baseId=step.members.find(x=>x.kind==='LIFECYCLE'&&base[x.id])?.id||
   checkIdForStep(step);
  for(const f of focus.filter(x=>x.existingItemId===baseId))
   step.aiAdvice.push({source:'SI-A04',instruction:f.reason,
    focus:f.focus,evidenceRefs:list(f.reasonEvidenceIds),
    approval:'APPROVED_SCOPE_ONLY',
    modelConfidence:preparation.saved?.dossier?.agentConfidence??null});
  step.members=step.members.filter((m,i,a)=>a.findIndex(n=>
    n.kind===m.kind&&n.id===m.id)===i);
 }
 // A merged question is complete ONLY when all of its authoritative
 // underlying records are complete. A prior answer to one duplicate cannot
 // conceal another still-pending published or legal case check.
 const lifeState=new Map(list(record.checks).map(x=>[x.id,x]));
 const publishedState=new Map(list(saved?.templates).flatMap(t=>
  list(t.groups).flatMap(g=>list(g.items).map(it=>[it.instanceId,it]))));
 for(const step of grouped.values()){
  const sourceComplete=step.members.filter(m=>m.required!==false).every(m=>{
   if(m.kind==='LIFECYCLE')
    return lifeState.get(m.id)?.status!=='PENDING'&&
     Boolean(lifeState.get(m.id)?.status);
   return publishedState.get(m.id)?.answerStatus==='RECORDED';
  });
  step.answered=sourceComplete;
  if(!sourceComplete)step.currentStatus='PENDING';
 }
 const steps=[...grouped.values()];
 const done=steps.filter(x=>x.answered).length;
 return {
  status:'GUIDED_INSPECTION_READ_ONLY',
  caseId:order.caseId,orderId:order.id,planId:order.planId,
  imo:order.imo,vesselName:preparation.context.vessel?.name||'IMO '+order.imo,
  orderStatus:order.status,lifecycleStage:record.stage,
  publishedTemplateCount:list(saved?.templates).length,
  publishedSnapshotVersion:saved?.version||null,
  lifecycleVersion:record.version,
  preparationStatus:preparation.saved?.status||'NOT_PREPARED',
  aiApproved:approved,aiDraftNotApproved:Boolean(preparation.saved?.dossier&&!approved),
  pendingAiSuggestions:nonSelected.map(x=>({
   title:x.title,reason:x.reason,notExecutable:true})),
  numberOfMergedDuplicateQuestions:steps.reduce((n,x)=>n+Math.max(0,x.members.length-1),0),
  progress:{done,total:steps.length,remaining:steps.length-done},
  steps,
  regulatoryOutcome:'NOT_APPROVED_INSPECTOR_INPUT_REQUIRED',
  sourceFilesUnchanged:true,readOnly:true
 };
}
export function findGuidedStep(guide,stepId){
 return guide.steps.find(x=>x.stepId===stepId)||null;
}
export function buildA04FocusedFieldRequest({preparation,step,language='en'}={}){
 if(!preparation?.context||!step?.stepId)throw Error('SI_FIELD_AI_CONTEXT_REQUIRED');
 const c=preparation.context;
 const now=new Date().toISOString();
 return {requestMeta:{correlationId:'SI-STEP-'+hash(step.stepId+'|'+now),
   schemaVersion:'2.0',language,requestedAt:now},
  inspectionId:c.inspectionId,caseId:c.caseId,
  subject:{type:'VESSEL',imo:c.imo,name:c.vessel?.name},
  bundleRef:c.bundleRef,targetRegime:c.targetRegime,
  officialRisk:c.risk?{evaluationId:c.risk.evaluationId,
    score:c.risk.score,level:c.risk.level,
    rulesetVersion:c.risk.rulesetVersion}:null,
  baseChecklistItemIds:c.baseChecklistItemIds||SI_BASE_CHECKLIST,
  openFindingRefs:c.openFindingRefs||[],
  evidenceManifestRefs:c.evidenceManifestRefs||[],
  checklistVersion:'SI-POC-BASE-1.0',
  inlineContext:{...c.evidenceContext,
   allInspectionReasons:c.inspectionReasons,
   sourceInspectionObjectives:c.sourceInspectionObjectives,
   focusedFieldStep:{title:step.title,stepId:step.stepId,
     category:step.category,required:step.mandatory,
     evidenceRefs:step.references,
     instruction:'Propose EXACT inspector field actions to check, what source documents to compare, what observations/photos to capture, and which source gaps to flag. Never predict compliance, do not answer the checklist, do not invent documents or findings. Express practical actions in checklistFocus[].reason for the nearest base checklist category; cite permitted evidence IDs.'}},
  inspectionRegimes:c.targetRegimes,provenance:c.provenance,
  officialScoringRequested:false,
  requestedOutputs:['FOCUS_OVERLAY','MISSING_EVIDENCE'],
  fieldGuidanceAdvisoryOnly:true};
}
export function projectA04FocusedFieldAdvice(validated,step){
 const options=list(validated.checklistFocus).filter(x=>text(x.reason));
 const matching=options.filter(x=>
  x.existingItemId===step.members.find(m=>m.kind==='LIFECYCLE'&&base[m.id])?.id||
  x.existingItemId===checkIdForStep(step));
 const details=matching.length?matching:options;
 return {status:'AIRIA_A04_FIELD_GUIDANCE_ADVISORY',
  stepId:step.stepId,
  stepSpecific:matching.length>0,
  warnings:matching.length?[]:['AI_RETURNED_GENERAL_SCOPE_FOCUS_ONLY'],
  actions:details.map(x=>({
    instruction:x.reason,
    focus:x.focus,
    evidenceRefs:list(x.reasonEvidenceIds),
    approvedObservation:false
  })),
  focusAreas:list(validated.focusAreas).map(x=>({
   title:x.category,priority:x.priority,instruction:x.reason,
   evidenceRefs:list(x.evidenceIds)})),
  missingEvidence:list(validated.missingEvidence),
  confidence:validated.agentConfidence,
  inspectorMustVerify:true,findingsCreated:0,answersSaved:0
 };
}
