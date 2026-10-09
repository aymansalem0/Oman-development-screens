import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { LanguageService } from '../services/language.service';
import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import {
  DASHBOARD_METRICS, DASHBOARD_MENU_PLACEMENTS, NMC_CHART_TYPES, NMC_CHART_PALETTES, NmcChartType, NmcChartPalette, DashboardMenuPlacement, DashboardDefinition, DashboardMetric, DashboardTemplateKind,
  DashboardWidget, DashboardWidgetKind, NmcDashboardStoreService
} from '../services/nmc-dashboard-store.service';
import {
  DashboardAnalyticsResponse, DashboardVessel, NmcDashboardDataService
} from '../services/nmc-dashboard-data.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';
import { NmcDashboardWorkspaceService, DashboardRevision } from '../services/nmc-dashboard-workspace.service';
import { NmcDashboardNavigationService } from '../services/nmc-dashboard-navigation.service';
import { NmcDistributionChartComponent } from '../components/nmc-distribution-chart.component';

type BarRow={name:string;count:number;percent:number};

@Component({
  selector:'app-nmc-dashboard-builder',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent,NmcDistributionChartComponent],
  templateUrl:'./nmc-dashboard-builder.component.html',
  styleUrl:'./nmc-dashboard-builder.component.css'
})
export class NmcDashboardBuilderComponent implements OnInit,OnDestroy {
  readonly catalog=DASHBOARD_METRICS;
  readonly chartTypes=NMC_CHART_TYPES;
  readonly chartPalettes=NMC_CHART_PALETTES;
  readonly menuPlacements=DASHBOARD_MENU_PLACEMENTS;
  readonly widgetKinds: Array<{id:DashboardWidgetKind;en:string;ar:string;icon:string}>=[
    {id:'kpi',en:'KPI Card',ar:'بطاقة مؤشر',icon:'▦'},
    {id:'bar',en:'Distribution Chart',ar:'رسم توزيعي',icon:'▥'},
    {id:'table',en:'Vessel Table',ar:'جدول السفن',icon:'☷'},
    {id:'position',en:'Position Plot',ar:'توزيع المواقع',icon:'⌖'}
  ];
  dashboard:DashboardDefinition|null=null;
  dashboards:DashboardDefinition[]=[];
  sharedDashboards:DashboardDefinition[]=[];
  selectedMenuPlacement:Record<string,DashboardMenuPlacement>={};
  sharedError='';
  sharedBusy=false;
  sharedHistory:DashboardRevision[]=[];
  historyDashboardTitle='';
  private sharedVersions=new Map<string,number>();
  editing=false;
  viewOnly=false;
  viewLoading=false;
  viewError='';
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
    private readonly riskEngine:NmcRiskEngineService,
    private readonly workspace:NmcDashboardWorkspaceService,
    private readonly dashboardNavigation:NmcDashboardNavigationService
  ){}

  ngOnInit():void {
    this.subs.add(this.store.dashboards$.subscribe(items=>this.dashboards=items));
    this.subs.add(this.route.paramMap.subscribe(params=>{
      const id=params.get('id');
      this.viewOnly=this.route.snapshot.routeConfig?.path==='moei/nmc/dashboards/view/:id';
      this.viewLoading=false;
      this.viewError='';
      this.dashboard=null;
      this.editing=!!id&&!this.viewOnly;
      this.dirty=false;this.saveMessage='';this.tablePage=1;
      if (this.viewOnly && id) {
        this.viewLoading=true;
        const req=this.workspace.published(id).subscribe({
          next:result=>{
            if(this.viewOnly){
              this.dashboard=JSON.parse(JSON.stringify(result.dashboard)) as DashboardDefinition;
              this.viewLoading=false;
            }
          },
          error:error=>{
            this.viewLoading=false;
            this.viewError=error?.status===404
              ?this.copy('This dashboard is not published or is no longer available.','هذه اللوحة غير منشورة أو لم تعد متاحة.')
              :this.workspace.readableError(error,this.lang.isArabic);
          }
        });
        this.subs.add(req);
      } else {
        this.dashboard=id?this.store.get(id):null;
        if(this.dashboard&&!this.dashboard.menuPlacement)this.dashboard.menuPlacement='NMC_CENTER';
        // Populate editor selectors for legacy shared/local charts without
        // silently marking the user's existing saved dashboard as modified.
        this.dashboard?.widgets.forEach(widget=>{
          if(widget.type==='bar'){
            widget.chartType=widget.chartType||'horizontalBar';
            widget.palette=widget.palette||'maritime';
          }
        });
        if(id&&!this.dashboard)void this.router.navigate(['/moei/nmc/dashboards']);
      }
    }));
    this.subs.add(this.riskEngine.config$.subscribe(()=>{
      if(this.raw)this.fleet=this.data.compose(this.raw);
    }));
    this.refresh();
    this.loadShared();
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

  loadShared():void {
    const sub=this.workspace.list().subscribe({
      next:data=>{
        this.sharedDashboards=data.dashboards;
        this.selectedMenuPlacement=Object.fromEntries(data.dashboards.map(d=>[
          d.id,d.menuPlacement||'NMC_CENTER'
        ])) as Record<string,DashboardMenuPlacement>;
        this.sharedError='';
        this.sharedVersions=new Map(data.dashboards.map(d=>[d.id,d.version]));
      },
      error:error=>{
        this.sharedError=this.workspace.readableError(error,this.lang.isArabic);
      }
    });
    this.subs.add(sub);
  }

  viewPublished(board:DashboardDefinition):void {
    if(board.status!=='PUBLISHED')return;
    void this.router.navigate(['/moei/nmc/dashboards/view',board.id]);
  }

  getShared(id:string):DashboardDefinition|null {
    return this.sharedDashboards.find(d=>d.id===id)||null;
  }

  openShared(board:DashboardDefinition):void {
    // Never mutate a published version. Work from a separate draft copy.
    try{
      if(board.status==='PUBLISHED'){
        const draft=this.store.forkPublished(board);
        this.open(draft.id);
        return;
      }
      if(this.store.get(board.id) && !window.confirm(this.copy(
        'Import this shared draft into the designer? Existing local changes for it will be replaced.',
        'استيراد المسودة المشتركة إلى المصمم؟ سيتم استبدال أي تغييرات محلية على نفس اللوحة.'
      )))return;
      const draft=this.store.importShared(board);
      this.open(draft.id);
    }catch{
      this.sharedError=this.copy('Could not open shared dashboard.','تعذر فتح لوحة المعلومات المشتركة.');
    }
  }

  saveShared():void {
    if(this.viewOnly||!this.dashboard||this.sharedBusy)return;
    if(this.dirty)this.save();
    if(!this.dashboard||this.dirty)return;
    const existing=this.getShared(this.dashboard.id);
    if(existing?.status==='PUBLISHED'){
      this.saveMessage=this.copy(
        'Published dashboards cannot be overwritten. Use Duplicate to create a new draft.',
        'لا يمكن الكتابة فوق لوحة منشورة. أنشئ نسخة جديدة قابلة للتعديل.'
      );return;
    }
    this.sharedBusy=true;
    let action;
    try{
      const version=this.sharedVersions.get(this.dashboard.id);
      action=existing&&version!==undefined
        ?this.workspace.save(this.dashboard,version)
        :this.workspace.create(this.dashboard);
    }catch(error){
      this.sharedBusy=false;this.saveMessage=this.workspace.readableError(error,this.lang.isArabic);
      return;
    }
    this.subs.add(action.subscribe({
      next:r=>{
        this.sharedBusy=false;
        this.sharedVersions.set(r.dashboard.id,r.dashboard.version);
        this.saveMessage=this.copy('Saved to the shared dashboard workspace.','تم الحفظ في مساحة لوحات المعلومات المشتركة.');
        this.loadShared();
      },
      error:error=>{
        this.sharedBusy=false;
        this.saveMessage=this.workspace.readableError(error,this.lang.isArabic);
      }
    }));
  }

  publishShared(board:DashboardDefinition):void {
    if(board.status!=='DRAFT'||this.sharedBusy)return;
    if(!window.confirm(this.copy(
      'Publish '+board.title+' as a read-only dashboard for business users?',
      'نشر '+board.title+' كلوحة معلومات للعرض للمستخدمين؟'
    )))return;
    this.sharedBusy=true;
    let request;
    try{request=this.workspace.publish(board.id,board.version);}
    catch(error){this.sharedBusy=false;this.sharedError=this.workspace.readableError(error,this.lang.isArabic);return;}
    this.subs.add(request.subscribe({
      next:()=>{
        this.sharedBusy=false;
        this.loadShared();
        this.dashboardNavigation.refresh();
        this.sharedError=this.copy('Dashboard published successfully.','تم نشر لوحة المعلومات بنجاح.');
      },
      error:error=>{
        this.sharedBusy=false;
        this.sharedError=this.workspace.readableError(error,this.lang.isArabic);
      }
    }));
  }

  moveSharedMenu(board:DashboardDefinition):void {
    if(board.status!=='PUBLISHED'||this.sharedBusy)return;
    const target=this.selectedMenuPlacement[board.id]||'NMC_CENTER';
    if(target===(board.menuPlacement||'NMC_CENTER'))return;
    this.sharedBusy=true;
    let request;
    try {request=this.workspace.movePublished(board.id,board.version,target);}
    catch(error){
      this.sharedBusy=false;
      this.sharedError=this.workspace.readableError(error,this.lang.isArabic);
      return;
    }
    this.subs.add(request.subscribe({
      next:()=>{
        this.sharedBusy=false;
        this.loadShared();
        this.dashboardNavigation.refresh();
        this.sharedError=this.copy('Dashboard menu location updated.','تم تحديث مكان لوحة المعلومات في القائمة.');
      },
      error:error=>{
        this.sharedBusy=false;
        this.sharedError=this.workspace.readableError(error,this.lang.isArabic);
      }
    }));
  }

  archiveShared(board:DashboardDefinition):void {
    if(board.status!=='DRAFT'||this.sharedBusy)return;
    if(!window.confirm(this.copy('Archive '+board.title+'?','أرشفة '+board.title+'؟')))return;
    this.sharedBusy=true;
    let request;
    try{request=this.workspace.archive(board.id,board.version);}
    catch(error){this.sharedBusy=false;this.sharedError=this.workspace.readableError(error,this.lang.isArabic);return;}
    this.subs.add(request.subscribe({
      next:()=>{this.sharedBusy=false;this.loadShared();},
      error:error=>{
        this.sharedBusy=false;this.sharedError=this.workspace.readableError(error,this.lang.isArabic);
      }
    }));
  }

  showHistory(board:DashboardDefinition):void {
    this.historyDashboardTitle=board.title;
    this.sharedHistory=[];
    this.subs.add(this.workspace.revisions(board.id).subscribe({
      next:r=>this.sharedHistory=r.revisions,
      error:error=>this.sharedError=this.workspace.readableError(error,this.lang.isArabic)
    }));
  }

  createFromTemplate(kind:DashboardTemplateKind):void {
    try {
      const board=this.store.createFromTemplate(kind);
      this.open(board.id);
    }catch {
      this.saveMessage=this.copy('Could not create dashboard template.','تعذر إنشاء لوحة معلومات من النموذج.');
    }
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
    if(this.viewOnly||!this.dashboard||this.dashboard.widgets.length>=30)return;
    const first=this.catalog[type][0];
    this.dashboard.widgets.push({
      id:'widget-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),
      type,metric:first.value,title:first.en,span:type==='table'||type==='position'?'full':'half',
      ...(type==='bar'?{chartType:'horizontalBar' as NmcChartType,palette:'maritime' as NmcChartPalette}:{})
    });
    this.touch();
  }

  changeMetric(widget:DashboardWidget):void {
    if(this.viewOnly)return;
    const meta=this.catalog[widget.type].find(x=>x.value===widget.metric);
    if(meta)widget.title=meta.en;
    this.touch();
  }

  configureChart(widget:DashboardWidget):void {
    if(this.viewOnly||widget.type!=='bar')return;
    widget.chartType=widget.chartType||'horizontalBar';
    widget.palette=widget.palette||'maritime';
    this.touch();
  }

  changeWidth(widget:DashboardWidget):void {
    if(this.viewOnly)return;
    widget.span=widget.span==='half'?'full':'half';this.touch();
  }

  deleteWidget(id:string):void {
    if(this.viewOnly||!this.dashboard)return;
    this.dashboard.widgets=this.dashboard.widgets.filter(w=>w.id!==id);this.touch();
  }

  onDragStart(event:DragEvent,id:string):void {
    if(this.viewOnly||!this.editing)return;
    this.draggedId=id;
    event.dataTransfer?.setData('text/plain',id);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
  }

  onDragOver(event:DragEvent):void {
    if(this.editing&&!this.viewOnly)event.preventDefault();
  }

  onDrop(event:DragEvent,targetId:string):void {
    if(this.viewOnly)return;
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
    if(this.viewOnly||!this.dashboard)return;
    const i=this.dashboard.widgets.findIndex(w=>w.id===id);
    const to=i+direction;
    if(i<0||to<0||to>=this.dashboard.widgets.length)return;
    [this.dashboard.widgets[i],this.dashboard.widgets[to]]=
      [this.dashboard.widgets[to],this.dashboard.widgets[i]];
    this.touch();
  }

  touch():void {if(this.viewOnly)return;this.dirty=true;this.saveMessage='';this.tablePage=1;}

  save():void {
    if(this.viewOnly||!this.dashboard)return;
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
    // Preserve the complete filtered fleet in pie/doughnut percentages:
    // merge minor categories into "Other" rather than dropping them.
    const visible=selected.length>8&&metric!=='byRisk'
      ?[...selected.slice(0,7),{
        name:this.copy('Other','أخرى'),
        count:selected.slice(7).reduce((sum,row)=>sum+row.count,0)
      }]
      :selected;
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

  get isManager():boolean{return !this.dashboard&&!this.viewOnly;}
}
