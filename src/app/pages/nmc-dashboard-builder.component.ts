import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LanguageService } from '../services/language.service';
import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import {
  DASHBOARD_METRICS, DashboardDefinition, DashboardMetric,
  DashboardWidget, DashboardWidgetKind, NmcDashboardStoreService
} from '../services/nmc-dashboard-store.service';
import {
  DashboardAnalyticsResponse, DashboardVessel, NmcDashboardDataService
} from '../services/nmc-dashboard-data.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';

type BarRow={name:string;count:number;percent:number};

@Component({
  selector:'app-nmc-dashboard-builder',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./nmc-dashboard-builder.component.html',
  styleUrl:'./nmc-dashboard-builder.component.css'
})
export class NmcDashboardBuilderComponent implements OnInit,OnDestroy {
  readonly catalog=DASHBOARD_METRICS;
  readonly widgetKinds: Array<{id:DashboardWidgetKind;en:string;ar:string;icon:string}>=[
    {id:'kpi',en:'KPI Card',ar:'بطاقة مؤشر',icon:'▦'},
    {id:'bar',en:'Distribution Chart',ar:'رسم توزيعي',icon:'▥'},
    {id:'table',en:'Vessel Table',ar:'جدول السفن',icon:'☷'},
    {id:'position',en:'Position Plot',ar:'توزيع المواقع',icon:'⌖'}
  ];
  dashboard:DashboardDefinition|null=null;
  dashboards:DashboardDefinition[]=[];
  editing=false;
  dirty=false;
  isLoading=true;
  dataError='';
  saveMessage='';
  savedAt='';
  lastRefresh:Date|null=null;
  fleet:DashboardVessel[]=[];
  private raw:DashboardAnalyticsResponse|null=null;
  private readonly subs=new Subscription();
  private poller?:ReturnType<typeof setInterval>;
  draggedId:string|null=null;
  tablePage=1;
  readonly pageSize=10;

  constructor(
    public readonly lang:LanguageService,
    private readonly route:ActivatedRoute,
    private readonly router:Router,
    public readonly store:NmcDashboardStoreService,
    private readonly data:NmcDashboardDataService,
    private readonly riskEngine:NmcRiskEngineService
  ){}

  ngOnInit():void {
    this.subs.add(this.store.dashboards$.subscribe(items=>this.dashboards=items));
    this.subs.add(this.route.paramMap.subscribe(params=>{
      const id=params.get('id');
      this.dashboard=id?this.store.get(id):null;
      this.editing=!!id;
      this.dirty=false;this.saveMessage='';this.tablePage=1;
      if(id&&!this.dashboard)this.router.navigate(['/moei/nmc/dashboards']);
    }));
    this.subs.add(this.riskEngine.config$.subscribe(()=>{
      if(this.raw)this.fleet=this.data.compose(this.raw);
    }));
    this.refresh();
    this.poller=setInterval(()=>this.refresh(true),30000);
  }

  ngOnDestroy():void {
    this.subs.unsubscribe();
    if(this.poller)clearInterval(this.poller);
  }

  copy(en:string,ar:string):string {return this.lang.pick(en,ar);}

  refresh(silent=false):void {
    if(!silent)this.isLoading=true;
    const sub=this.data.load().subscribe({
      next:result=>{
        this.raw=result;
        this.fleet=this.data.compose(result);
        this.dataError='';this.isLoading=false;
        this.lastRefresh=new Date();
      },
      error:()=>{
        this.dataError=this.copy(
          'Fleet intelligence is currently unavailable. No risk values have been assumed.',
          'بيانات تحليل الأسطول غير متاحة حاليًا. لم يتم افتراض أي درجات مخاطر.'
        );
        this.raw=null;
        this.fleet=this.data.compose({status:'ok',fleetSize:420,assessments:[]});
        this.isLoading=false;
      }
    });
    this.subs.add(sub);
  }

