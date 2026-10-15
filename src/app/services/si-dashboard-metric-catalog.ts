/**
 * Smart Inspection Dashboard Manager variable catalogue (POC only).
 *
 * These are intentionally separate from verified C01/ERP/MSW/Oracle sources.
 * Synthetic monthly histories MUST NOT be represented as real AI usage,
 * actual capacity, financial savings or ministry operational performance.
 * Replacing with trusted measures will require authoritative event aggregation.
 */
export type SiMetricGroup='AI_PERFORMANCE'|'INSPECTION_OPERATIONS';
export type SiMetricKind='kpi'|'bar'|'table';
export interface SiDashboardMetricDefinition {
 id:string;kind:SiMetricKind;group:SiMetricGroup;
 en:string;ar:string;descriptionEn:string;descriptionAr:string;
 unit:'count'|'percent'|'minutes'|'hours'|'seconds'|'records';
 source:'STATIC_POC_SYNTHETIC';
}
const k=(id:string,group:SiMetricGroup,en:string,ar:string,
 descriptionEn:string,descriptionAr:string,unit:SiDashboardMetricDefinition['unit']='count'):
 SiDashboardMetricDefinition=>({id,group,en,ar,descriptionEn,descriptionAr,
 kind:'kpi',unit,source:'STATIC_POC_SYNTHETIC'});
const c=(id:string,group:SiMetricGroup,en:string,ar:string,
 descriptionEn:string,descriptionAr:string):
 SiDashboardMetricDefinition=>({id,group,en,ar,descriptionEn,descriptionAr,
 kind:'bar',unit:'count',source:'STATIC_POC_SYNTHETIC'});
const t=(id:string,group:SiMetricGroup,en:string,ar:string,
 descriptionEn:string,descriptionAr:string):
 SiDashboardMetricDefinition=>({id,group,en,ar,descriptionEn,descriptionAr,
 kind:'table',unit:'records',source:'STATIC_POC_SYNTHETIC'});

