import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {SI_DASHBOARD_METRIC_DEFINITIONS} from './si-dashboard-metric-catalog';
import {AI_CI_METRICS} from './ai-continuous-improvement-catalog';

export type DashboardWidgetKind = 'kpi' | 'bar' | 'table' | 'position';
/** The 'bar' widget kind is a distribution widget; chartType selects the renderer. */
export type NmcChartType = 'horizontalBar' | 'column' | 'pie' | 'donut' | 'line' | 'area';
export type NmcChartPalette = 'maritime' | 'vibrant' | 'ocean' | 'sunset';
export const NMC_CHART_TYPES: Array<{value:NmcChartType;en:string;ar:string}> = [
  {value:'horizontalBar',en:'Horizontal Bar',ar:'أعمدة أفقية'},
  {value:'column',en:'Column',ar:'أعمدة رأسية'},
  {value:'pie',en:'Pie',ar:'دائري'},
  {value:'donut',en:'Doughnut',ar:'حلقي'},
  {value:'line',en:'Line (categories)',ar:'خطي (تصنيفات)'},
  {value:'area',en:'Area (categories)',ar:'مساحي (تصنيفات)'}
];
export const NMC_CHART_PALETTES: Array<{value:NmcChartPalette;en:string;ar:string}> = [
  {value:'maritime',en:'Maritime',ar:'بحري'},
  {value:'vibrant',en:'Vibrant',ar:'ألوان زاهية'},
  {value:'ocean',en:'Ocean',ar:'محيطي'},
  {value:'sunset',en:'Sunset',ar:'غروب'}
];
export type DashboardMenuPlacement = 'NMC_CENTER' | 'SMART_INSPECTION' | 'SETTINGS';
export const DASHBOARD_MENU_PLACEMENTS: Array<{value:DashboardMenuPlacement;en:string;ar:string}> = [
  {value:'NMC_CENTER',en:'NMC Center',ar:'المركز البحري الوطني'},
  {value:'SMART_INSPECTION',en:'Smart Inspection',ar:'المعاينة الذكية'},
  {value:'SETTINGS',en:'Settings',ar:'الإعدادات'}
];
export type DashboardMetric =
  | 'vesselCount' | 'assessedCount' | 'attentionCount' | 'highCriticalCount'
  | 'priorityCount' | 'averageRisk' | 'byRisk' | 'byFlag'
  | 'byType' | 'byZone' | 'vesselTable' | 'vesselPositions'
  | (string & {});

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetKind;
  metric: DashboardMetric;
  title: string;
  span: 'half' | 'full';
  /** Optional for compatibility with all previously saved distribution widgets. */
  chartType?: NmcChartType;
  palette?: NmcChartPalette;
}

export interface DashboardFilters {
  risk: string;
  type: string;
  flag: string;
  search: string;
}

export interface ProposedDashboardMetric{
  id:string;title:string;type:DashboardWidgetKind;
  sourceKey:string;sourceEntity:string;fields:string[];
  method:string;formula:string;grouping:string;filters:string;
  rationale:string;status:'SOURCE_MAPPING_REQUIRED';
  dataNature:'UNVERIFIED_PROPOSAL';executable:false;
}

export interface DashboardDefinition {
  id: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  /** Populated only on server-created revisions of an existing published dashboard. */
  publishedParentId?: string;
  basePublishedVersion?: number;
  /** Legacy dashboards without this field default to NMC Center. */
  menuPlacement?: DashboardMenuPlacement;
  updatedAt: string;
  version: number;
  widgets: DashboardWidget[];
  proposedMetrics?: ProposedDashboardMetric[];
  filters: DashboardFilters;
}