  create():void {
    try {
      const item=this.store.create();
      this.open(item.id);
    }catch {this.saveMessage=this.copy('Unable to create dashboard.','تعذر إنشاء لوحة المعلومات.');}
  }

  open(id:string):void {void this.router.navigate(['/moei/nmc/dashboards',id]);}

  duplicate(id:string):void {
    try {const d=this.store.duplicate(id);this.open(d.id);}
    catch{this.saveMessage=this.copy('Could not duplicate dashboard.','تعذر نسخ لوحة المعلومات.');}
  }

  remove(id:string):void {
    const d=this.store.get(id);
    if(!d)return;
    if(!window.confirm(this.copy('Delete dashboard '+d.title+'?','حذف لوحة المعلومات '+d.title+'؟')))return;
    try {
      this.store.remove(id);
      if(this.dashboard?.id===id)void this.router.navigate(['/moei/nmc/dashboards']);
    }catch {this.saveMessage=this.copy('Unable to delete dashboard.','تعذر حذف لوحة المعلومات.');}
  }

  addWidget(type:DashboardWidgetKind):void {
    if(!this.dashboard||this.dashboard.widgets.length>=30)return;
    const first=this.catalog[type][0];
    this.dashboard.widgets.push({
      id:'widget-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      type,metric:first.value,title:first.en,span:type==='table'||type==='position'?'full':'half'
    });
    this.touch();
  }

  changeMetric(widget:DashboardWidget):void {
    const meta=this.catalog[widget.type].find(x=>x.value===widget.metric);
    if(meta)widget.title=meta.en;
    this.touch();
  }

  changeWidth(widget:DashboardWidget):void {
    widget.span=widget.span==='half'?'full':'half';this.touch();
  }

  deleteWidget(id:string):void {
    if(!this.dashboard)return;
    this.dashboard.widgets=this.dashboard.widgets.filter(w=>w.id!==id);this.touch();
  }

  onDragStart(event:DragEvent,id:string):void {
    if(!this.editing)return;
    this.draggedId=id;
    event.dataTransfer?.setData('text/plain',id);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
  }

  onDragOver(event:DragEvent):void {
    if(this.editing)event.preventDefault();
  }

  onDrop(event:DragEvent,targetId:string):void {
    event.preventDefault();
    const origin=this.draggedId;
    this.draggedId=null;
    if(!origin||origin===targetId||!this.dashboard)return;
    const widgets=this.dashboard.widgets;
    const from=widgets.findIndex(x=>x.id===origin),to=widgets.findIndex(x=>x.id===targetId);
    if(from<0||to<0)return;
    const [item]=widgets.splice(from,1);
    widgets.splice(to,0,item);
    this.touch();
  }

  moveWidget(id:string,direction:-1|1):void {
    if(!this.dashboard)return;
    const i=this.dashboard.widgets.findIndex(w=>w.id===id);
    const to=i+direction;
    if(i<0||to<0||to>=this.dashboard.widgets.length)return;
    [this.dashboard.widgets[i],this.dashboard.widgets[to]]=
      [this.dashboard.widgets[to],this.dashboard.widgets[i]];
    this.touch();
  }

  touch():void {this.dirty=true;this.saveMessage='';this.tablePage=1;}

  save():void {
    if(!this.dashboard)return;
    try {
      this.dashboard=this.store.save(this.dashboard);
      this.dirty=false;this.savedAt=this.dashboard.updatedAt;
      this.saveMessage=this.copy('Dashboard saved successfully.','تم حفظ لوحة المعلومات بنجاح.');
    }catch {
      this.saveMessage=this.copy('Save failed. Check the title and widget settings.','تعذر الحفظ. تحقق من العنوان وإعدادات المؤشرات.');
    }
  }

  back():void {
    if(this.dirty && !window.confirm(this.copy(
      'Discard unsaved dashboard changes?','تجاهل التغييرات غير المحفوظة؟')))return;
    void this.router.navigate(['/moei/nmc/dashboards']);
  }