export const SI_DASHBOARD_METRIC_DEFINITIONS:ReadonlyArray<SiDashboardMetricDefinition>=[
 // AI KPIs: count distinct IMOs separately from inspection-regime workflows.
 k('siAiAnalyzedVessels','AI_PERFORMANCE','AI-analyzed vessels','السفن التي حللها AI',
   'Distinct vessel IMOs processed in simulated C01','سفن IMO مختلفة تم تحليلها تجريبيًا'),
 k('siAiAnalyzedWorkflows','AI_PERFORMANCE','AI-analyzed workflows','مسارات الترشيح المحللة',
   'C01 inspection-regime/source workflows; can exceed vessel count','مسارات أسباب المعاينة؛ قد تزيد عن عدد السفن'),
 k('siAiRunCount','AI_PERFORMANCE','C01 analyses','عمليات تحليل C01',
   'Count of simulated completed selection analyses','عدد عمليات التحليل التجريبية المكتملة'),
 k('siAiEvidenceRate','AI_PERFORMANCE','Evidence validation rate','نسبة التحقق من الأدلة',
   'Validated workflow advice / analyzed workflows; simulated','نسبة النتائج المتحققة إلى مسارات الترشيح تجريبيًا','percent'),
 k('siAiCoverageRate','AI_PERFORMANCE','C01 workflow coverage','تغطية AI لمسارات الترشيح',
   'Analyzed workflows / total source-eligible workflows','مسارات الترشيح المحللة / إجمالي المسارات المؤهلة','percent'),
 k('siAiRecommended','AI_PERFORMANCE','AI selected recommendations','السفن التي رشحها AI',
   'Unique selected IMOs, before source quotas and inspector capacity','سفن مرشحة من AI قبل حدود الطاقة'),
 k('siAiAcceptanceRate','AI_PERFORMANCE','Officer acceptance rate','نسبة قبول توصيات AI',
   'Officer-accepted AI recommendations / AI recommendations; simulated','التوصيات المقبولة بشريًا إلى التوصيات الصادرة','percent'),
 k('siAiManualReviews','AI_PERFORMANCE','Manual review recommendations','توصيات المراجعة البشرية',
   'AI recommendations awaiting officer evidence review','توصيات تحتاج تحقق الموظف'),
 k('siAiOverrides','AI_PERFORMANCE','Officer overrides','تعديلات الموظفين على AI',
   'Recorded example of human departures from AI advice','مثال تجريبي لتعديلات القرار البشري'),
 k('siAiProcessingSeconds','AI_PERFORMANCE','Average C01 analysis time','متوسط مدة تحليل C01',
   'Simulated average end-to-end processing seconds','متوسط زمن التحليل بالثواني تجريبيًا','seconds'),
 k('siAiPlanningMinutesSaved','AI_PERFORMANCE','Estimated planning minutes saved','دقائق التخطيط الموفرة (افتراضي)',
   'Illustrative baseline minus AI-assisted planning minutes; NOT measured ROI','فرق افتراضي بين خط الأساس والتخطيط المدعوم؛ ليس وفرًا مثبتًا','minutes'),
 // Inspection operations KPIs:
 k('siOpsCandidateVessels','INSPECTION_OPERATIONS','Eligible candidate vessels','السفن المرشحة المؤهلة',
   'Unique IMO candidate pool for demonstration','حجم قائمة السفن التجريبية بدون تكرار'),
 k('siOpsAiShortlisted','INSPECTION_OPERATIONS','AI shortlisted vessels','السفن المختارة للجدولة',
   'C01 shortlist before engineer availability checks','السفن المختارة قبل فحص المهندسين'),
 k('siOpsCapacityFeasible','INSPECTION_OPERATIONS','Capacity-feasible visits','المعاينات الممكن تنفيذها',
   'Visits with qualified inspector and valid berth–ETD window','زيارات لها مهندس مؤهل وموعد صالح'),
 k('siOpsCapacityOverflow','INSPECTION_OPERATIONS','Outside plan (capacity)','خارج الخطة بسبب الطاقة',
   'Optional selected vessels without feasible inspector slots','مرشحون اختارهم AI ولم تتوفر لهم طاقة'),
 k('siOpsCapacityMatchRate','INSPECTION_OPERATIONS','Inspector match rate','نسبة مواءمة الطاقة',
   'Feasible assigned visits / shortlisted vessels','المعاينات الممكنة / السفن المختارة','percent'),
 k('siOpsEngineerUtilization','INSPECTION_OPERATIONS','Inspector utilization','معدل استغلال المهندسين',
   'Simulated allocated inspector hours / available hours','ساعات المهندسين المستخدمة / المتاحة تجريبيًا','percent'),
 k('siOpsScheduled','INSPECTION_OPERATIONS','Scheduled inspections','المعاينات المجدولة',
   'Simulated scheduled inspection work orders','أوامر معاينة مجدولة تجريبيًا'),
 k('siOpsCompleted','INSPECTION_OPERATIONS','Completed inspections','المعاينات المكتملة',
   'Simulated completed inspections, not official closures','المعاينات المكتملة تجريبيًا وليست إغلاقات رسمية'),
 k('siOpsOnTimeRate','INSPECTION_OPERATIONS','On-time inspection rate','نسبة المعاينات في موعدها',
   'Simulated inspections completed within scheduled slot','نسبة الالتزام بالمواعيد في بيانات تجريبية','percent'),
 k('siOpsOpenFindings','INSPECTION_OPERATIONS','Open inspection findings','الملاحظات المفتوحة',
   'Simulated confirmed-looking entries for dashboard testing ONLY','ملاحظات افتراضية لا تمثل ضبطًا رسميًا'),
 k('siOpsOverdueActions','INSPECTION_OPERATIONS','Overdue corrective actions','الإجراءات التصحيحية المتأخرة',
   'Synthetic overdue findings follow-up count','عدد المتابعات المتأخرة افتراضيًا'),
 k('siOpsClosureHours','INSPECTION_OPERATIONS','Average inspection closure','متوسط زمن إغلاق المعاينة',
   'Simulated hours from inspection start to closure','ساعات الإغلاق التجريبية','hours'),
 // Trend series, genuine month ordering. Existing Manager line / area supports them.
 c('siAiCoverageTrend','AI_PERFORMANCE','AI workflow coverage over time','تطور تغطية AI للمسارات',
   'Monthly C01 analyzed workflows','عدد مسارات الترشيح المحللة شهريًا'),
 c('siAiSelectionTrend','AI_PERFORMANCE','AI vessel recommendations over time','تطور السفن التي يرشحها AI',
   'Monthly distinct AI-selected IMOs','السفن المختارة من AI عبر الشهور'),
 c('siAiAcceptanceTrend','AI_PERFORMANCE','Officer acceptance trend','تطور قبول الموظفين لتوصيات AI',
   'Monthly officer-accepted recommendations','التوصيات المقبولة بشريًا شهريًا'),
 c('siAiTimeTrend','AI_PERFORMANCE','AI analysis duration trend','تطور زمن معالجة AI',
   'Monthly average simulated C01 seconds; lower is better','متوسط زمن C01 بالثواني شهريًا'),
 c('siAiDecisionMix','AI_PERFORMANCE','C01 recommendation outcomes','توزيع مخرجات اختيار AI',
   'Latest month: selected, manual review and deferred source workflows','آخر شهر: مختار، مراجعة بشرية، مؤجل'),
 c('siOpsSelectionFunnel','INSPECTION_OPERATIONS','Inspection planning funnel','مراحل اختيار وتنفيذ المعاينات',
   'Candidate → AI selected → capacity feasible → scheduled → completed','مرشحة → اختارها AI → طاقة → جدول → مكتملة'),
 c('siOpsInspectionTrend','INSPECTION_OPERATIONS','Inspection completions by month','تطور المعاينات المكتملة',
   'Completed inspections across simulated months','المعاينات المكتملة شهريًا'),
 c('siOpsCapacityTrend','INSPECTION_OPERATIONS','Capacity-feasible visits by month','تطور المعاينات الممكن جدولتها',
   'Inspections with inspector and feasible vessel window','الزيارات التي لها مهندس متاح وموعد صالح'),
 c('siOpsCapacityReasons','INSPECTION_OPERATIONS','Capacity exception reasons','أسباب نقص الطاقة',
   'Breakdown of latest period simulated planning blockers','أسباب تعذر الجدولة في الفترة التجريبية'),
 c('siOpsInspectorLoad','INSPECTION_OPERATIONS','Inspector workload','عبء عمل المهندسين',
   'Simulated assignments per inspector, not ERP reservations','تكليفات افتراضية لكل مهندس وليست حجوزات ERP'),
 c('siOpsPortLoad','INSPECTION_OPERATIONS','Inspections by port','المعاينات حسب الميناء',
   'Simulated scheduled visits by UAE port','زيارات المعاينة التجريبية لكل ميناء'),
 t('siAiRunRegister','AI_PERFORMANCE','C01 analysis run register','سجل تحليلات C01',
   'Sample history by date, provider, workflows, recommendations','سجل تجريبي لنتائج تحليلات C01'),
 t('siOpsPlanRegister','INSPECTION_OPERATIONS','Inspection plan register','سجل خطط المعاينات',
   'Sample draft/capacity status by IMO, inspector and port','بيانات تجريبية للسفن والمهندسين وحالة الخطة')
];
export const SI_DASHBOARD_METRIC_IDS=new Set(
 SI_DASHBOARD_METRIC_DEFINITIONS.map(m=>m.id));