export const DASHBOARD_METRICS: Record<DashboardWidgetKind, Array<{
  value: DashboardMetric; en: string; ar: string;
}>> = {
  kpi: [
    {value:'vesselCount',en:'Monitored vessels',ar:'السفن قيد المتابعة'},
    {value:'assessedCount',en:'AI-assessed vessels',ar:'السفن المقيمة'},
    {value:'attentionCount',en:'Vessels requiring attention',ar:'السفن التي تتطلب متابعة'},
    {value:'highCriticalCount',en:'High and critical risk',ar:'المخاطر المرتفعة والحرجة'},
    {value:'priorityCount',en:'Priority review vessels',ar:'السفن ذات أولوية المراجعة'},
    {value:'averageRisk',en:'Average assessed risk',ar:'متوسط مخاطر السفن المقيمة'},
    ...SI_DASHBOARD_METRIC_DEFINITIONS.filter(m=>m.kind==='kpi')
      .map(m=>({value:m.id,en:m.en,ar:m.ar})),
    ...AI_CI_METRICS.filter(m=>m.kind==='kpi')
      .map(m=>({value:m.id,en:m.en,ar:m.ar}))
  ],
  bar: [
    {value:'byRisk',en:'Vessels by risk level',ar:'السفن حسب مستوى المخاطر'},
    {value:'byFlag',en:'Vessels by flag',ar:'السفن حسب دولة العلم'},
    {value:'byType',en:'Vessels by type',ar:'السفن حسب النوع'},
    {value:'byZone',en:'Vessels by operational area',ar:'السفن حسب المنطقة التشغيلية'},
    ...SI_DASHBOARD_METRIC_DEFINITIONS.filter(m=>m.kind==='bar')
      .map(m=>({value:m.id,en:m.en,ar:m.ar})),
    ...AI_CI_METRICS.filter(m=>m.kind==='bar')
      .map(m=>({value:m.id,en:m.en,ar:m.ar}))
  ],
  table: [
    {value:'vesselTable',en:'Vessel monitoring table',ar:'جدول متابعة السفن'},
    ...SI_DASHBOARD_METRIC_DEFINITIONS.filter(m=>m.kind==='table')
      .map(m=>({value:m.id,en:m.en,ar:m.ar})),
    ...AI_CI_METRICS.filter(m=>m.kind==='table')
      .map(m=>({value:m.id,en:m.en,ar:m.ar}))
  ],
  position: [{value:'vesselPositions',en:'Vessel position plot',ar:'توزيع مواقع السفن'}]
};

export function dashboardDefaults(): DashboardDefinition {
  return {
    id:'maritime-risk-monitoring',
    title:'Maritime Risk Monitoring',
    description:'Operational vessel activity and risk management overview',
    status:'DRAFT',
    menuPlacement:'NMC_CENTER',
    version:1,
    updatedAt:new Date().toISOString(),
    filters:{risk:'All',type:'All',flag:'All',search:''},
    widgets:[
      {id:'w-total',type:'kpi',metric:'vesselCount',title:'Monitored Vessels',span:'half'},
      {id:'w-assessed',type:'kpi',metric:'assessedCount',title:'Assessed Vessels',span:'half'},
      {id:'w-attention',type:'kpi',metric:'attentionCount',title:'Requires Attention',span:'half'},
      {id:'w-priority',type:'kpi',metric:'priorityCount',title:'Priority Review',span:'half'},
      {id:'w-risk',type:'bar',metric:'byRisk',title:'Risk Distribution',span:'half',chartType:'donut',palette:'maritime'},
      {id:'w-types',type:'bar',metric:'byType',title:'Vessels by Type',span:'half',chartType:'column',palette:'ocean'},
      {id:'w-table',type:'table',metric:'vesselTable',title:'Vessel Risk Register',span:'full'}
    ]
  };
}


/** AI Continuous Improvement is an explicit POC draft, never auto-published. */
export function buildAiContinuousImprovementDashboard():DashboardDefinition{
 const board=dashboardDefaults();
 const ids=[
   'ciTotalCalls','ciSuccessfulCalls','ciFailedCalls','ciSuccessRate',
   'ciOfficerReviews','ciOfficerAccept','ciOfficerModify','ciOfficerReject',
   'ciOfficerOverrideRate','ciIncidentAssessments',
   'ciVesselCalls','ciInspectionAiCalls','ciPhotoVision','ciDocumentAi',
   'ciDataQuality','ciSeafarerChecks','ciAverageTime','ciReviewBacklog',
   'ciCallsByAgent','ciCallsByDomain','ciMonthlyTrend',
   'ciOfficerDecisionMix','ciAgentRegister'
 ];
 board.title='AI Continuous Improvement';
 board.description='AI operational adoption, officer review decisions, agent usage and continuous improvement across maritime domains.';
 board.menuPlacement='NMC_CENTER';
 board.widgets=ids.map((id,index)=>{
   const metric=AI_CI_METRICS.find(m=>m.id===id);
   if(!metric)throw new Error('AI_CI_METRIC_MISSING');
   return {id:'ci-'+index,type:metric.kind,metric:id,title:metric.en,
      span:metric.kind==='table'?'full':'half',
      ...(metric.kind==='bar'?{chartType:'column' as NmcChartType,
          palette:'ocean' as NmcChartPalette}:{})};
 });
 return board;
}

