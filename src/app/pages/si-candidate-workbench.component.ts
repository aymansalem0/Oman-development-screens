import {LanguageService} from '../services/language.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SiCandidate,SiCandidateStatus,SiCandidateTargetingService,
  SiDashboard,SiImpact,SiRegime} from '../services/si-candidate-targeting.service';

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
  selectedKey='';
  reviewer='';decisionNote='';editorKey='';publisherKey='';
  threshold=65;policyReason='';
  impact:SiImpact|null=null;
  eventForm:{
    sourceType:'SERVICE_REQUEST'|'PSC_PORT_CALL';
    sourceEventId:string;sourceReference:string;imo:string;port:string;eta:string;
    sourceApprovalStatus:'UNVERIFIED'|'SOURCE_REVIEWED';note:string;
  }={
    sourceType:'SERVICE_REQUEST',sourceEventId:'',sourceReference:'',imo:'',port:'',eta:'',
    sourceApprovalStatus:'UNVERIFIED',note:''
  };
  constructor(private readonly api:SiCandidateTargetingService,public readonly lang:LanguageService){}
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
  refresh():void{
    if(this.loading)return;
    this.loading=true;this.error='';
    this.api.dashboard().subscribe({
      next:data=>{
        this.dashboard=data;this.threshold=data.policy.config.riskPriorityThreshold;
        if(!data.candidates.some(x=>x.key===this.selectedKey))this.selectedKey='';
        this.loading=false;
      },error:e=>{this.loading=false;this.showError(e);}
    });
  }
  get candidates():SiCandidate[]{
    const term=this.search.toLowerCase().trim();
    return (this.dashboard?.candidates||[]).filter(c=>
      (this.sourceFilter==='ALL'||c.events.some(e=>e.sourceType===this.sourceFilter))&&
      (this.statusFilter==='ALL'||c.status===this.statusFilter)&&
      (!term||[c.imo,c.vesselName,c.flag,c.regime,
        ...c.events.map(e=>e.sourceReference)].some(s=>String(s||'').toLowerCase().includes(term))));
  }
  get selected():SiCandidate|null{
    return this.dashboard?.candidates.find(c=>c.key===this.selectedKey)||null;
  }
  select(c:SiCandidate):void{this.selectedKey=c.key;this.success='';this.decisionNote='';}
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
  onEventSourceChange():void{
    this.eventForm.sourceApprovalStatus='UNVERIFIED';
  }
  addEvent():void{
    if(this.busy)return;
    if(!this.editorKey.trim()){this.error='Editor key required to record a simulated source event.';return;}
    if(!this.reviewer.trim()){this.error='Enter a source event operator name.';return;}
    const f=this.eventForm,requestedRegime:SiRegime=f.sourceType==='PSC_PORT_CALL'?
      'PORT_STATE_CONTROL':'UAE_SERVICE_INSPECTION';
    this.busy=true;this.error='';this.success='';
    this.api.addEvent({...f,requestedRegime,provenance:'POC_SIMULATOR',
      evidenceIds:[],createdBy:this.reviewer.trim()},this.editorKey.trim()).subscribe({
      next:()=>{this.busy=false;this.success='Simulated source event saved. Officer review required.';
        this.eventForm.sourceEventId='';this.eventForm.sourceReference='';this.refresh();},
      error:e=>this.showError(e)
    });
  }
  previewRules():void{
    if(!this.editorKey.trim()){this.error='Editor key required for impact preview.';return;}
    this.busy=true;this.error='';this.impact=null;
    this.api.preview({riskPriorityThreshold:Number(this.threshold),
      includeMissingRiskInReview:true},this.editorKey.trim()).subscribe({
      next:r=>{this.impact=r;this.busy=false;},
      error:e=>this.showError(e)
    });
  }
  publishRules():void{
    if(!this.dashboard||this.busy)return;
    if(!this.publisherKey.trim()||!this.reviewer.trim()||this.policyReason.trim().length<8){
      this.error='Publisher key, reviewer and reason (at least 8 characters) are required.';return;
    }
    if(!this.impact){this.error='Run Impact Preview before publishing.';return;}
    if(!window.confirm('Publish a NEW targeting priority version? Eligibility, NMC risk and AI signals will not change.'))return;
    this.busy=true;this.error='';
    this.api.publish({config:{riskPriorityThreshold:Number(this.threshold),includeMissingRiskInReview:true},
      expectedVersion:this.dashboard.policy.version,publishedBy:this.reviewer.trim(),
      reason:this.policyReason.trim()},this.publisherKey.trim()).subscribe({
      next:()=>{this.busy=false;this.impact=null;this.policyReason='';
        this.success='New targeting priority version published. No AI calls made.';this.refresh();},
      error:e=>this.showError(e)
    });
  }
  statusText(x:string):string{return x.replaceAll('_',' ');}
  short(id:string|null|undefined):string{return (id||'—').slice(0,12);}
  trackKey(_:number,c:SiCandidate):string{return c.key;}
}
