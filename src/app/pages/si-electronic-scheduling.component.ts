import {LanguageService} from '../services/language.service';
import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {NmcInspectionReferral} from '../services/nmc-cases.service';
import {getOperationalVesselByImo} from '../data/nmc-expanded-vessel-catalog';

interface ErpStatus{
  ready:boolean;source:string;snapshotId:string|null;importedAt:string|null;
  counts:Record<string,number>|null;
}
interface Port{port_id:string;port_name:string;}
interface Option{
  optionId:string;inspectorId:string;inspectorName:string;portId:string;portName:string;
  startLocal:string;endLocal:string;score:number;travelMinutes:number;crossPort:boolean;
  approval:'AUTO_ELIGIBLE'|'MANUAL_APPROVAL_REQUIRED';approvalReasons:string[];
}
interface Proposal{
  id:string;status:string;input:{imo:string;sourceLevel:string};options:Option[];
  exclusions:{inspectorId:string;reasons:string[]}[];erpSnapshotId:string;
  policyRevision:number;expiresAt:string;confirmed?:unknown;
}
interface SiPolicy{
  revision:number;config:{
    approvalMode:'HYBRID'|'AUTO'|'MANUAL';
    autoApproveNmcReferrals:boolean;autoMaxRiskLevel:string;
    allowCrossPort:boolean;crossPortRequiresApproval:boolean;
    pendingLeaveRequiresApproval:boolean;maxSnapshotAgeHours:number;
    slotMinutes:number;maxHorizonDays:number;maxOptions:number;prepMinutes:number;
    travelBufferMinutes:number;maxDailyInspections:number;
    weights:{earliness:number;travel:number;workload:number;availability:number;continuity:number}
  };
}
@Component({
  selector:'app-si-electronic-scheduling',standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./si-electronic-scheduling.component.html',
  styleUrl:'./si-electronic-scheduling.component.css'
})
export class SiElectronicSchedulingComponent implements OnInit{
  busy=false;error='';success='';
  erp:ErpStatus|null=null;
  ports:Port[]=[];referrals:NmcInspectionReferral[]=[];
  policy:SiPolicy|null=null;
  draft:SiPolicy['config']|null=null;
  proposal:Proposal|null=null;
  selectedReferralId='';selectedOptionId='';
  portId='JEA';vesselType='CARGO';regime='FOCUSED';durationMinutes=180;
  earliestLocal='';deadlineLocal='';
  editorKey='';publisherKey='';
  private readonly api='/api/si';
  constructor(private readonly http:HttpClient,public readonly lang:LanguageService){
    const now=Date.now()+DAY;
    this.earliestLocal=new Date(now+4*3600000).toISOString().slice(0,10)+'T08:00';
    this.deadlineLocal=new Date(now+2*DAY+4*3600000).toISOString().slice(0,10)+'T18:00';
  }
  copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
  ngOnInit():void{this.refresh();}
  refresh():void{
    this.http.get<ErpStatus&{status:string}>(this.api+'/erp/status').subscribe({
      next:r=>{this.erp=r;if(r.ready)this.fetchPorts();},
      error:e=>this.showError(e)
    });
    this.http.get<{referrals:NmcInspectionReferral[]}>(this.api+'/scheduling/referrals')
      .subscribe({next:r=>this.referrals=r.referrals,
        error:e=>this.showError(e)});
    this.http.get<{policy:SiPolicy}>(this.api+'/scheduling/policy').subscribe({
      next:r=>{this.policy=r.policy;this.draft=JSON.parse(JSON.stringify(r.policy.config));},
      error:e=>this.showError(e)
    });
  }
  fetchPorts():void{
    this.http.get<{ports:Port[]}>(this.api+'/erp/ports').subscribe({
      next:r=>{this.ports=r.ports;if(!r.ports.some(p=>p.port_id===this.portId)&&r.ports.length)
        this.portId=r.ports[0].port_id;},error:e=>this.showError(e)
    });
  }
  selectReferral(id:string):void{
    this.selectedReferralId=id;this.proposal=null;this.selectedOptionId='';
    const ref=this.referrals.find(r=>r.id===id);
    if(ref){
      const vessel=getOperationalVesselByImo(ref.imo);
      const type=String(vessel?.type||'').toUpperCase();
      this.vesselType=type.includes('TANKER')?'TANKER':type.includes('PASSENGER')?'PASSENGER':
        type.includes('CARGO')||type.includes('CONTAINER')||type.includes('BULK')?'CARGO':'OTHER';
    }
  }
  private key(publisher:boolean):string|null{
    let key=publisher?this.publisherKey:this.editorKey;
    if(!key){
      key=window.prompt(publisher?'Supervisor / publisher key':'Operator / editor key')?.trim()||'';
      if(!key)return null;
      if(publisher)this.publisherKey=key;else this.editorKey=key;
    }
    return key;
  }
  private headers(publisher=false):HttpHeaders|null{
    const key=this.key(publisher);return key?new HttpHeaders({'X-NMC-DASHBOARD-KEY':key}):null;
  }
  private showError(error:unknown):void{
    const e=error as {error?:{error?:string};status?:number};
    if(e?.status===403){this.editorKey='';this.publisherKey='';}
    this.error=e?.error?.error||'Operation unavailable. Check backend and access key.';
    this.success='';this.busy=false;
  }
  generate():void{
    if(!this.erp?.ready){this.error='Import ERP Excel first.';return;}
    if(!this.selectedReferralId){this.error='Select a centrally approved NMC inspection referral.';return;}
    const headers=this.headers();if(!headers)return;
    this.busy=true;this.error='';this.success='';this.proposal=null;
    const body={referralId:this.selectedReferralId,portId:this.portId,
      earliestLocal:this.earliestLocal.replace('T',' '),
      deadlineLocal:this.deadlineLocal.replace('T',' '),
      vesselType:this.vesselType,regime:this.regime,durationMinutes:Number(this.durationMinutes)};
    this.http.post<{proposal:Proposal;autoConfirmed:boolean}>(this.api+'/scheduling/proposals',body,{headers})
      .subscribe({next:r=>{
        this.proposal=r.proposal;
        this.selectedOptionId=r.proposal.options[0]?.optionId||'';
        this.busy=false;
        this.success=r.autoConfirmed?'Schedule auto-confirmed by published policy.':
          'Deterministic proposal generated. Select an option for supervisor approval.';
        if(r.autoConfirmed)this.refresh();
      },error:e=>this.showError(e)});
  }
  confirm():void{
    if(!this.proposal||!this.selectedOptionId)return;
    const selected=this.proposal.options.find(o=>o.optionId===this.selectedOptionId);
    const manual=selected?.approval==='MANUAL_APPROVAL_REQUIRED';
    const headers=this.headers(manual);if(!headers)return;
    if(!window.confirm(manual?'Approve and confirm this inspection assignment as supervisor?':
      'Confirm the eligible inspection assignment?'))return;
    this.busy=true;this.error='';this.success='';
    this.http.post(this.api+'/scheduling/proposals/'+this.proposal.id+'/confirm',
      {optionId:this.selectedOptionId},{headers}).subscribe({
      next:()=>{this.busy=false;this.proposal!.status='CONFIRMED';
        this.success='Confirmed: NMC referral and central maritime case updated.';this.refresh();},
      error:e=>this.showError(e)
    });
  }
  publishPolicy():void{
    if(!this.policy||!this.draft)return;
    const headers=this.headers(true);if(!headers)return;
    const reason=window.prompt('Reason for scheduling policy change (min 8 chars):')?.trim()||'';
    if(reason.length<8)return;
    const by=window.prompt('Publisher name / role:')?.trim()||'';
    if(!by)return;
    this.busy=true;this.error='';this.success='';
    this.http.post(this.api+'/scheduling/policy/publish',
      {expectedRevision:this.policy.revision,reason,publishedBy:by,config:this.draft},
      {headers}).subscribe({
        next:()=>{this.busy=false;this.success='New scheduling policy version published.';this.refresh();},
        error:e=>this.showError(e)
      });
  }
  get selectedReferral():NmcInspectionReferral|undefined{
    return this.referrals.find(r=>r.id===this.selectedReferralId);
  }
  trackOption(_:number,item:Option):string{return item.optionId;}
  shortId(id:string|null|undefined):string{return id?id.slice(0,10)+'…':'—';}
}
const DAY=86400000;
