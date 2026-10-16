/**
 * Eight read-only SDB customer journey fixtures. These are explicit POC
 * simulations, NOT ministry data and NOT new persisted candidate records.
 * Every score is recalculated by the same authoritative sandbox rules used
 * by real SDB application guards. No model invocation is claimed.
 */
import {demoState,evaluateReadiness,SDB_POLICY} from './seafarer-workspace.mjs';
import {computedSdbReadiness,initialSdbSettings} from './seafarer-readiness-settings.mjs';

const DEFINITIONS=Object.freeze([
 {id:'CADET_MISSING_CERTIFICATES',base:0,kind:'FIRST_ISSUE',category:'ACADEMY',
  title:'First-time cadet · incomplete CoPs',titleAr:'متدرب إصدار أول · شهادات السلامة غير مكتملة',
  situation:'Required basic safety certificates are missing.',
  situationAr:'لم يستكمل شهادات السلامة الأساسية المطلوبة.'},
 {id:'CADET_MISSING_MEDICAL',base:1,kind:'FIRST_ISSUE',category:'MARASI',
  title:'First-time cadet · medical not completed',titleAr:'متدرب إصدار أول · لم يجرِ الكشف الطبي',
  situation:'All CoPs received, but no medical fitness certificate.',
  situationAr:'أكمل الشهادات ولم يجرِ الكشف الطبي.'},
 {id:'CADET_ACADEMY_HOLD',base:1,kind:'FIRST_ISSUE',category:'ACADEMY',
  title:'First-time cadet · academy hold',titleAr:'متدرب إصدار أول · إيقاف من الأكاديمية',
  situation:'Certificates and medical are complete; academy has placed a hold.',
  situationAr:'الشهادات والكشف الطبي مكتملان مع وجود إيقاف من الأكاديمية.'},
 {id:'CADET_READY',base:1,kind:'FIRST_ISSUE',category:'READY',
  title:'First-time cadet · ready to apply',titleAr:'متدرب إصدار أول · جاهز للتقديم',
  situation:'All first-issue requirements verified.',
  situationAr:'مستوفٍ لجميع متطلبات الإصدار الأول.'},
 {id:'RENEWAL_ACADEMY_HOLD',base:2,kind:'RENEWAL',category:'ACADEMY',
  title:'SDB renewal · academy hold',titleAr:'تجديد سجل بحار · إيقاف من الأكاديمية',
  situation:'Existing SDB detected; academy clearance is on hold.',
  situationAr:'لديه سجل بحار قائم لكن الأكاديمية وضعت إيقافًا.'},
 {id:'RENEWAL_COMPANY_HOLD',base:3,kind:'RENEWAL',category:'COMPANY',
  title:'SDB renewal · employer hold',titleAr:'تجديد سجل بحار · إيقاف من الشركة',
  situation:'Existing SDB detected; employer no-objection is withheld.',
  situationAr:'لديه سجل بحار قائم لكن الشركة المشغلة لم تصدر عدم الممانعة.'},
 {id:'RENEWAL_MEDICAL_ISSUE',base:4,kind:'RENEWAL',category:'MARASI',
  title:'SDB renewal · medical issue',titleAr:'تجديد سجل بحار · مشكلة بالكشف الطبي',
  situation:'Existing SDB detected; medical fitness is not valid.',
  situationAr:'لديه سجل بحار قائم لكن الكشف الطبي غير صالح للتجديد.'},
 {id:'RENEWAL_READY',base:2,kind:'RENEWAL',category:'READY',
  title:'SDB renewal · ready to apply',titleAr:'تجديد سجل بحار · جاهز للتقديم',
  situation:'Existing SDB recognised; renewal requirements verified.',
  situationAr:'تم التعرف على سجل البحار القائم واستيفاء متطلبات التجديد.'}
]);

/**
 * Read-only synthetic candidates; preparing fixtures never writes application
 * records, changes companies/academies or bypasses verified applicant binding.
 */
export function sdbServiceScenarios(now=Date.now(),policy=SDB_POLICY,
 settings=initialSdbSettings(policy)){
 const baseline=demoState(now).profiles;
 return DEFINITIONS.map(def=>{
  const p=structuredClone(baseline[def.base]);
  if(def.id==='CADET_MISSING_MEDICAL')p.medical=null;
  if(def.id==='CADET_ACADEMY_HOLD')p.clearances.ACADEMY={
   status:'HOLD',reason:'Academy clearance withheld pending training close-out.',
   reference:'DEMO-AC-HOLD-01',updatedAt:new Date(now).toISOString()
  };
  if(def.id==='RENEWAL_ACADEMY_HOLD'){
   p.academyRequired=true;
   p.clearances.ACADEMY={
    status:'HOLD',reason:'Academy revalidation is pending.',
    reference:'DEMO-AC-RENEW-01',updatedAt:new Date(now).toISOString()
   };
  }
  const readiness=computedSdbReadiness(p,now,policy,settings);
  const expected=def.kind==='RENEWAL'?'RENEWAL':'FIRST_ISSUE';
  if(readiness.service!==expected)
   throw new Error('SDB_DEMO_SCENARIO_SERVICE_MISMATCH');
  const ready=readiness.status==='READY';
  return {
   id:def.id,title:def.title,titleAr:def.titleAr,
   situation:def.situation,situationAr:def.situationAr,
   category:def.category,profileId:p.id,
   person:{name:p.name,rank:p.rank,nationality:p.nationality},
   existingSdb:p.existingSdb?{
    sid:p.existingSdb.sid,number:p.existingSdb.number,
    expiryDate:p.existingSdb.expiryDate
   }:null,
   readiness:{
    ...readiness,
    checks:readiness.checks.map(c=>({...c})),
    blockers:readiness.blockers.map(c=>({...c}))
   },
   canContinue:ready,
   // The advisor here is an explainable rules-based POC, NOT a live AI model.
   advisor:{mode:'EXPLAINABLE_RULES_POC',modelInvoked:false,
    classifiedService:readiness.service,score:readiness.percent,
    sourceBacked:true,
    evidence:readiness.checks.map(c=>({
     key:c.key,source:c.source,status:c.result,reason:c.reason,
     reference:c.reference,expiryDate:c.expiryDate
    })),
    nextActions:readiness.blockers.map(c=>({
     key:c.key,owner:c.source,action:c.reason
    })),
    requiresHumanClearance:readiness.checks.some(c=>c.result==='HOLD')
   }
  };
 });
}
