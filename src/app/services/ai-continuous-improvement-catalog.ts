/**
 * AI Continuous Improvement:
 * Instrumented counts replace illustrative values only when the corresponding
 * authoritative event source is available. The rest are POC design samples.
 * Demo values must never be described as real government execution statistics.
 */
export type AiCiKind='kpi'|'bar'|'table';
export interface AiCiMetric {
 id:string;kind:AiCiKind;en:string;ar:string;description:string;
}
const k=(id:string,en:string,ar:string,description:string):AiCiMetric=>
 ({id,kind:'kpi',en,ar,description});
const c=(id:string,en:string,ar:string,description:string):AiCiMetric=>
 ({id,kind:'bar',en,ar,description});
const t=(id:string,en:string,ar:string,description:string):AiCiMetric=>
 ({id,kind:'table',en,ar,description});
export const AI_CI_METRICS:ReadonlyArray<AiCiMetric>=[
 k('ciTotalCalls','AI calls','إجمالي استدعاءات AI','Number of instrumented agent executions'),
 k('ciSuccessfulCalls','Successful AI calls','استدعاءات AI الناجحة','Calls returned from upstream'),
 k('ciFailedCalls','Failed AI calls','استدعاءات AI الفاشلة','Failed upstream requests'),
 k('ciSuccessRate','AI call success rate','نسبة نجاح الاستدعاءات','Successful calls / total'),
 k('ciOfficerReviews','Officer AI reviews','مراجعات الضباط لتوصيات AI','Reviewed incident proposals'),
 k('ciOfficerAccept','Recommendations accepted','توصيات AI المقبولة','Officer ACCEPT decisions'),
 k('ciOfficerModify','Officer-modified proposals','التوصيات التي عدّلها الضباط','Officer MODIFY decisions'),
 k('ciOfficerReject','AI recommendations rejected','توصيات AI المرفوضة','Officer REJECT decisions'),
 k('ciOfficerOverrideRate','Officer change rate','نسبة تغيير الضباط لتوصيات AI','(MODIFY + REJECT)/reviewed'),
 k('ciIncidentAssessments','AI-analyzed incidents','الحوادث التي حللها AI','Incident assessments from Google Sheets'),
 k('ciVesselCalls','Maritime intelligence calls','استدعاءات ذكاء السفن','Instrumented A01/A02'),
 k('ciInspectionAiCalls','Smart Inspection AI calls','استدعاءات AI للمعاينة الذكية','Instrumented A04/C01/V01'),
 k('ciPhotoVision','AI photo inspections','الصور التي حللها AI','Instrumented SI-V01 requests'),
 k('ciDocumentAi','Document intelligence calls','تحليل المستندات بواسطة AI','Instrumented A03 calls'),
 k('ciDataQuality','Data-quality AI calls','استدعاءات AI لجودة البيانات','Instrumented DQ01 calls'),
 k('ciSeafarerChecks','Seafarer readiness analyses','تحليلات جاهزية البحارة','Future SDB event source'),
 k('ciAverageTime','Average AI turnaround','متوسط زمن استجابة AI','Future time-span telemetry'),
 k('ciReviewBacklog','Pending human AI review','توصيات تنتظر المراجعة البشرية','Future cross-domain review queue'),
 c('ciCallsByAgent','AI usage by agent','استدعاءات AI حسب الـAgent','Calls by A01/A02/A03/A04/C01/V01/S01/R01/X01/DQ01'),
 c('ciCallsByDomain','AI usage by domain','استخدام AI حسب المجال','Calls by NMC / Smart Inspection / Seafarers'),
 c('ciMonthlyTrend','AI calls trend','تطور استدعاءات AI','Monthly instrumented calls'),
 c('ciOfficerDecisionMix','Officer decisions on AI','قرارات الضباط بشأن توصيات AI','Accept / Modify / Reject'),
 t('ciAgentRegister','AI Agent Catalogue Performance','أداء وكلاء الذكاء الاصطناعي','Per-agent observed invocation counts')
];
export const AI_CI_IDS=new Set(AI_CI_METRICS.map(x=>x.id));
export const isAiCiMetric=(id:string)=>AI_CI_IDS.has(id);
export interface AiCiLiveSnapshot {
 status:'ok';source:string;measurementScope:string;
 calls:{total:number;success:number;failed:number;successRate:number|null;
   byAgent:Record<string,number>;byDomain:Record<string,number>;
   monthly:{name:string;count:number}[]};
 incidents:{sourceAvailable:boolean;aiAnalyzed:number|null;
  reviewed:number|null;accepted:number|null;modified:number|null;
  rejected:number|null;overrideRate:number|null};
 completeness:{globalAiriaHistory:boolean;sdbAgentEvents:boolean;
  allSIAgentsInstrumented:boolean;incidentSourceAvailable:boolean};
}
const agents=['A01','A02','A03','A04','C01','S01','V01','R01','X01','DQ01','NMC_DESK'] as const;
const months=['May','Jun','Jul','Aug','Sep','Oct'] as const;
const demoTrend=[31,43,59,72,96,123];
const illustrative:Record<string,number|string>={
 ciTotalCalls:424,ciSuccessfulCalls:397,ciFailedCalls:27,ciSuccessRate:'93.6%',
 ciOfficerReviews:81,ciOfficerAccept:57,ciOfficerModify:19,ciOfficerReject:5,
 ciOfficerOverrideRate:'29.6%',ciIncidentAssessments:63,ciVesselCalls:118,
 ciInspectionAiCalls:159,ciPhotoVision:37,ciDocumentAi:48,ciDataQuality:23,
 ciSeafarerChecks:42,ciAverageTime:'7.4 s',ciReviewBacklog:12
};
const sampleAgent:Record<string,number>={
 A01:65,A02:53,A03:48,A04:39,C01:49,S01:25,V01:37,R01:14,
 X01:11,DQ01:23,NMC_DESK:60
};
const fmt=(n:number|null|undefined,suffix='')=>
 n===null||n===undefined?'—':String(n)+suffix;
