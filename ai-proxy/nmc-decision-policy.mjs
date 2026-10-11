/**
 * Maritime decision/action catalogue for the NMC DEMONSTRATION only.
 * Source: a saved Airia A01 proposed action. The platform selects/matches
 * exactly ONE route; this is NOT an AI-issued legal/regulatory order.
 *
 * IMO PSC Procedures 2025 (A.1206(34)) require properly authorized,
 * evidence-based decisions. This fixture is not a UAE authority matrix.
 * No calls to vessel, port, or restriction master systems are made here.
 */
export const DECISION_POLICY_VERSION='NMC-POC-DECISIONS-1.0';

const step=(id,titleEn,titleAr,role,kind='MANUAL_VERIFICATION')=>
  ({id,titleEn,titleAr,role,kind,mandatory:true});

export const DECISION_CATALOGUE=Object.freeze({
  VERIFY_DEFICIENCY_CLOSURE:{
    titleEn:'Verify closure of critical maritime deficiency',titleAr:'التحقق من إغلاق الملاحظة البحرية الحرجة',
    steps:[
      step('review-finding','Review MOEI inspection finding and its source','مراجعة الملاحظة وسجلها المعتمد','COMPLIANCE_OFFICER'),
      step('obtain-closure','Request documented closure or rectification evidence','طلب أدلة الإصلاح وإغلاق الملاحظة','COMPLIANCE_OFFICER'),
      step('validate-closure','Validate evidence and document the discrepancy outcome','التحقق من الأدلة وتوثيق نتيجة التعارض','COMPLIANCE_OFFICER')
    ]
  },
  VERIFY_CERTIFICATE:{
    titleEn:'Verify maritime certificate validity',titleAr:'التحقق من صلاحية الشهادات البحرية',
    steps:[
      step('request-certificate','Collect authoritative certificate records','جمع الشهادات من المصادر المعتمدة','COMPLIANCE_OFFICER'),
      step('verify-certificate','Reconcile validity and discrepancies','التحقق من الصلاحية وحسم التعارض','COMPLIANCE_OFFICER')
    ]
  },
  REVIEW_DEFICIENCY:{
    titleEn:'Review unresolved inspection deficiencies',titleAr:'مراجعة ملاحظات المعاينة غير المغلقة',
    steps:[step('review-open-findings','Review open findings and rectification requirements','مراجعة الملاحظات المفتوحة ومتطلبات الإصلاح','COMPLIANCE_OFFICER')]
  },
  ENHANCED_MONITORING:{
    titleEn:'Apply enhanced vessel monitoring',titleAr:'تعزيز مراقبة السفينة',
    steps:[step('activate-watch','Assign monitoring responsibility and watch criteria','تعيين مسؤول المراقبة ومعايير المتابعة','NMC_OFFICER'),
      step('review-watch','Review new movement and compliance information','مراجعة معلومات الحركة والامتثال المستجدة','NMC_OFFICER')]
  },
  REQUEST_EXTERNAL_VERIFICATION:{
    titleEn:'Request competent-authority verification',titleAr:'طلب تحقق من الجهة البحرية المختصة',
    steps:[step('refer-authority','Send an evidence-based verification request','إحالة طلب تحقق موثق للجهة المختصة','COMPLIANCE_OFFICER'),
      step('record-authority','Record and review the authoritative reply','توثيق ومراجعة رد الجهة المختصة','COMPLIANCE_OFFICER')]
  },
  REFER_SMART_INSPECTION:{
    titleEn:'Refer vessel to Smart Inspection',titleAr:'إحالة السفينة لدورة المعاينة الذكية',
    steps:[step('smart-inspection','Open an NMC referral to the Smart Inspection lifecycle','فتح إحالة لدورة المعاينة الذكية','INSPECTION_OFFICER','SMART_INSPECTION')]
  },
  UNMAPPED_TO_INSPECTION:{
    titleEn:'Unmapped recommendation — refer for maritime inspection review',
    titleAr:'قرار غير معرّف — إحالة لمراجعة المعاينة البحرية',
    steps:[step('smart-inspection','Inspect an unmapped concern after human review','معاينة الحالة غير المصنفة بعد مراجعة الموظف','INSPECTION_OFFICER','SMART_INSPECTION')]
  },
  PORT_ENTRY_RESTRICTION:{
    titleEn:'Propose restriction on entry into UAE ports',titleAr:'اقتراح منع دخول السفينة إلى الموانئ الإماراتية',
    regulated:true,restrictionType:'PORT_ENTRY_RESTRICTION',
    steps:[step('legal-review','Review national legal basis, jurisdiction and verified evidence','مراجعة السند القانوني والاختصاص والأدلة','REGULATORY_AUTHORITY','LEGAL_REVIEW'),
      step('restriction-order','Obtain written authorization from competent maritime authority','استصدار اعتماد كتابي من السلطة البحرية المختصة','REGULATORY_AUTHORITY','AUTHORITY_APPROVAL')]
  },
  DETAIN_PENDING_RECTIFICATION:{
    titleEn:'Propose detention / prevent departure pending verified rectification',
    titleAr:'اقتراح احتجاز السفينة ومنع مغادرتها لحين التحقق من الإصلاحات',
    regulated:true,restrictionType:'DETENTION',
    steps:[step('psc-inspection-review','Review verified PSC inspection findings and detention grounds','مراجعة نتائج معاينة PSC وأسباب الاحتجاز المثبتة','PSC_AUTHORIZED_OFFICER','LEGAL_REVIEW'),
      step('detention-order','Obtain documented authorized detention decision','استصدار قرار احتجاز موثق من الجهة المختصة','REGULATORY_AUTHORITY','AUTHORITY_APPROVAL'),
      step('rectification-check','Verify corrections before considering release','التحقق من الإصلاحات قبل النظر في الإفراج','PSC_AUTHORIZED_OFFICER','MANUAL_VERIFICATION')]
  },
  NO_ACTION:{
    titleEn:'No further intervention after documented review',titleAr:'لا يلزم إجراء إضافي بعد المراجعة الموثقة',
    steps:[]
  }
});