export type DashboardTemplateKind = 'operational' | 'management' | 'executive';

/**
 * Reuse the existing validated vessel analytics only. Management and executive
 * presets deliberately do not invent incident/SLA or historical-trend KPIs.
 */
export function buildDashboardTemplate(kind:DashboardTemplateKind):DashboardDefinition {
  const base=dashboardDefaults();
  if(kind==='operational')return base;
  if(kind==='management'){
    base.title='NMC Management Overview';
    base.description='Fleet risk, assessment coverage and operational priority monitoring';
    base.widgets=[
      {id:'mg-assessed',type:'kpi',metric:'assessedCount',title:'AI-Assessed Vessels',span:'half'},
      {id:'mg-attention',type:'kpi',metric:'attentionCount',title:'Requires Attention',span:'half'},
      {id:'mg-priority',type:'kpi',metric:'priorityCount',title:'Priority Reviews',span:'half'},
      {id:'mg-avg-risk',type:'kpi',metric:'averageRisk',title:'Average Assessed Risk',span:'half'},
      {id:'mg-risk',type:'bar',metric:'byRisk',title:'Fleet Risk Distribution',span:'half'},
      {id:'mg-type',type:'bar',metric:'byType',title:'Fleet by Vessel Type',span:'half'},
      {id:'mg-register',type:'table',metric:'vesselTable',title:'Operational Risk Register',span:'full'}
    ];
  }else{
    base.title='Executive Maritime Overview';
    base.description='Strategic maritime fleet indicators and priority risk overview';
    base.widgets=[
      {id:'ex-total',type:'kpi',metric:'vesselCount',title:'Monitored Vessels',span:'half'},
      {id:'ex-assessed',type:'kpi',metric:'assessedCount',title:'Assessment Coverage',span:'half'},
      {id:'ex-critical',type:'kpi',metric:'highCriticalCount',title:'High and Critical Risks',span:'half'},
      {id:'ex-priority',type:'kpi',metric:'priorityCount',title:'Priority Intervention Reviews',span:'half'},
      {id:'ex-risk',type:'bar',metric:'byRisk',title:'Strategic Risk Distribution',span:'half'},
      {id:'ex-area',type:'bar',metric:'byZone',title:'Risks by Operational Area',span:'half'},
      {id:'ex-register',type:'table',metric:'vesselTable',title:'Priority Vessel Register',span:'full'}
    ];
  }
  return base;
}

const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value)) as T;

@Injectable({providedIn:'root'})
export class NmcDashboardStoreService {
  private readonly key = 'moei-nmc-dashboard-definitions-v1';
  private readonly subject = new BehaviorSubject<DashboardDefinition[]>(this.load());
  readonly dashboards$ = this.subject.asObservable();

  get dashboards(): DashboardDefinition[] {return clone(this.subject.value);}

  get(id:string): DashboardDefinition | null {
    const found=this.subject.value.find(row=>row.id===id);
    return found?clone(found):null;
  }

  createFromTemplate(kind:DashboardTemplateKind):DashboardDefinition {
    const model=buildDashboardTemplate(kind);
    const draft:DashboardDefinition={
      ...model,id:'dashboard-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      status:'DRAFT',version:1,updatedAt:new Date().toISOString(),
      widgets:model.widgets.map(w=>({
        ...w,id:'widget-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2))
      }))
    };
    this.commit([...this.subject.value,draft]);
    return clone(draft);
  }

  createAiContinuousImprovement():DashboardDefinition{
    const board=buildAiContinuousImprovementDashboard();
    const draft:DashboardDefinition={
      ...board,id:'dashboard-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      status:'DRAFT',version:1,updatedAt:new Date().toISOString()
    };
    this.validate(draft);
    this.commit([...this.subject.value,draft]);
    return clone(draft);
  }

  /** Import a centrally stored definition without fabricating a version change. */
  importShared(input:DashboardDefinition):DashboardDefinition {
    this.validate(input);
    const snapshot=clone(input);
    this.commit([
      ...this.subject.value.filter(item=>item.id!==snapshot.id),
      snapshot
    ]);
    return clone(snapshot);
  }