export function aiCiMetricNumber(id:string,live:AiCiLiveSnapshot|null):string|null{
 if(!AI_CI_IDS.has(id))return null;
 const calls=live?.calls,inc=live?.incidents;
 const map:Record<string,string|null|undefined>={
  ciTotalCalls:calls?fmt(calls.total):undefined,
  ciSuccessfulCalls:calls?fmt(calls.success):undefined,
  ciFailedCalls:calls?fmt(calls.failed):undefined,
  ciSuccessRate:calls?fmt(calls.successRate,'%'):undefined,
  ciOfficerReviews:inc?.sourceAvailable?fmt(inc.reviewed):undefined,
  ciOfficerAccept:inc?.sourceAvailable?fmt(inc.accepted):undefined,
  ciOfficerModify:inc?.sourceAvailable?fmt(inc.modified):undefined,
  ciOfficerReject:inc?.sourceAvailable?fmt(inc.rejected):undefined,
  ciOfficerOverrideRate:inc?.sourceAvailable?fmt(inc.overrideRate,'%'):undefined,
  ciIncidentAssessments:inc?.sourceAvailable?fmt(inc.aiAnalyzed):undefined,
  ciVesselCalls:calls?fmt((calls.byAgent['A01']||0)+(calls.byAgent['A02']||0)):undefined,
  ciInspectionAiCalls:calls?fmt((calls.byAgent['A04']||0)+(calls.byAgent['C01']||0)+
    (calls.byAgent['V01']||0)):undefined,
  ciPhotoVision:calls?fmt(calls.byAgent['V01']||0):undefined,
  ciDocumentAi:calls?fmt(calls.byAgent['A03']||0):undefined,
  ciDataQuality:calls?fmt(calls.byAgent['DQ01']||0):undefined
 };
 const value=map[id];
 return value!==undefined?value:String(illustrative[id]??'—');
}
export interface AiCiRow{name:string;count:number;percent:number}
export function aiCiChartRows(id:string,live:AiCiLiveSnapshot|null):AiCiRow[]|null{
 if(!AI_CI_IDS.has(id))return null;
 let data:{name:string;count:number}[]=[];
 if(id==='ciCallsByAgent')data=agents.map(agent=>({
  name:agent,count:live?(live.calls.byAgent[agent]||0):sampleAgent[agent]}));
 else if(id==='ciCallsByDomain')data=live
   ?['NMC','SMART_INSPECTION','SEAFARERS','CROSS_DOMAIN'].map(name=>
     ({name,count:live.calls.byDomain[name]||0}))
   :[{name:'NMC',count:197},{name:'SMART_INSPECTION',count:185},
      {name:'SEAFARERS',count:42}];
 else if(id==='ciMonthlyTrend')data=live
  ?live.calls.monthly.map(x=>({...x}))
  :months.map((name,i)=>({name:name+' 26',count:demoTrend[i]}));
 else if(id==='ciOfficerDecisionMix')data=[
  {name:'ACCEPT',count:live?.incidents.sourceAvailable?
    (live.incidents.accepted??0):57},
  {name:'MODIFY',count:live?.incidents.sourceAvailable?
    (live.incidents.modified??0):19},
  {name:'REJECT',count:live?.incidents.sourceAvailable?
    (live.incidents.rejected??0):5}
 ];
 else return null;
 const max=Math.max(1,...data.map(x=>x.count));
 return data.map(x=>({...x,percent:Math.round(x.count/max*100)}));
}
export function aiCiAgentTable(live:AiCiLiveSnapshot|null){
 return agents.map(agent=>({
  agent,calls:live?(live.calls.byAgent[agent]||0):sampleAgent[agent]
 }));
}
export function aiCiIsMeasured(id:string,live:AiCiLiveSnapshot|null):boolean{
 if(!live)return false;
 if(['ciOfficerReviews','ciOfficerAccept','ciOfficerModify','ciOfficerReject',
     'ciOfficerOverrideRate','ciIncidentAssessments','ciOfficerDecisionMix'].includes(id))
   return live.incidents.sourceAvailable;
 return !['ciSeafarerChecks','ciAverageTime','ciReviewBacklog'].includes(id);
}
