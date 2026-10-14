import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import {
  ApplicationState, ReadinessStatus, SdbPocService, Seafarer
} from '../services/sdb-poc.service';

type Page = 'overview' | 'registry' | 'company' | 'holds' | 'applications' | 'audit';
type Persona = 'OPERATIONS' | 'COMPANY' | 'SELF';

@Component({
  selector:'app-moei-seafarer-management',
  standalone:true,
  imports:[CommonModule,FormsModule,NmcNavigationComponent],
  templateUrl:'./moei-seafarer-management.component.html',
  styleUrl:'./moei-seafarer-management.component.css'
})
export class MoeiSeafarerManagementComponent {
  page:Page='overview';
  persona:Persona='OPERATIONS';
  selectedId='SF-002';
  companyFilter='Ocean Bridge Shipping';
  search='';
  statusFilter='ALL';
  notice='';
  activeTab:'readiness'|'evidence'|'history'='readiness';

  readonly menus: {id:Page;label:string;icon:string}[]=[
    {id:'overview',label:'Readiness Overview',icon:'◫'},
    {id:'registry',label:'Seafarer Registry',icon:'♧'},
    {id:'company',label:'Company Portfolio',icon:'▤'},
    {id:'holds',label:'HOLD Resolution',icon:'◷'},
    {id:'applications',label:'SDB Applications',icon:'▣'},
    {id:'audit',label:'Audit & Evidence',icon:'☷'}
  ];
  readonly companies=['Ocean Bridge Shipping','Harbour Marine LLC','National Sea Transport'];

  constructor(public store:SdbPocService) {}

  get selected(): Seafarer | undefined { return this.store.getSeafarer(this.selectedId); }
  get rows(): Seafarer[] {
    const q=this.search.toLowerCase().trim();
    return this.store.seafarers.filter(row => {
      if(this.page==='company' && (row.category!=='FOREIGN'||row.company!==this.companyFilter)){return false;}
      if(this.page==='holds' && this.store.readiness(row)==='READY_TO_APPLY'){return false;}
      if(this.page==='applications' && row.applicationState==='NOT_STARTED'){return false;}
      if(this.statusFilter!=='ALL' && this.store.readiness(row)!==this.statusFilter){return false;}
      return !q || [row.name,row.id,row.sid||'',row.company||'',row.nationality].some(v=>v.toLowerCase().includes(q));
    });
  }
  get total():number {return this.store.seafarers.length;}
  get ready():number {return this.store.seafarers.filter(x=>this.store.readiness(x)==='READY_TO_APPLY').length;}
  get hold():number {return this.store.seafarers.filter(x=>this.store.readiness(x)==='EXTERNAL_HOLD').length;}
  get blocked():number {return this.store.seafarers.filter(x=>this.store.readiness(x)!=='READY_TO_APPLY').length;}
  get issued():number {return this.store.seafarers.filter(x=>x.applicationState==='ISSUED').length;}

  status(row:Seafarer):ReadinessStatus {return this.store.readiness(row);}
  label(status: ReadinessStatus | ApplicationState):string {
    const values:Record<string,string>={
      READY_TO_APPLY:'Ready to Apply',EXTERNAL_HOLD:'External HOLD',
      MISSING_ENDORSEMENT:'Endorsement Required',PENDING_VERIFICATION:'Pending Source',
      REQUIREMENT_MISSING:'Requirements Missing',NOT_STARTED:'Not Started',
      INVITED:'Invitation Queued (Mock)',SUBMITTED:'Submitted (Mock)',
      PAYMENT_SIMULATED:'Payment (Mock)',ISSUED:'Issued (Mock)'
    };
    return values[status] || status;
  }
  badgeClass(status:ReadinessStatus):string {
    if(status==='READY_TO_APPLY'){return 'positive';}
    if(status==='PENDING_VERIFICATION'){return 'pending';}
    return 'caution';
  }
  displayCategory(row:Seafarer):string {
    return row.category==='FOREIGN'?'Foreign · Company submits':'UAE · Self-service';
  }
  open(row:Seafarer):void {
    this.selectedId=row.id;
    this.activeTab='readiness';
    this.notice='';
    this.page='registry';
  }
  navigate(next:Page):void {
    this.page=next;
    this.statusFilter='ALL';
    this.search='';
    this.notice='';
  }
  act(action:'HOLD'|'MEDICAL'|'COP'|'ENDORSEMENT'|'SOURCE',row:Seafarer):void {
    if(this.persona!=='OPERATIONS'){this.notice='Demo source update tools are only available in the operations persona.';return;}
    this.store.simulateSourceUpdate(row,action);
    this.notice='Synthetic source update applied. Readiness recalculated. No external API was called.';
  }
  invite(row:Seafarer):void {
    if(this.persona!=='OPERATIONS'){this.notice='For this demonstration, readiness invitations are triggered by the mock system operator.';return;}
    this.notice=this.store.sendInvitation(row);
  }
  submit(row:Seafarer):void {this.notice=this.store.submit(row,this.persona);}
  payment(row:Seafarer):void {
    if(this.persona!=='OPERATIONS'){this.notice='Demo payment provider action requires the operations persona.';return;}
    this.notice=this.store.simulatePayment(row);
  }
  issue(row:Seafarer):void {
    if(this.persona!=='OPERATIONS'){this.notice='Automated demo issuance is run by the system/operations persona.';return;}
    this.notice=this.store.issue(row);
  }
  restart():void {
    this.store.reset();this.selectedId='SF-002';this.notice='Synthetic dataset reset to baseline.';
  }
  get canApply():boolean {
    return !!this.selected && this.store.readiness(this.selected)==='READY_TO_APPLY' &&
      this.selected.applicationState==='INVITED' &&
      (this.selected.category==='FOREIGN'?this.persona==='COMPANY':this.persona==='SELF');
  }
  get canSourceUpdate():boolean {return this.persona==='OPERATIONS';}
}