export const isSiDashboardMetric=(metric:string):boolean=>
 SI_DASHBOARD_METRIC_IDS.has(metric);
export const siMetricMeta=(id:string)=>
 SI_DASHBOARD_METRIC_DEFINITIONS.find(x=>x.id===id)||null;

export const SI_DEMO_PERIOD='2026-05 → 2026-10';
export const SI_DEMO_DATA_NATURE='STATIC_POC_SYNTHETIC_NOT_OFFICIAL' as const;
export const SI_DEMO_MONTHS=[
 {month:'May 26',candidate:58,workflows:65,analyzed:38,aiRuns:4,
  verified:36,recommended:6,accepted:5,manualReview:12,overrides:2,
  analysisSec:180,manualMinutes:170,assistedMinutes:115,
  capacity:4,scheduled:4,completed:3,onTime:2,utilization:42,findings:15,
  overdue:4,closureHours:42},
 {month:'Jun 26',candidate:65,workflows:75,analyzed:52,aiRuns:5,
  verified:49,recommended:8,accepted:6,manualReview:15,overrides:2,
  analysisSec:150,manualMinutes:165,assistedMinutes:102,
  capacity:6,scheduled:6,completed:5,onTime:4,utilization:48,findings:17,
  overdue:5,closureHours:39},
 {month:'Jul 26',candidate:73,workflows:84,analyzed:68,aiRuns:6,
  verified:65,recommended:10,accepted:8,manualReview:16,overrides:3,
  analysisSec:132,manualMinutes:158,assistedMinutes:90,
  capacity:8,scheduled:8,completed:6,onTime:5,utilization:53,findings:16,
  overdue:4,closureHours:36},
 {month:'Aug 26',candidate:82,workflows:96,analyzed:82,aiRuns:7,
  verified:78,recommended:13,accepted:10,manualReview:18,overrides:4,
  analysisSec:116,manualMinutes:154,assistedMinutes:80,
  capacity:10,scheduled:10,completed:8,onTime:7,utilization:61,findings:19,
  overdue:4,closureHours:33},
 {month:'Sep 26',candidate:91,workflows:104,analyzed:100,aiRuns:8,
  verified:96,recommended:16,accepted:13,manualReview:20,overrides:3,
  analysisSec:101,manualMinutes:150,assistedMinutes:69,
  capacity:13,scheduled:12,completed:10,onTime:9,utilization:68,findings:18,
  overdue:3,closureHours:30},
 {month:'Oct 26',candidate:99,workflows:112,analyzed:112,aiRuns:10,
  verified:108,recommended:21,accepted:17,manualReview:19,overrides:4,
  analysisSec:88,manualMinutes:148,assistedMinutes:54,
  capacity:16,scheduled:15,completed:12,onTime:11,utilization:73,findings:21,
  overdue:3,closureHours:27}
] as const;
const last=SI_DEMO_MONTHS[SI_DEMO_MONTHS.length-1];
const pct=(top:number,bottom:number)=>bottom>0?Math.round(top/bottom*1000)/10:0;
const fmt=(value:number,unit:'count'|'percent'|'minutes'|'hours'|'seconds'|'records')=>
 String(value)+(unit==='percent'?'%':unit==='hours'?' h':
 unit==='minutes'?' min':unit==='seconds'?' s':'');