  /** Editing a published dashboard starts as a new, independent draft. */
  forkPublished(input:DashboardDefinition):DashboardDefinition {
    this.validate(input);
    const draft:DashboardDefinition={
      ...clone(input),
      id:'dashboard-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      title:input.title+' - Copy',
      status:'DRAFT',version:1,updatedAt:new Date().toISOString(),
      widgets:input.widgets.map(widget=>({
        ...widget,id:'widget-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2))
      }))
    };
    this.commit([...this.subject.value,draft]);
    return clone(draft);
  }

  create(): DashboardDefinition {
    const now=new Date().toISOString();
    const item: DashboardDefinition={
      id:'dashboard-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      title:'New Dashboard',description:'',
      status:'DRAFT',updatedAt:now,version:1,
      filters:{risk:'All',type:'All',flag:'All',search:''},
      widgets:[]
    };
    this.commit([...this.subject.value,item]);
    return clone(item);
  }

  save(input:DashboardDefinition):DashboardDefinition {
    this.validate(input);
    const existing=this.subject.value.find(row=>row.id===input.id);
    if(!existing)throw new Error('DASHBOARD_NOT_FOUND');
    const next:DashboardDefinition={
      ...clone(input),status:'DRAFT',
      version:existing.version+1,updatedAt:new Date().toISOString()
    };
    this.commit(this.subject.value.map(row=>row.id===input.id?next:row));
    return clone(next);
  }

  remove(id:string):void {
    if(!this.subject.value.some(row=>row.id===id))return;
    this.commit(this.subject.value.filter(row=>row.id!==id));
  }

  duplicate(id:string):DashboardDefinition {
    const original=this.get(id);
    if(!original)throw new Error('DASHBOARD_NOT_FOUND');
    const copyItem:DashboardDefinition={
      ...original,id:'dashboard-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      title:original.title+' - Copy',version:1,status:'DRAFT',
      updatedAt:new Date().toISOString(),
      widgets:original.widgets.map(w=>({...w,id:'widget-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2))}))
    };
    this.commit([...this.subject.value,copyItem]);
    return clone(copyItem);
  }

  private validate(d:DashboardDefinition):void {
    if(d.menuPlacement!==undefined &&
       !DASHBOARD_MENU_PLACEMENTS.some(option=>option.value===d.menuPlacement))
      throw new Error('INVALID_DASHBOARD_MENU_PLACEMENT');
    if(!d.id||!d.title.trim()||d.title.length>100||d.description.length>500||
       !Array.isArray(d.widgets)||d.widgets.length>30)throw new Error('INVALID_DASHBOARD');
    if(d.proposedMetrics!==undefined){
      if(!Array.isArray(d.proposedMetrics)||d.proposedMetrics.length>20)
        throw new Error('INVALID_UNBOUND_METRIC_COUNT');
      for(const m of d.proposedMetrics){
        if(!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(m.id)||
          !m.title||m.title.length>100||
          !['kpi','bar','table','position'].includes(m.type)||
          !m.sourceKey||!m.method||!m.formula||
          m.status!=='SOURCE_MAPPING_REQUIRED'||m.executable!==false)
          throw new Error('INVALID_UNBOUND_METRIC');
      }
    }
    const ids=new Set<string>();
    for(const w of d.widgets){
      if(w.type==='bar'&&
        (w.chartType!==undefined&&!NMC_CHART_TYPES.some(t=>t.value===w.chartType)||
         w.palette!==undefined&&!NMC_CHART_PALETTES.some(p=>p.value===w.palette)))
        throw new Error('INVALID_DASHBOARD_CHART');
      if(!w.id||ids.has(w.id)||w.title.length>100||!w.title.trim()||
         !DASHBOARD_METRICS[w.type]?.some(m=>m.value===w.metric)||
         !['half','full'].includes(w.span))throw new Error('INVALID_DASHBOARD_WIDGET');
      ids.add(w.id);
    }
  }

  private load():DashboardDefinition[] {
    try {
      const raw=localStorage.getItem(this.key);
      if(!raw)return [dashboardDefaults()];
      const parsed:unknown=JSON.parse(raw);
      if(!Array.isArray(parsed))return [dashboardDefaults()];
      return parsed.filter((x):x is DashboardDefinition=>
        !!x&&typeof x.id==='string'&&typeof x.title==='string'&&
        Array.isArray(x.widgets)&&x.filters&&typeof x.filters==='object');
    }catch{return [dashboardDefaults()];}
  }

  private commit(rows:DashboardDefinition[]):void {
    // Failed persistence must be reported to the user instead of claiming a save.
    localStorage.setItem(this.key,JSON.stringify(rows));
    this.subject.next(clone(rows));
  }
}
