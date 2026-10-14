import {CommonModule} from '@angular/common';
import {Component,OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {Subscription} from 'rxjs';
import {NmcNavigationComponent} from '../components/nmc-navigation.component';
import {SdbPocService,Seafarer,EvidenceCheck} from '../services/sdb-poc.service';
import {DemoPersona,SdbJourneyService} from '../services/sdb-journey.service';

type WorkflowScreen =
  'overview'|'profile'|'verification'|'exceptions'|'invitation'|
  'application'|'authorization'|'payment'|'issuance'|'fulfilment'|'audit';

@Component({
  selector:'app-moei-sdb-workflow',
  standalone:true,
  imports:[CommonModule,FormsModule,RouterLink,NmcNavigationComponent],
  templateUrl:'./moei-sdb-workflow.component.html',
  styleUrl:'./moei-sdb-workflow.component.css'
})
export class MoeiSdbWorkflowComponent implements OnDestroy {
  selectedId='SF-002';
  activeScreen:WorkflowScreen='overview';
  persona:DemoPersona='OPERATIONS';
  feedback='';
  showDecisionEvidence=false;
  private readonly subscription:Subscription;

  readonly screens:{id:WorkflowScreen;title:string;caption:string;number:string}[]=[
    {id:'overview',title:'Journey Overview',caption:'Case orchestration',number:'01'},
    {id:'profile',title:'Seafarer 360',caption:'Identity & service',number:'02'},
    {id:'verification',title:'Source Verification',caption:'8 eligibility checks',number:'03'},
    {id:'exceptions',title:'HOLD & Exceptions',caption:'Source-owned recovery',number:'04'},
    {id:'invitation',title:'Ready-to-Apply',caption:'Applicant invitation',number:'05'},
    {id:'application',title:'SDB Application',caption:'Applicant submission',number:'06'},
    {id:'authorization',title:'Rule Authorization',caption:'Deterministic decision',number:'07'},
    {id:'payment',title:'Payment',caption:'Gateway callback',number:'08'},
    {id:'issuance',title:'SDB Issuance',caption:'SID & versioning',number:'09'},
    {id:'fulfilment',title:'Print & Delivery',caption:'Physical fulfilment',number:'10'},
    {id:'audit',title:'Audit & Monitoring',caption:'Evidence & history',number:'11'}
  ];

  readonly sourceActions:[
    {id:'COP'|'MEDICAL'|'HOLD'|'ENDORSEMENT'|'SOURCE';name:string;owner:string}
  ]=[
    {id:'COP',name:'Receive missing CoP',owner:'Maritime Academy'},
    {id:'MEDICAL',name:'Receive medical clearance',owner:'MARASI'},
    {id:'HOLD',name:'Receive HOLD release',owner:'Academy / Employer'},
    {id:'ENDORSEMENT',name:'Receive endorsement',owner:'Endorsement Registry'},
    {id:'SOURCE',name:'Restore source connection',owner:'Source integration'}
  ];

  constructor(
    public readonly registry:SdbPocService,
    public readonly workflow:SdbJourneyService,
    route:ActivatedRoute,
    private readonly router:Router
  ){
    this.subscription=route.paramMap.subscribe(params=>{
      this.selectedId=params.get('id')||'SF-002';
      this.feedback='';
      this.activeScreen='overview';
    });
  }

  ngOnDestroy():void{this.subscription.unsubscribe();}
  get seafarer():Seafarer|undefined{return this.registry.getSeafarer(this.selectedId);}
  get case(){
    const s=this.seafarer;
    return s?this.workflow.caseOf(s):undefined;
  }
  get evidence():EvidenceCheck[]{return this.seafarer?this.registry.evidence(this.seafarer):[];}
  get blockers():EvidenceCheck[]{return this.seafarer?this.registry.blockers(this.seafarer):[];}
  get passing():number{return this.evidence.filter(e=>e.result==='PASS'||e.result==='NOT_APPLICABLE').length;}
  get failures():number{return this.evidence.filter(e=>e.result==='FAIL').length;}
  get pending():number{return this.evidence.filter(e=>e.result==='PENDING').length;}
  get isReady():boolean{return !!this.seafarer&&this.registry.readiness(this.seafarer)==='READY_TO_APPLY';}
  get isOperations():boolean{return this.persona==='OPERATIONS';}
  get applicantPersona():DemoPersona{return this.seafarer?.category==='FOREIGN'?'COMPANY':'SELF';}
  get canSubmit():boolean{return !!this.seafarer&&this.persona===this.applicantPersona;}
  get appState():string{return this.seafarer?.applicationState||'NOT_STARTED';}
  get status():string{return this.seafarer?this.registry.readiness(this.seafarer):'UNKNOWN';}
  get serviceTitle():string{return this.seafarer?.service==='FIRST_ISSUE'?'First Issue of Seaman’s Discharge Book':'Renewal of Seaman’s Discharge Book';}
  get milestones():{label:string;done:boolean;detail:string}[]{
    const s=this.seafarer,c=this.case;
    if(!s||!c)return [];
    const application=s.applicationState;
    return [
      {label:'Source readiness',done:this.isReady,detail:this.status.replace(/_/g,' ')},
      {label:'Invitation',done:application!=='NOT_STARTED',detail:'Secure link · notification mock'},
      {label:'Application',done:['SUBMITTED','PAYMENT_SIMULATED','ISSUED'].includes(application),detail:'Applicant confirmation'},
      {label:'Rule authorization',done:c.decision==='AUTHORISED',detail:'Final deterministic checks'},
      {label:'Payment callback',done:!!c.paymentReference,detail:'No real fee or transaction'},
      {label:'SDB issuance',done:application==='ISSUED',detail:'Synthetic SID/version'},
      {label:'Print production',done:c.printState==='PRINTED',detail:'Mock print facility'},
      {label:'Handover',done:c.deliveryState==='COMPLETED',detail:'Collection / courier mock'}
    ];
  }
  get nextAction():string{return this.seafarer?this.workflow.nextRequiredAction(this.seafarer):'Select a seafarer';}
  get roleName():string{
    return this.persona==='OPERATIONS'?'MOEI operations simulator':this.persona==='COMPANY'?'Company representative simulator':'UAE seafarer simulator';
  }

  selectSeafarer(id:string):void{
    this.router.navigate(['/moei/seafarers/sdb',id]);
  }
  show(screen:WorkflowScreen):void{
    this.activeScreen=screen;
    this.feedback='';
  }
  next():void{
    const i=this.screens.findIndex(x=>x.id===this.activeScreen);
    if(i<this.screens.length-1)this.show(this.screens[i+1].id);
  }
  prev():void{
    const i=this.screens.findIndex(x=>x.id===this.activeScreen);
    if(i>0)this.show(this.screens[i-1].id);
  }
  source(id:'COP'|'MEDICAL'|'HOLD'|'ENDORSEMENT'|'SOURCE'):void{
    if(this.seafarer)this.feedback=this.workflow.incomingSourceEvent(this.seafarer,id,this.persona);
  }
  canSource(id:string):boolean{
    const s=this.seafarer;
    if(!s||!this.isOperations)return false;
    if(id==='COP')return s.copCount<s.requiredCopCount;
    if(id==='MEDICAL')return !s.medicalValid;
    if(id==='HOLD')return s.clearanceStatus==='HOLD';
    if(id==='ENDORSEMENT')return s.category==='FOREIGN'&&!s.endorsementValid;
    if(id==='SOURCE')return !s.sourceAvailable;
    return false;
  }
  invite():void{if(this.seafarer)this.feedback=this.workflow.invite(this.seafarer);}
  submit():void{if(this.seafarer)this.feedback=this.workflow.submit(this.seafarer,this.persona);}
  authorize():void{if(this.seafarer)this.feedback=this.workflow.authorise(this.seafarer,this.persona);}
  pay():void{if(this.seafarer)this.feedback=this.workflow.pay(this.seafarer,this.persona);}
  issue():void{if(this.seafarer)this.feedback=this.workflow.issue(this.seafarer,this.persona);}
  print():void{if(this.seafarer)this.feedback=this.workflow.queuePrint(this.seafarer,this.persona);}
  printed():void{if(this.seafarer)this.feedback=this.workflow.markPrinted(this.seafarer,this.persona);}
  dispatch():void{if(this.seafarer)this.feedback=this.workflow.dispatch(this.seafarer,this.persona);}
  complete():void{if(this.seafarer)this.feedback=this.workflow.completeDelivery(this.seafarer,this.persona);}
  reset():void{
    this.registry.reset();this.workflow.reset();this.feedback='All synthetic records and events were reset.';
    this.activeScreen='overview';
  }
  displayEventTime(value:string):string{
    return value?new Date(value).toLocaleString('en-GB'):'—';
  }
}
