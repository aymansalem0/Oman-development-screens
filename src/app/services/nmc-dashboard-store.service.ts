import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type DashboardWidgetKind = 'kpi' | 'bar' | 'table' | 'position';
export type DashboardMetric =
  | 'vesselCount' | 'assessedCount' | 'attentionCount' | 'highCriticalCount'
  | 'priorityCount' | 'averageRisk' | 'byRisk' | 'byFlag'
  | 'byType' | 'byZone' | 'vesselTable' | 'vesselPositions';

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetKind;
  metric: DashboardMetric;
  title: string;
  span: 'half' | 'full';
}

export interface DashboardFilters {
  risk: string;
  type: string;
  flag: string;
  search: string;
}

export interface DashboardDefinition {
  id: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  updatedAt: string;
  version: number;
  widgets: DashboardWidget[];
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
    {value:'averageRisk',en:'Average assessed risk',ar:'متوسط مخاطر السفن المقيمة'}
  ],
  bar: [
    {value:'byRisk',en:'Vessels by risk level',ar:'السفن حسب مستوى المخاطر'},
    {value:'byFlag',en:'Vessels by flag',ar:'السفن حسب دولة العلم'},
    {value:'byType',en:'Vessels by type',ar:'السفن حسب النوع'},
    {value:'byZone',en:'Vessels by operational area',ar:'السفن حسب المنطقة التشغيلية'}
  ],
  table: [{value:'vesselTable',en:'Vessel monitoring table',ar:'جدول متابعة السفن'}],
  position: [{value:'vesselPositions',en:'Vessel position plot',ar:'توزيع مواقع السفن'}]
};

export function dashboardDefaults(): DashboardDefinition {
  return {
    id:'maritime-risk-monitoring',
    title:'Maritime Risk Monitoring',
    description:'Operational vessel activity and risk management overview',
    status:'DRAFT',
    version:1,
    updatedAt:new Date().toISOString(),
    filters:{risk:'All',type:'All',flag:'All',search:''},
    widgets:[
      {id:'w-total',type:'kpi',metric:'vesselCount',title:'Monitored Vessels',span:'half'},
      {id:'w-assessed',type:'kpi',metric:'assessedCount',title:'Assessed Vessels',span:'half'},
      {id:'w-attention',type:'kpi',metric:'attentionCount',title:'Requires Attention',span:'half'},
      {id:'w-priority',type:'kpi',metric:'priorityCount',title:'Priority Review',span:'half'},
      {id:'w-risk',type:'bar',metric:'byRisk',title:'Risk Distribution',span:'half'},
      {id:'w-types',type:'bar',metric:'byType',title:'Vessels by Type',span:'half'},
      {id:'w-table',type:'table',metric:'vesselTable',title:'Vessel Risk Register',span:'full'}
    ]
  };
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
    if(!d.id||!d.title.trim()||d.title.length>100||d.description.length>500||
       !Array.isArray(d.widgets)||d.widgets.length>30)throw new Error('INVALID_DASHBOARD');
    const ids=new Set<string>();
    for(const w of d.widgets){
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