/** KPI values derive from the same final row as the monthly trend series. */
export function siDemoMetricNumber(metric:string):string|null{
 const values:Record<string,number>={
  siAiAnalyzedVessels:99,siAiAnalyzedWorkflows:last.analyzed,
  siAiRunCount:last.aiRuns,
  siAiEvidenceRate:pct(last.verified,last.analyzed),
  siAiCoverageRate:pct(last.analyzed,last.workflows),
  siAiRecommended:last.recommended,
  siAiAcceptanceRate:pct(last.accepted,last.recommended),
  siAiManualReviews:last.manualReview,siAiOverrides:last.overrides,
  siAiProcessingSeconds:last.analysisSec,
  siAiPlanningMinutesSaved:last.manualMinutes-last.assistedMinutes,
  siOpsCandidateVessels:last.candidate,
  siOpsAiShortlisted:last.recommended,
  siOpsCapacityFeasible:last.capacity,
  siOpsCapacityOverflow:last.recommended-last.capacity,
  siOpsCapacityMatchRate:pct(last.capacity,last.recommended),
  siOpsEngineerUtilization:last.utilization,
  siOpsScheduled:last.scheduled,siOpsCompleted:last.completed,
  siOpsOnTimeRate:pct(last.onTime,last.completed),
  siOpsOpenFindings:last.findings,siOpsOverdueActions:last.overdue,
  siOpsClosureHours:last.closureHours
 };
 const meta=siMetricMeta(metric);
 return meta?.kind==='kpi'&&metric in values?
  fmt(values[metric],meta.unit):null;
}
export interface SiDemoSeriesRow{name:string;count:number;percent:number}
export function siDemoChartRows(metric:string):SiDemoSeriesRow[]|null{
 const property:Record<string,keyof typeof last>={
  siAiCoverageTrend:'analyzed',siAiSelectionTrend:'recommended',
  siAiAcceptanceTrend:'accepted',siAiTimeTrend:'analysisSec',
  siOpsInspectionTrend:'completed',siOpsCapacityTrend:'capacity'
 };
 const map=property[metric];
 let entries:Array<{name:string;count:number}>=[];
 if(map){
  entries=SI_DEMO_MONTHS.map(m=>({name:m.month,count:Number(m[map])}));
 }else if(metric==='siAiDecisionMix'){
  entries=[{name:'SELECT',count:last.recommended},
    {name:'MANUAL REVIEW',count:last.manualReview},
    {name:'DEFER',count:last.analyzed-last.recommended-last.manualReview}];
 }else if(metric==='siOpsSelectionFunnel'){
  entries=[{name:'Candidates',count:last.candidate},
    {name:'AI selected',count:last.recommended},
    {name:'Capacity fit',count:last.capacity},
    {name:'Scheduled',count:last.scheduled},
    {name:'Completed',count:last.completed}];
 }else if(metric==='siOpsCapacityReasons'){
  entries=[{name:'Inspector unavailable',count:2},
    {name:'Visit window',count:2},
    {name:'Qualification',count:1}];
 }else if(metric==='siOpsInspectorLoad'){
  entries=[{name:'Demo Inspector 01',count:5},
    {name:'Demo Inspector 02',count:4},
    {name:'Demo Inspector 03',count:3},
    {name:'Demo Inspector 04',count:3}];
 }else if(metric==='siOpsPortLoad'){
  entries=[{name:'Khalifa Port',count:6},{name:'Jebel Ali',count:4},
    {name:'Fujairah',count:3},{name:'Sharjah',count:2}];
 }else return null;
 const max=Math.max(1,...entries.map(x=>x.count));
 return entries.map(e=>({...e,percent:Math.round(e.count/max*100)}));
}
export interface SiDemoTable{
 headers:Array<{en:string;ar:string}>;
 rows:string[][];
}
const runRows:SiDemoTable={
 headers:[{en:'Month',ar:'الشهر'},{en:'C01 Runs',ar:'تحليلات C01'},
  {en:'Analyzed workflows',ar:'المسارات المحللة'},
  {en:'AI selected',ar:'اختيارات AI'},
  {en:'Officer accepted',ar:'اعتمدها الموظف'},
  {en:'Avg duration (sec)',ar:'متوسط الوقت (ثانية)'}],
 rows:SI_DEMO_MONTHS.map(m=>[
  m.month,String(m.aiRuns),String(m.analyzed),String(m.recommended),
  String(m.accepted),String(m.analysisSec)])
};
const planRows:SiDemoTable={
 headers:[{en:'Plan',ar:'الخطة'},{en:'Port',ar:'الميناء'},
  {en:'AI shortlist',ar:'قائمة AI'},{en:'Assigned',ar:'تم الإسناد'},
  {en:'Outside plan',ar:'خارج الخطة'},
  {en:'Status',ar:'الحالة'}],
 rows:[
  ['SI-POC-2026-021','Khalifa Port','6','4','2','DRAFT'],
  ['SI-POC-2026-022','Jebel Ali','5','4','1','READY FOR REVIEW'],
  ['SI-POC-2026-023','Fujairah','5','4','1','DRAFT'],
  ['SI-POC-2026-024','Sharjah','5','4','1','DRAFT']
 ]
};
export function siDemoTable(metric:string):SiDemoTable|null{
 return metric==='siAiRunRegister'?runRows:
  metric==='siOpsPlanRegister'?planRows:null;
}
