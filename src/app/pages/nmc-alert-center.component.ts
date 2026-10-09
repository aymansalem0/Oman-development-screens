import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router,RouterLink} from '@angular/router';
import {Subscription,forkJoin,of} from 'rxjs';
import {catchError,map} from 'rxjs/operators';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {getOperationalVesselByImo} from '../data/nmc-expanded-vessel-catalog';
import {NmcFleetAiService,FleetAiAssessment,FleetAiSnapshot} from '../services/nmc-fleet-ai.service';
import {NmcRiskEngineService,RiskEngineConfig} from '../services/nmc-risk-engine.service';
import {
  NmcAlertsService,NmcOperationalAlert,NmcAlertAudit,
  NmcAlertsOverview,AlertAction,AlertSeverity,AlertStatus
} from '../services/nmc-alerts.service';
import {NmcCasesService,NmcCentralCase} from '../services/nmc-cases.service';

type StatusFilter='ACTIVE'|'ALL'|'OPEN'|'ESCALATED'|'RESOLVED';
type RiskLevel='Normal'|'Watch'|'High'|'Critical';
interface RiskCandidate {
  imo:string;assessmentId:string;score:number;level:'High'|'Critical';
  sourceRiskScore:number;sourceRiskLevel:string;
  reason:'CRITICAL_OPEN_FINDING'|'PROJECTED_RISK_CLASS';
}
@Component({
  selector:'app-nmc-alert-center',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./nmc-alert-center.component.html',
  styleUrl:'./nmc-alert-center.component.css'
})
export class NmcAlertCenterComponent implements OnInit,OnDestroy{
  overview?:NmcAlertsOverview;
  loading=true;
  busy='';
  error='';
  success='';
  query='';
  filter:StatusFilter='ACTIVE';
  selectedId='';
  audit:NmcAlertAudit[]=[];
  auditLoading=false;
  notes:Record<string,string>={};
  linkedCases:NmcCentralCase[]=[];
  creatingCase='';
  private readonly subs=new Subscription();
  private poller?:ReturnType<typeof setInterval>;
  policyLoading=false;
  policyError='';
  readonly policyCoverageLabel='BROWSER_LOCAL_PROJECTION_ONLY';
  riskPopulation={monitored:420,assessed:0,projected:0,pending:420,
    normal:0,watch:0,high:0,critical:0,scoreSum:0,averageScore:0};
  readonly projectedCandidates:RiskCandidate[]=[];
  fleetSourceError='';
  projectionReady=false;
  policyConfig:RiskEngineConfig|null=null;
  readonly policyResults=new Map<string,{
    eligible:boolean;level:string;score:number;reason:string;
    originalLevel:string;originalScore:number;assessmentId:string;
  }>();
  private requestVersion=0;
  private readonly onRiskStorage=(event:StorageEvent):void=>{
    if(event.key==='moei-nmc-risk-engine-config:v1'){
      // config$ subscription is responsible for evaluation after reading the new policy.
      this.riskEngine.syncPublishedFromStorage();
    }
  };