  get flags():string[]{return this.unique('flag');}
  get types():string[]{return this.unique('type');}

  private unique(key:'flag'|'type'):string[]{
    return Array.from(new Set(this.fleet.map(v=>v[key]))).sort();
  }

  get filtered():DashboardVessel[]{
    const f=this.dashboard?.filters;
    if(!f)return [];
    const term=(f.search||'').trim().toLowerCase();
    return this.fleet.filter(v=>
      (f.risk==='All'||v.riskCategory===f.risk)&&
      (f.type==='All'||v.type===f.type)&&
      (f.flag==='All'||v.flag===f.flag)&&
      (!term||v.name.toLowerCase().includes(term)||v.imo.includes(term))
    );
  }

  get assessed():DashboardVessel[]{return this.filtered.filter(v=>v.calculatedRisk!==null);}
  get attention():DashboardVessel[]{return this.assessed.filter(v=>v.attention);}
  get riskVersion():string{return this.riskEngine.config.version;}

  metricNumber(metric:DashboardMetric):string {
    const rows=this.filtered,assessed=this.assessed;
    switch(metric){
      case 'vesselCount':return String(rows.length);
      case 'assessedCount':return String(assessed.length);
      case 'attentionCount':return String(this.attention.length);
      case 'highCriticalCount':return String(assessed.filter(v=>
        v.riskCategory==='High'||v.riskCategory==='Critical').length);
      case 'priorityCount':return String(assessed.filter(v=>v.priorityReview).length);
      case 'averageRisk':return assessed.length?
        (assessed.reduce((sum,v)=>sum+(v.calculatedRisk||0),0)/assessed.length).toFixed(1):'—';
      default:return '—';
    }
  }

  barRows(metric:DashboardMetric):BarRow[]{
    const rows=this.filtered;
    const counts=new Map<string,number>();
    const add=(name:string)=>counts.set(name,(counts.get(name)||0)+1);
    rows.forEach(v=>{
      if(metric==='byRisk')add(v.riskCategory);
      else if(metric==='byFlag')add(v.flag);
      else if(metric==='byType')add(v.type);
      else if(metric==='byZone')add(v.zone);
    });
    if(metric==='byRisk'){
      for(const kind of ['Normal','Watch','High','Critical','Pending']){
        if(!counts.has(kind))counts.set(kind,0);
      }
    }
    const selected=Array.from(counts.entries()).map(([name,count])=>({name,count}));
    if(metric!=='byRisk')selected.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
    const visible=selected.slice(0,8);
    const max=Math.max(1,...visible.map(v=>v.count));
    return visible.map(row=>({...row,percent:Math.round(row.count/max*100)}));
  }

  get tableRows():DashboardVessel[]{
    return [...this.filtered].sort((a,b)=>
      (b.calculatedRisk??-1)-(a.calculatedRisk??-1)||
      a.name.localeCompare(b.name)
    ).slice((this.tablePage-1)*this.pageSize,this.tablePage*this.pageSize);
  }

  get tablePages():number{return Math.max(1,Math.ceil(this.filtered.length/this.pageSize));}

  setPage(n:number):void {
    this.tablePage=Math.max(1,Math.min(this.tablePages,n));
  }

  plotX(v:DashboardVessel):number{return Math.min(97,Math.max(3,(v.lng-51)/7*100));}
  plotY(v:DashboardVessel):number{return Math.min(97,Math.max(3,(27-v.lat)/5*100));}
  plotRows():DashboardVessel[]{return this.filtered.slice(0,420);}

  openVessel(v:DashboardVessel):void {
    void this.router.navigate(['/moei/nmc/vessel',v.imo]);
  }

  metricName(key:DashboardMetric):string {
    for(const values of Object.values(this.catalog)){
      const found=values.find(x=>x.value===key);
      if(found)return this.copy(found.en,found.ar);
    }
    return key;
  }

  get isManager():boolean{return !this.dashboard;}
}
