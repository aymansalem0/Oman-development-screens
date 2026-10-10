import {LanguageService} from '../services/language.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiCandidate,SiCandidateStatus,SiCandidateTargetingService,
  SiDashboard,SiVesselCandidate,SiPriorityStatus,SiPriorityPreview,SiPriorityRun,SiPriorityRecommendation,SiPriorityPreviewItem}
  from '../services/si-candidate-targeting.service';

type SourceFilter='ALL'|'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
type StatusFilter='ALL'|SiCandidateStatus;
@Component({
  selector:'app-si-candidate-workbench',
  standalone:true,imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-candidate-workbench.component.html',
  styleUrl:'./si-candidate-workbench.component.css'
})
export class SiCandidateWorkbenchComponent implements OnInit{
  loading=false;busy=false;error='';success='';
  dashboard:SiDashboard|null=null;
  sourceFilter:SourceFilter='ALL';statusFilter:StatusFilter='ALL';search='';
  selectedKey='';selectedImo='';
  reviewer='';decisionNote='';editorKey='';publisherKey='';
  priorityStatus:SiPriorityStatus|null=null;
  priorityPreview:SiPriorityPreview|null=null;
  priorityBusy=false;aiError='';aiSuccess='';confirmAiCost=false;
  /** The rule preview also groups workflows by IMO: one visible vessel row. */
  get rulePreviewVessels():{
    imo:string;vesselName:string;minRank:number;regimes:string[];
    workflows:SiPriorityPreviewItem[]
  }[]{
    const vessels=new Map<string,{
      imo:string;vesselName:string;minRank:number;regimes:string[];
      workflows:SiPriorityPreviewItem[]
    }>();
    const byKey=new Map((this.dashboard?.candidates||[]).map(c=>[c.key,c]));
    for(const item of this.priorityPreview?.items||[]){
      const workflow=byKey.get(item.candidateKey);
      let vessel=vessels.get(item.imo);
      if(!vessel){
        vessel={imo:item.imo,vesselName:item.vesselName,
          minRank:item.ruleRank,regimes:[],workflows:[]};
        vessels.set(item.imo,vessel);
      }
      vessel.minRank=Math.min(vessel.minRank,item.ruleRank);
      if(workflow&&!vessel.regimes.includes(workflow.regime))vessel.regimes.push(workflow.regime);
      vessel.workflows.push(item);
    }
    return [...vessels.values()].sort((a,b)=>a.minRank-b.minRank||a.imo.localeCompare(b.imo));
  }
  get savedAiRun():SiPriorityRun|null{
    const r=this.priorityStatus?.latest;
    return r?.status==='SUCCEEDED'&&!r.isStale?r:null;
  }
  get rankingMap():Map<string,SiPriorityRecommendation>{
    return new Map((this.savedAiRun?.recommendations||[]).map(r=>[r.candidateKey,r]));
  }
  aiRecommendation(candidate:SiCandidate|null):SiPriorityRecommendation|null{
    return candidate?(this.rankingMap.get(candidate.key)||null):null;
  }
  ruleRank(candidate:SiCandidate):number|null{
    return this.priorityPreview?.items.find(x=>x.candidateKey===candidate.key)?.ruleRank||null;
  }
  refreshAiStatus():void{
    if(!this.editorKey.trim()){
      this.aiError=this.copy('Editor key is required to view saved AI ranking.',
        'مطلوب مفتاح المحرر لعرض ترتيب AI المحفوظ.');return;
    }
    this.priorityBusy=true;this.aiError='';
    this.api.prioritizationStatus(this.editorKey.trim()).subscribe({
      next:r=>{this.priorityStatus=r;this.priorityBusy=false;},
      error:e=>this.aiFailure(e)
    });
  }
  previewPriority():void{
    if(!this.editorKey.trim()){
      this.aiError=this.copy('Enter Editor key before priority preview.',
        'أدخل مفتاح المحرر قبل معاينة الأولوية.');return;
    }
    this.priorityBusy=true;this.aiError='';this.aiSuccess='';this.confirmAiCost=false;
    this.api.prioritizationPreview(this.editorKey.trim()).subscribe({
      next:r=>{
        this.priorityPreview=r;this.priorityBusy=false;
        this.aiSuccess=this.copy('Rule order preview ready. No AI call made.',
          'تم تجهيز ترتيب القواعد دون تشغيل AI.');
        this.refreshAiStatus();
      },
      error:e=>this.aiFailure(e)
    });
  }
  runAiPriority():void{
    if(!this.priorityPreview||!this.confirmAiCost||!this.editorKey.trim()||
      !this.reviewer.trim()||this.priorityBusy)return;
    if(!window.confirm(this.copy(
      'Call the paid SI-P01 Airia pipeline ONCE for the current candidate snapshot? The result is advisory only.',
      'تشغيل وكيل SI-P01 على Airia مرة واحدة مع احتمال تكلفة تشغيل؟ النتيجة استشارية فقط.')))return;
    this.priorityBusy=true;this.aiError='';this.aiSuccess='';
    this.api.runPrioritization(this.editorKey.trim(),{
      actor:this.reviewer.trim(),expectedSnapshotHash:this.priorityPreview.snapshotHash,
      confirmCost:true
    }).subscribe({
      next:r=>{
        this.priorityBusy=false;this.priorityPreview=null;this.confirmAiCost=false;
        this.aiSuccess=this.copy('AI recommendations saved for human review.',
          'تم حفظ توصيات AI للمراجعة البشرية.');
        this.refreshAiStatus();
      },error:e=>{
        this.aiFailure(e);
        this.refreshAiStatus();
      }
    });
  }
  private aiFailure(e:unknown):void{
    const x=e as {error?:{error?:string};status?:number};
    this.aiError=x?.error?.error||'SI_P01_UNAVAILABLE';
    this.priorityBusy=false;this.aiSuccess='';
  }

  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
  refresh():void{
    if(this.loading)return;
    this.loading=true;this.error='';
    this.api.dashboard().subscribe({
      next:data=>{
        this.dashboard=data;
        if(!data.vesselCandidates.some(v=>v.imo===this.selectedImo)){
          this.selectedImo='';this.selectedKey='';
        }else if(!data.candidates.some(x=>x.key===this.selectedKey)){
          this.selectedKey='';
        }
        this.loading=false;
        if(this.editorKey.trim()&&!this.priorityBusy)this.refreshAiStatus();
      },error:e=>{this.loading=false;this.showError(e);}
    });
  }
  /** One visible row per IMO — sources/events accumulate on the vessel. */
  get vessels():SiVesselCandidate[]{
    const term=this.search.toLowerCase().trim();
    const rank=this.rankingMap;
    return (this.dashboard?.vesselCandidates||[]).filter(v=>
      (this.sourceFilter==='ALL'||v.sourceTypes.includes(this.sourceFilter))&&
      (this.statusFilter==='ALL'||v.workflows.some(w=>w.status===this.statusFilter))&&
      (!term||[v.imo,v.vesselName,v.flag,v.vesselType,...v.regimes,
        ...v.sourceEvents.map(e=>e.sourceReference)].some(text=>
          String(text||'').toLowerCase().includes(term))))
      .sort((a,b)=>{
        const ar=Math.min(...a.candidateKeys.map(key=>rank.get(key)?.effectiveRank??99999));
        const br=Math.min(...b.candidateKeys.map(key=>rank.get(key)?.effectiveRank??99999));
        return ar-br||b.pendingWorkflows-a.pendingWorkflows||a.imo.localeCompare(b.imo);
      });
  }
  get selectedVessel():SiVesselCandidate|null{
    return this.dashboard?.vesselCandidates.find(v=>v.imo===this.selectedImo)||null;
  }
  get selected():SiCandidate|null{
    return this.dashboard?.candidates.find(c=>c.key===this.selectedKey)||null;
  }
  selectVessel(v:SiVesselCandidate):void{
    this.selectedImo=v.imo;
    // Never implicitly approve the wrong legal inspection regime.
    this.selectedKey=v.candidateKeys.length===1?v.candidateKeys[0]:'';
    this.success='';this.decisionNote='';
  }
  selectWorkflow(key:string):void{
    if(!this.selectedVessel?.candidateKeys.includes(key))return;
    this.selectedKey=key;this.decisionNote='';this.success='';
  }
  bestAiRecommendation(v:SiVesselCandidate):SiPriorityRecommendation|null{
    const rankings=v.candidateKeys.map(key=>this.rankingMap.get(key))
      .filter((r):r is SiPriorityRecommendation=>Boolean(r));
    return rankings.sort((a,b)=>a.effectiveRank-b.effectiveRank)[0]||null;
  }
  getWorkflow(key:string):SiCandidate|null{
    return this.dashboard?.candidates.find(c=>c.key===key)||null;
  }
  trackVessel(_:number,v:SiVesselCandidate):string{return v.imo;}
  private showError(e:unknown):void{
    const v=e as {error?:{error?:string};status?:number};
    this.error=v?.error?.error||'Request failed. Check API, Oracle migration 009 and access permissions.';
    this.success='';this.busy=false;
  }
  decide(action:'APPROVE'|'DEFER'|'REJECT'):void{
    const c=this.selected;
    if(!c||this.busy)return;
    if(!this.reviewer.trim()||this.decisionNote.trim().length<4){
      this.error='Enter reviewer name and an auditable reason (at least 4 characters).';return;
    }
    const key=action==='APPROVE'?this.publisherKey:this.editorKey;
    if(!key.trim()){this.error=action==='APPROVE'?
      'Publisher / supervisor key is required to create an inspection case.':
      'Editor key is required to record a deferral or rejection.';return;}
    if(!window.confirm(action==='APPROVE'?
      'Create an approved Smart Inspection POC case? This will NOT trigger Airia or change NMC risk.':
      'Record the '+action.toLowerCase()+' decision with its audit trail?'))return;
    this.busy=true;this.error='';this.success='';
    this.api.decision({candidateKey:c.key,imo:c.imo,action,actor:this.reviewer.trim(),
      note:this.decisionNote.trim()},key.trim()).subscribe({
      next:()=>{this.busy=false;this.success='Decision saved centrally: '+action;
        this.decisionNote='';this.refresh();},
      error:e=>this.showError(e)
    });
  }
  statusText(x:string):string{
    const labels:Record<string,string>={
      'PENDING_REVIEW':'بانتظار المراجعة',
      'DEFERRED':'مؤجلة',
      'REJECTED':'مرفوضة',
      'INSPECTION_CREATED':'تم إنشاء المعاينة',
      'EXTERNALLY_SCHEDULED':'مجدولة مسبقًا',
      'MANUAL_REVIEW':'تتطلب مراجعة بشرية',
      'MANDATORY':'إلزامية',
      'PRIORITY':'ذات أولوية',
      'STANDARD':'عادية',
      'RISK_UNASSESSED':'بدون تقييم مخاطر',
      'NMC_CASE':'إحالة المركز البحري',
      'SERVICE_REQUEST':'طلب خدمة',
      'PSC_PORT_CALL':'نداء ميناء PSC',
      'PORT_STATE_CONTROL':'تفتيش دولة الميناء',
      'FOCUSED_INSPECTION':'معاينة مركزة',
      'UAE_SERVICE_INSPECTION':'معاينة خدمة بحرية',
      'FOLLOW_UP_INSPECTION':'معاينة متابعة',
      'High':'مرتفع','Critical':'حرج','Watch':'مراقبة','Normal':'عادي',
      'APPROVE':'اعتماد','DEFER':'تأجيل','REJECT':'رفض',
      'REVIEW_REQUIRED':'تتطلب مراجعة',
      'SUCCEEDED':'مكتمل','FAILED':'فشل'
    };
    return this.lang.isArabic?(labels[x]||x.replaceAll('_',' ')):x.replaceAll('_',' ');
  }
  short(id:string|null|undefined):string{return (id||'—').slice(0,12);}
  trackKey(_:number,c:SiCandidate):string{return c.key;}
}