const mapA01=Object.freeze({
  VERIFY_DEFICIENCY_CLOSURE:'VERIFY_DEFICIENCY_CLOSURE',
  VERIFY_CERTIFICATE:'VERIFY_CERTIFICATE',
  REVIEW_DEFICIENCY:'REVIEW_DEFICIENCY',
  ENHANCED_MONITORING:'ENHANCED_MONITORING',
  REQUEST_EXTERNAL_VERIFICATION:'REQUEST_EXTERNAL_VERIFICATION',
  PRIORITY_INSPECTION:'REFER_SMART_INSPECTION',
  NO_ACTION:'NO_ACTION'
});
const weight=Object.freeze({
  VERIFY_DEFICIENCY_CLOSURE:90,PRIORITY_INSPECTION:80,
  VERIFY_CERTIFICATE:70,REVIEW_DEFICIENCY:60,
  REQUEST_EXTERNAL_VERIFICATION:50,ENHANCED_MONITORING:35,
  UNMAPPED_AI_ACTION:10,NO_ACTION:0
});
export function catalogueSummaries(){
  return Object.entries(DECISION_CATALOGUE).map(([code,item])=>({
    code,titleEn:item.titleEn,titleAr:item.titleAr,
    regulated:!!item.regulated,steps:item.steps
  }));
}
export function buildSingleProposal(plan){
  if(!Array.isArray(plan?.proposedActions)||!plan.proposedActions.length)return null;
  const candidates=plan.proposedActions.filter(a=>a.decision==='PENDING');
  const priority=[...candidates].sort((a,b)=>
    (weight[b.actionType]??-1)-(weight[a.actionType]??-1)||
    (Number(b.confidence)||0)-(Number(a.confidence)||0));
  const original=priority[0];
  if(!original)return null;
  const code=mapA01[original.actionType]||'UNMAPPED_TO_INSPECTION';
  const def=DECISION_CATALOGUE[code];
  return {
    code,titleEn:def.titleEn,titleAr:def.titleAr,
    originalA01Proposal:{
      actionId:original.actionId,actionType:original.actionType,
      ...(original.originalActionType?{originalActionType:original.originalActionType}:{}),
      title:original.title,reason:original.reason,priority:original.priority,
      confidence:original.confidence,evidenceIds:[...original.evidenceIds]
    },
    selectedFromActionId:original.actionId,
    rationale:original.reason,
    evidenceIds:[...original.evidenceIds],
    confidence:original.confidence,
    workflowSteps:def.steps,regulated:!!def.regulated,
    decisionStatus:'PENDING_HUMAN_REVIEW',
    selectionSource:'NMC_POLICY_MAPPED_FROM_AIRIA_A01',
    policyVersion:DECISION_POLICY_VERSION,
    regulatoryEffect:'NONE_POC_ONLY'
  };
}
export function decisionDefinition(code){return DECISION_CATALOGUE[code]||null;}
export function decisionActionPlan(code){const row=decisionDefinition(code);return row?row.steps.map(s=>({...s})):null;}
export const isRegulatedDecision=code=>!!decisionDefinition(code)?.regulated;