  constructor(public lang:LanguageService,private readonly alerts:NmcAlertsService,
    private readonly cases:NmcCasesService,private readonly router:Router,
    private readonly fleet:NmcFleetAiService,
    private readonly riskEngine:NmcRiskEngineService){}
  ngOnInit():void{
    this.subs.add(this.riskEngine.config$.subscribe(config=>{
      this.policyConfig=config;
      if(this.overview)this.evaluateLocalPolicy();
    }));
    window.addEventListener('storage',this.onRiskStorage);
    this.refresh();
    this.poller=setInterval(()=>{if(!this.busy)this.refresh(false);},15000);
  }
  ngOnDestroy():void{
    this.subs.unsubscribe();
    window.removeEventListener('storage',this.onRiskStorage);
    if(this.poller)clearInterval(this.poller);
  }
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  refresh(spinner=true):void{
    if(spinner)this.loading=true;
    this.subs.add(this.alerts.overview().subscribe({
      next:data=>{
        this.overview=data;
        this.loading=false;
        this.evaluateLocalPolicy();
        this.loadLinkedCases();
        this.error='';
        if(this.selectedId)this.loadHistory(this.selectedId);
      },
      error:err=>{
        this.error=this.alerts.readableError(err,this.lang.isArabic);
        this.loading=false;
      }
    }));
  }
  /**
   * Browser-local impact projection ONLY. Reevaluate already-saved A01/A02
   * factor severities under local Risk Settings; no agent, database mutation,
   * deletion, auto case closure or authoritative policy publication.
   *
   * An unresolved critical finding is an independent trigger: never hide it
   * merely because the composite numeric score has a lower classification.
   * If inputs cannot be read, fail open and retain the existing alert.
   */
  private evaluateLocalPolicy():void{
    const source=this.overview;
    const config=this.policyConfig;
    const request=++this.requestVersion;
    this.projectionReady=false;
    this.projectedCandidates.splice(0);
    if(!source||!config)return;
    if(this.riskEngine.validate(config).length){
      this.policyLoading=false;
      this.policyError=this.copy('Invalid Risk Settings. Original saved alerts remain visible.',
        'إعدادات المخاطر غير صالحة؛ تظل التنبيهات المحفوظة ظاهرة.');
      return;
    }
    this.policyLoading=true;this.policyError='';this.fleetSourceError='';
    // Fetch the WHOLE saved risk population, not just vessels that already have alerts.
    // This is essential to display new High/Critical projected candidates.
    this.subs.add(this.fleet.fetchSaved().subscribe({
      next:snapshot=>{
        if(request!==this.requestVersion)return;
        this.projectFleet(source,snapshot,config,request);
      },
      error:()=>{
        if(request!==this.requestVersion)return;
        this.policyLoading=false;
        this.fleetSourceError=this.copy(
          'Could not retrieve saved fleet risks from Oracle. Projected totals unavailable. Existing alerts are not hidden.',
          'تعذر استرجاع تقييمات الأسطول من Oracle؛ إجماليات المخاطر المتوقعة غير متاحة ولن تُخفى التنبيهات الأصلية.'
        );
        this.policyError=this.fleetSourceError;
        this.projectionReady=false;
        this.projectedCandidates.splice(0);
        this.policyResults.clear();
      }
    }));
  }
  private projectFleet(source:NmcAlertsOverview,snapshot:FleetAiSnapshot,
    config:RiskEngineConfig,request:number):void{
    const assessed=Object.values(snapshot.results||{}).filter(row=>
      row.status==='COMPLETED'&&typeof row.assessmentId==='string'&&
      /^[0-9]{7}$/.test(row.imo));
    const imos=[...new Set([
      ...assessed.map(row=>row.imo),
      ...source.alerts.filter(a=>a.status!=='RESOLVED').map(a=>a.imo)
    ])];
    this.riskPopulation={monitored:snapshot.counts.total,assessed:assessed.length,
      projected:0,pending:snapshot.counts.total-assessed.length,
      normal:0,watch:0,high:0,critical:0,scoreSum:0,averageScore:0};
    if(!imos.length){
      this.policyResults.clear();this.policyLoading=false;this.projectionReady=true;
      return;
    }
    const latestByImo=new Map(assessed.map(r=>[r.imo,r]));
    this.subs.add(forkJoin(imos.map(imo=>
      this.fleet.assessment(imo).pipe(
        map(assessment=>({imo,assessment})),
        catchError(()=>of({imo,assessment:null as FleetAiAssessment|null}))
      )
    )).subscribe({
      next:rows=>{
        if(request!==this.requestVersion)return;
        this.policyLoading=false;
        const nextResults=new Map<string,{
          eligible:boolean;level:string;score:number;reason:string;
          originalLevel:string;originalScore:number;assessmentId:string;
        }>();
        const levels:Record<RiskLevel,number>={Normal:0,Watch:0,High:0,Critical:0};
        let missing=0,sum=0,matched=0;
        for(const {imo,assessment} of rows){
          const expected=latestByImo.get(imo);
          const vessel=getOperationalVesselByImo(imo);
          const ready=assessment&&vessel&&assessment.status==='COMPLETED'&&
            assessment.assessmentId&&
            // Fail closed for new projections if Oracle source changed mid-read.
            (!expected||assessment.assessmentId===expected.assessmentId)&&
            Array.isArray(assessment.signals)&&
            ['movement','inspection','certificate','dataQuality','history'].every(
              factor=>assessment.signals.filter(s=>s.factor===factor&&
                Number.isFinite(s.severity)&&s.severity>=0&&s.severity<=100).length===1);
          if(!ready){missing++;continue;}
          const sev=Object.fromEntries(assessment!.signals.map(s=>[s.factor,s.severity]));
          const projection=this.riskEngine.evaluateFromAiSignals(vessel!,sev as {
            movement:number;inspection:number;certificate:number;dataQuality:number;history:number;
          },config);
          const criticalFinding=assessment!.criticalOpenFinding===true;
          nextResults.set(imo,{
            eligible:criticalFinding||projection.level==='High'||projection.level==='Critical',
            // Independent critical open finding determines alert urgency, NOT the score band.
            level:criticalFinding?'Critical':projection.level,
            score:projection.score,
            reason:criticalFinding?'CRITICAL_OPEN_FINDING':'PROJECTED_RISK_CLASS',
            originalLevel:assessment!.level||'Pending',
            originalScore:assessment!.score??0,
            assessmentId:assessment!.assessmentId!
          });
          if(expected){
            matched++;sum+=projection.score;
            levels[projection.level]++;
          }
        }
        this.policyResults.clear();
        for(const [imo,item] of nextResults)this.policyResults.set(imo,item);
        this.riskPopulation={
          monitored:snapshot.counts.total,assessed:assessed.length,
          projected:matched,pending:snapshot.counts.total-assessed.length,
          normal:levels.Normal,watch:levels.Watch,high:levels.High,
          critical:levels.Critical,scoreSum:sum,
          averageScore:matched?Math.round(sum/matched*10)/10:0
        };
        const activeImos=new Set(source.alerts.filter(a=>a.status!=='RESOLVED').map(a=>a.imo));
        this.projectedCandidates.splice(0);
        for(const [imo,p] of nextResults){
          if(!p.eligible||activeImos.has(imo)||!latestByImo.has(imo))continue;
          this.projectedCandidates.push({
            imo,assessmentId:p.assessmentId,score:p.score,
            level:p.level==='Critical'?'Critical':'High',
            sourceRiskScore:p.originalScore,sourceRiskLevel:p.originalLevel,
            reason:p.reason==='CRITICAL_OPEN_FINDING'?'CRITICAL_OPEN_FINDING':'PROJECTED_RISK_CLASS'
          });
        }
        this.projectedCandidates.sort((a,b)=>
          (b.level==='Critical'?1:0)-(a.level==='Critical'?1:0)||b.score-a.score);
        this.projectionReady=true;
        if(missing){
          this.policyError=this.copy(
            'Some saved assessments could not be verified. Original alerts remain visible for those vessels.',
            'تعذر التحقق من بعض تقييمات السفن؛ تبقى تنبيهاتها الأصلية ظاهرة.');
        }
      },
      error:()=>{
        if(request!==this.requestVersion)return;
        this.policyLoading=false;this.policyError=this.copy(
          'Risk projection unavailable; persisted alerts remain unchanged and visible.',
          'تعذرت إعادة حساب المخاطر؛ تظل التنبيهات الأصلية دون تعديل وظاهرة.');
      }
    }));
  }

