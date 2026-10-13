/**
 * Additive/idempotent MOEI Smart Inspection baseline mandatory checklist seeder.
 * Five TECHNICAL POC templates. Mandatory flags DO NOT certify statutory approval.
 * --plan is read-only; --apply creates draft templates; explicit --publish requires
 * regulatory review attestation (the library still reports Verified:false).
 * Works against existing JSON or Oracle storage and never touches case responses.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SiChecklistLibrary} from '../si-checklist-library.mjs';
import {OracleSiChecklistLibrary} from '../si-checklist-oracle.mjs';
const revision='SI-POC-CHECKLIST-BASELINE-20261013';
const item=(id,title,description)=>({
 id,title,description,mandatory:true,fields:['BOOLEAN','NOTE'],
 requiredFields:['BOOLEAN'],options:[],ai:{enabled:false},order:0,
 sourceReferences:['MOEI POC baseline: internal review required before regulatory use']
});
const group=(id,title,items,order)=>({
 id,title,order,items:items.map((x,i)=>({...x,order:i})),
 ai:{enabled:false,instructions:''}
});
export const mandatoryTemplates=[
 {
  title:'POC Mandatory | Core Vessel Identification and Safety',
  description:revision+' | applies to all inspection regimes; NOT a certified statutory checklist',
  mandatory:true,applicability:{},groups:[
   group('IDENTIFICATION','Vessel identity and recorded particulars',[
    item('IMO_VERIFIED','Verify IMO, name, flag and inspection scope','Compare submitted vessel identity with the approved referral and available source evidence.'),
    item('VESSEL_DOCUMENTS','Review available registration and relevant certificates','Record document identifiers, expiry and unknown/unverified source values.'),
    item('CERTIFICATE_STATUS','Check certificate validity / exceptions','Capture expired, conditional or missing certificates; do not assume certificates are authentic.')
   ],0),
   group('SAFETY','Core onboard safety and emergency preparedness',[
    item('FIRE_PREVENTION','Inspect accessible fire-fighting and fire prevention evidence','Document observed condition and any defects; use applicable safety requirements.'),
    item('LIFE_SAVING','Inspect lifesaving equipment readiness','Check evidence and observed accessibility; not a substitute for legal survey.'),
    item('CREW_EMERGENCY','Review crew emergency preparedness evidence','Document muster, relevant training records and deviations only if inspected.')
   ],1)
  ]
 },
 {
  title:'POC Mandatory | PSC Port State Control Screening',
  description:revision+' | applies to quota-selected PSC port calls only',
  mandatory:true,applicability:{inspectionRegimes:['PORT_STATE_CONTROL']},groups:[
   group('PSC_DOCS','PSC document and ship condition review',[
    item('PSC_CERTS','Review applicable statutory certificates','Only record documents actually provided or inspected; note evidence limitations.'),
    item('PSC_HULL','Review hull, machinery and safety observations','Record the actual condition and any inspection restrictions.'),
    item('PSC_CREW','Review applicable crew credentials and hours of rest','Document confirmed records and deficiencies; no automated compliance decision.')
   ],0),
   group('PSC_ENV','Pollution prevention and follow-up',[
    item('PSC_POLLUTION','Review pollution prevention records and equipment','Record available evidence, controls and any observed gaps.'),
    item('PSC_DEFICIENCIES','Record deficiencies and human-reviewed actions','Assign evidence references for each confirmed finding; no AI closure.')
   ],1)
  ]
 },
 {
  title:'POC Mandatory | UAE Maritime Service Inspection',
  description:revision+' | applies to actionable maritime service requests only',
  mandatory:true,applicability:{inspectionRegimes:['UAE_SERVICE_INSPECTION']},groups:[
   group('SERVICE_SCOPE','Service application and inspection scope',[
    item('SERVICE_REQUEST','Verify authorized maritime service request and vessel ownership data','Confirm scope and source status before starting inspection.'),
    item('SERVICE_DOCUMENTS','Verify submitted service documentation','Record document type, issuer and completeness; missing documentation is a gap, not a guessed result.'),
    item('SERVICE_ACTIVITY','Inspect activity-related conditions in approved scope','Review equipment, vessel particulars and service-specific requirements where applicable.')
   ],0)
  ]
 },
 {
  title:'POC Mandatory | NMC Focused Incident Inspection',
  description:revision+' | applies only to a human-approved NMC focused referral',
  mandatory:true,applicability:{inspectionRegimes:['FOCUSED_INSPECTION'],sourceTypes:['NMC_CASE']},groups:[
   group('NMC_REFERRAL','Verified NMC referral and evidence',[
    item('INCIDENT_LINK','Confirm active incident and approved referral identity','Cite NMC case and original report, not general vessel risk scores.'),
    item('INCIDENT_OBSERVATIONS','Record inspector-confirmed incident-related observations','Link on-site facts and timestamps to evidence.'),
    item('INCIDENT_CORRECTIVE','Recommend actions for authorized officer review','Draft actions only; approval and enforcement remain human-controlled.')
   ],0)
  ]
 },
 {
  title:'POC Mandatory | Follow-up and Corrective Actions',
  description:revision+' | applies to approved follow-up inspections',
  mandatory:true,applicability:{inspectionRegimes:['FOLLOW_UP_INSPECTION']},groups:[
   group('FOLLOWUP','Verified closure of previous deficiencies',[
    item('PRIOR_FINDINGS','Cross-reference prior confirmed deficiencies','Reference original finding IDs and approved CAPA only.'),
    item('CORRECTIVE_EVIDENCE','Verify actual corrective evidence','Attach inspector-verified photos, records or testing evidence.'),
    item('FOLLOWUP_DECISION','Record inspector conclusion and unresolved items','Closure is subject to authorized review and approval.')
   ],0)
  ]
 }
];
const config=argv=>{
 const x={mode:process.env.SI_CHECKLIST_STORAGE||
    process.env.NMC_DB_MODE||'json',apply:false,publish:false,ack:false,review:false,
   actor:'MOEI_POC_SEED'};
 for(const a of argv){
  if(a==='--plan')x.apply=false;
  else if(a==='--apply')x.apply=true;
  else if(a==='--publish')x.publish=true;
  else if(a==='--ack=SEED_MANDATORY_CHECKLISTS')x.ack=true;
  else if(a==='--review-confirmed=YES')x.review=true;
  else if(a==='--mode=json'||a==='--mode=oracle')x.mode=a.slice(7);
  else if(a.startsWith('--actor='))x.actor=a.slice(8);
  else throw Error('SI_CHECKLIST_SEED_UNKNOWN_FLAG');
 }
 if(!['oracle','json'].includes(x.mode))throw Error('SI_CHECKLIST_SEED_MODE_INVALID');
 if(x.apply&&!x.ack)throw Error('SI_CHECKLIST_SEED_EXPLICIT_ACK_REQUIRED');
 if(x.publish&&(!x.apply||!x.review))
  throw Error('SI_CHECKLIST_SEED_PUBLICATION_REQUIRES_REVIEW');
 return x;
};
export async function seedChecklists(argv=process.argv.slice(2),libraryOverride=null){
 const flags=config(argv);
 let pool=null,library=libraryOverride;
 if(!library){
  if(flags.mode==='json')library=new SiChecklistLibrary();
  else{
   const oracledb=(await import('oracledb')).default;
   if(!process.env.NMC_DB_USER||!process.env.NMC_DB_PASSWORD||
     !process.env.NMC_DB_CONNECT_STRING)
    throw Error('SI_CHECKLIST_ORACLE_ENV_MISSING');
   pool=await oracledb.createPool({
    user:process.env.NMC_DB_USER,password:process.env.NMC_DB_PASSWORD,
    connectString:process.env.NMC_DB_CONNECT_STRING,poolMin:1,poolMax:2});
   library=new OracleSiChecklistLibrary({oracle:{pool}});
  }
 }
 try{
  if(library.initialize)await library.initialize();
  const existing=await library.list();
  const plan=[];
  for(const spec of mandatoryTemplates){
   const dup=existing.filter(x=>x.title===spec.title);
   if(dup.length>1)throw Error('SI_CHECKLIST_SEED_DUPLICATE_TITLE');
   const previous=dup[0];
   if(previous&&(previous.mandatory!==true||previous.groupCount!==spec.groups.length||
     previous.itemCount!==spec.groups.reduce((n,g)=>n+g.items.length,0)))
    throw Error('SI_CHECKLIST_SEED_EXISTING_CONTENT_CONFLICT');
   plan.push({title:spec.title,mandatory:true,groups:spec.groups.length,
    items:spec.groups.reduce((n,g)=>n+g.items.length,0),
    action:previous?'EXISTS':'CREATE_DRAFT',id:previous?.id||null,
    published:previous?.published||false});
  }
  const result={status:flags.apply?'APPLIED':'PLAN_ONLY',mode:flags.mode,
    reference:revision,statutoryApprovalVerified:false,
    created:0,published:0,items:plan};
  if(!flags.apply){process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;}
  for(let i=0;i<mandatoryTemplates.length;i++){
   const spec=mandatoryTemplates[i],entry=plan[i];
   let template;
   if(entry.action==='CREATE_DRAFT'){
    template=await library.create(spec,flags.actor);
    entry.id=template.id;entry.action='CREATED_DRAFT';result.created++;
   }else template=await library.get(entry.id);
   if(flags.publish&&!entry.published){
    // No regulatory endorsement is fabricated: published snapshot has
    // regulatoryApprovalVerified:false even after officer review.
    const createdAt=template.updatedAt;
    await library.publish(template.id,flags.actor,createdAt);
    entry.action=entry.action==='CREATED_DRAFT'?'CREATED_AND_PUBLISHED_POC':'PUBLISHED_POC';
    entry.published=true;result.published++;
   }
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
 }finally{if(pool)await pool.close(0);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 seedChecklists().catch(e=>{
  console.error('SI_CHECKLIST_SEED_FAILED: '+String(e.message||'UNKNOWN').replace(/[^A-Z0-9_ -]/gi,''));
  process.exitCode=1;
 });
