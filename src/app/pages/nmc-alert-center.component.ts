import {CommonModule} from '@angular/common';
import {Component,OnDestroy,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router,RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {LanguageService} from '../services/language.service';
import {
  NmcAlertsService,NmcOperationalAlert,NmcAlertAudit,
  NmcAlertsOverview,AlertAction,AlertSeverity,AlertStatus
} from '../services/nmc-alerts.service';
import {NmcCasesService,NmcCentralCase} from '../services/nmc-cases.service';

type StatusFilter='ACTIVE'|'ALL'|'OPEN'|'ESCALATED'|'RESOLVED';
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

  constructor(public lang:LanguageService,private readonly alerts:NmcAlertsService,
    private readonly cases:NmcCasesService,private readonly router:Router){}
  ngOnInit():void{
    this.refresh();
    this.poller=setInterval(()=>{if(!this.busy)this.refresh(false);},30000);
  }
  ngOnDestroy():void{
    this.subs.unsubscribe();
    if(this.poller)clearInterval(this.poller);
  }
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  refresh(spinner=true):void{
    if(spinner)this.loading=true;
    this.subs.add(this.alerts.overview().subscribe({
      next:data=>{
        this.overview=data;
        this.loading=false;
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
    if(this.creatingCase||alert.status==='OPEN'||alert.status==='RESOLVED')return;
    const linked=this.linkedCase(alert);
    if(linked){
      void this.router.navigate(['/moei/nmc/vessel',linked.imo,'case']);
      return;
    }
    if(!window.confirm(this.copy(
      'Open a central maritime case linked to this acknowledged alert?',
      'فتح حالة بحرية مركزية مرتبطة بهذا التنبيه المستلم؟'
    )))return;
    this.creatingCase=alert.id;
    this.subs.add(this.cases.createFromAlert(alert.id).subscribe({
      next:result=>{
        this.creatingCase='';
        if(result.case)void this.router.navigate(['/moei/nmc/vessel',result.case.imo,'case']);
        else this.error=this.copy('Case was not returned by the server.','لم يُرجع الخادم بيانات الحالة.');
      },
      error:error=>{
        this.creatingCase='';
        this.error=this.cases.readableError(error,this.lang.isArabic);
        if(error?.status===409)this.refresh(false);
      }
    }));
  }
  get activeCount():number{return this.overview?.summary.active||0;}
  get alertsFiltered():NmcOperationalAlert[]{
    const search=this.query.trim().toLowerCase();
    return (this.overview?.alerts||[]).filter(alert=>{
      const status=this.filter==='ALL'||(
        this.filter==='ACTIVE'?alert.status!=='RESOLVED':alert.status===this.filter);
      const matches=!search||[
        alert.imo,alert.title,alert.detail,alert.sourceAssessmentId||''
      ].some(value=>value.toLowerCase().includes(search));
      return status&&matches;
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
    if(this.busy||!this.allowed(item,action))return;
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