  policyFor(item:NmcOperationalAlert){
    return this.policyResults.get(item.imo);
  }
  displaySeverity(item:NmcOperationalAlert):AlertSeverity{
    const band=this.policyFor(item)?.level;
    if(band==='Critical')return 'CRITICAL';
    if(band==='High')return 'HIGH';
    return item.severity;
  }
  triggerDescription(item:NmcOperationalAlert):string{
    const policy=this.policyFor(item);
    if(policy?.reason==='CRITICAL_OPEN_FINDING')return this.copy(
      'Critical open finding — requires human follow-up regardless of the composite risk threshold.',
      'ملاحظة حرجة مفتوحة — تستلزم متابعة بشرية بغض النظر عن حدود تصنيف درجة المخاطر.'
    );
    if(policy)return this.copy(
      'Current Risk Settings project '+policy.score+'/100 · '+policy.level+
        '. The original source assessment remains saved in Oracle.',
      'تنتج إعدادات المخاطر الحالية درجة '+policy.score+'/100 · '+policy.level+
        '. التقييم الأصلي محفوظ في Oracle دون تغيير.'
    );
    return this.copy('Saved risk alert; projected policy eligibility is not independently verified.',
      'تنبيه مخاطر محفوظ؛ لم يتم التحقق من مطابقته للإعدادات الحالية بشكل مستقل.');
  }
  isPolicySuperseded(item:NmcOperationalAlert):boolean{
    return item.status!=='RESOLVED'&&this.policyResults.get(item.imo)?.eligible===false;
  }
  get hiddenByLocalPolicy():number{
    return (this.overview?.alerts||[]).filter(a=>this.isPolicySuperseded(a)).length;
  }
  get policySummary(){
    const source=this.overview?.alerts||[];
    const matching=source.filter(a=>a.status!=='RESOLVED'&&!this.isPolicySuperseded(a));
    const critical=matching.filter(a=>this.displaySeverity(a)==='CRITICAL').length;
    return {
      active:matching.length,
      critical,
      projectedNew:this.projectedCandidates.length,
      projectedCritical:this.projectedCandidates.filter(a=>a.level==='Critical').length,
      eligibleTotal:matching.length+this.projectedCandidates.length,
      unread:matching.filter(a=>a.status==='OPEN'||a.status==='ESCALATED').length,
      escalated:matching.filter(a=>a.status==='ESCALATED').length
    };
  }
  private loadLinkedCases():void{
    this.subs.add(this.cases.list().subscribe({
      next:result=>{this.linkedCases=result.cases||[];},
      error:()=>{this.linkedCases=[];}
    }));
  }
  linkedCase(alert:NmcOperationalAlert):NmcCentralCase|undefined{
    return this.linkedCases.find(c=>c.alertIds.includes(alert.id)&&c.status!=='RESOLVED')
      ||this.linkedCases.find(c=>c.imo===alert.imo&&c.status!=='RESOLVED');
  }
  createCase(alert:NmcOperationalAlert):void{
    if(this.creatingCase||alert.status==='OPEN'||alert.status==='RESOLVED'||
       this.isPolicySuperseded(alert))return;
    const linked=this.linkedCase(alert);
    if(linked){
      void this.router.navigate(['/moei/nmc/vessel',linked.imo,'case']);
      return;
    }
    if(!window.confirm(this.copy(
      'Create the maritime case AND call Airia A01 once to prepare real evidence-backed recommendations? The agent call may incur usage cost. No tasks will be created until you approve the recommendations.',
      'إنشاء الحالة البحرية مع استدعاء Airia A01 مرة واحدة لإعداد توصيات حقيقية مدعومة بالأدلة؟ قد يترتب على الاستدعاء تكلفة استخدام. لن تُنشأ مهام حتى تعتمد التوصيات.'
    )))return;
    this.creatingCase=alert.id;
    this.subs.add(this.cases.createFromAlert(alert.id).subscribe({
      next:result=>{
        this.creatingCase='';
        if(result.case){
          const aiError=result.aiActionPlanStatus==='FAILED'
            ?result.aiActionPlanError?.code||'A01_ACTION_PLAN_UNAVAILABLE':null;
          void this.router.navigate(['/moei/nmc/vessel',result.case.imo,'case'],{
            queryParams:aiError?{aiError}:undefined
          });
        }
        else this.error=this.copy('Case was not returned by the server.','لم يُرجع الخادم بيانات الحالة.');
      },
      error:error=>{
        this.creatingCase='';
        this.error=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.refresh(false);
      }
    }));
  }
  get activeCount():number{return this.policySummary.active;}
  get alertsFiltered():NmcOperationalAlert[]{
    const search=this.query.trim().toLowerCase();
    return (this.overview?.alerts||[]).filter(alert=>{
      const status=this.filter==='ALL'||(
        this.filter==='ACTIVE'?alert.status!=='RESOLVED':alert.status===this.filter);
      const matches=!search||[
        alert.imo,alert.title,alert.detail,alert.sourceAssessmentId||''
      ].some(value=>value.toLowerCase().includes(search));
      return status&&matches&&(this.filter==='ALL'||!this.isPolicySuperseded(alert));
    });
  }
  statusText(value:AlertStatus):string{
    const labels:Record<AlertStatus,[string,string]>={
      OPEN:['New','جديد'],
      ACKNOWLEDGED:['Acknowledged','تم الاستلام'],
      IN_PROGRESS:['In progress','قيد المتابعة'],
      ESCALATED:['Escalated','تم التصعيد'],
      RESOLVED:['Resolved','مغلق']
    };
    const row=labels[value];return this.copy(row[0],row[1]);
  }
  severityText(value:AlertSeverity):string{
    return value==='CRITICAL'?this.copy('Critical','حرج'):this.copy('High','مرتفع');
  }
  actionText(value:AlertAction):string{
    const labels:Record<AlertAction,[string,string]>={
      ACKNOWLEDGE:['Acknowledge','استلام التنبيه'],
      START_FOLLOW_UP:['Start follow-up','بدء المتابعة'],
      ESCALATE:['Escalate to supervisor','تصعيد للمشرف'],
      RESOLVE:['Resolve alert','إغلاق التنبيه']
    };
    const pair=labels[value];return this.copy(pair[0],pair[1]);
  }
  allowed(item:NmcOperationalAlert,action:AlertAction):boolean{
    if(action==='ACKNOWLEDGE')return item.status==='OPEN';
    if(action==='START_FOLLOW_UP')
      return item.status==='ACKNOWLEDGED'||item.status==='ESCALATED';
    if(action==='ESCALATE')
      return ['OPEN','ACKNOWLEDGED','IN_PROGRESS'].includes(item.status);
    return ['ACKNOWLEDGED','IN_PROGRESS','ESCALATED'].includes(item.status);
  }
  act(item:NmcOperationalAlert,action:AlertAction):void{
    if(this.busy||!this.allowed(item,action)||this.isPolicySuperseded(item))return;
    const note=(this.notes[item.id]||'').trim();
    if(action==='RESOLVE'&&!note){
      this.error=this.copy(
        'Enter a resolution reason before closing the alert.',
        'أدخل سبب إغلاق التنبيه قبل اعتماد الإغلاق.');
      return;
    }
    if(action==='ESCALATE'&&!window.confirm(this.copy(
      'Escalate this alert to the NMC Supervisor?',
      'هل تريد تصعيد التنبيه إلى مشرف المركز البحري؟'
    )))return;
    this.error='';this.success='';this.busy=item.id;
    this.subs.add(this.alerts.act(item,action,note).subscribe({
      next:()=>{
        this.busy='';
        this.notes[item.id]='';
        this.success=this.copy('Alert updated and recorded in activity history.',
          'تم تحديث التنبيه وتسجيل الإجراء في سجل الأنشطة.');
        this.refresh(false);
      },
      error:error=>{
        this.busy='';
        this.error=this.alerts.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.refresh(false);
      }
    }));
  }
  toggleDetails(item:NmcOperationalAlert):void{
    if(this.selectedId===item.id){this.selectedId='';this.audit=[];return;}
    this.selectedId=item.id;this.loadHistory(item.id);
  }
  loadHistory(id:string):void{
    this.auditLoading=true;
    this.subs.add(this.alerts.history(id).subscribe({
      next:r=>{if(this.selectedId===id)this.audit=r.history;this.auditLoading=false;},
      error:()=>{this.audit=[];this.auditLoading=false;}
    }));
  }
  auditAction(action:string):string{
    const labels:Record<string,[string,string]>={
      DETECTED:['Risk detected','تم اكتشاف الخطر'],
      ACKNOWLEDGE:['Acknowledged','تم استلام التنبيه'],
      START_FOLLOW_UP:['Follow-up started','بدأت المتابعة'],
      ESCALATE:['Escalated','تم التصعيد'],
      RESOLVE:['Resolved','تم الإغلاق']
    };
    const pair=labels[action];return pair?this.copy(pair[0],pair[1]):action;
  }
}
