import { Injectable } from '@angular/core';
import { SdbPocService, Seafarer, EvidenceCheck } from './sdb-poc.service';

/**
 * Presentation-only SDB workflow orchestration.
 * All users, payments, invitations, decisions, production/printing and delivery
 * are SYNTHETIC. No ministry transaction or integration is performed.
 * Regulatory auto-authorisation needs formal MOEI approval before go-live.
 */
export type DemoPersona = 'OPERATIONS' | 'COMPANY' | 'SELF';
export type DemoDeliveryMode = 'COLLECTION' | 'COURIER';
export type DemoDecision = 'NOT_EVALUATED' | 'AUTHORISED' | 'FAILED';
export type PrintState = 'NOT_REQUESTED' | 'QUEUED' | 'PRINTED';
export type DeliveryState = 'NOT_STARTED' | 'READY_FOR_COLLECTION' | 'DISPATCHED' | 'COMPLETED';

export interface SdbJourneyRecord {
  seafarerId: string;
  applicantConfirmed: boolean;
  documentsReviewed: boolean;
  declarationAccepted: boolean;
  contactEmail: string;
  contactPhone: string;
  deliveryMode: DemoDeliveryMode;
  deliveryAddress: string;
  decision: DemoDecision;
  decisionTime: string | null;
  decisionRuleVersion: string | null;
  decisionEvidence: EvidenceCheck[];
  paymentReference: string | null;
  printState: PrintState;
  printReference: string | null;
  deliveryState: DeliveryState;
  deliveryTime: string | null;
  timeline: {time:string;stage:string;actor:string;description:string}[];
}

@Injectable({providedIn:'root'})
export class SdbJourneyService {
  private readonly records: Record<string, SdbJourneyRecord> = {};
  private counter=0;
  constructor(private readonly registry:SdbPocService){}

  caseOf(row:Seafarer):SdbJourneyRecord {
    if(!this.records[row.id]){
      this.records[row.id]={
        seafarerId:row.id, applicantConfirmed:false, documentsReviewed:false,
        declarationAccepted:false, contactEmail:'', contactPhone:'',
        deliveryMode:'COLLECTION', deliveryAddress:'', decision:'NOT_EVALUATED',
        decisionTime:null, decisionRuleVersion:null, decisionEvidence:[],
        paymentReference:null,printState:'NOT_REQUESTED',printReference:null,
        deliveryState:'NOT_STARTED',deliveryTime:null,timeline:[{
          time:this.now(),stage:'DISCOVERY',actor:'MOCK source registry',
          description:'Synthetic seafarer master record linked to SDB readiness journey.'
        }]
      };
    }
    return this.records[row.id];
  }

  reset():void {
    Object.keys(this.records).forEach(key=>delete this.records[key]);
    this.counter=0;
  }

  private now():string{return new Date().toISOString();}
  private note(row:Seafarer,stage:string,actor:string,description:string):void{
    this.caseOf(row).timeline.unshift({time:this.now(),stage,actor,description});
    this.registry.recordDemoEvent(row.id,stage,actor,description);
  }

  invite(row:Seafarer):string{
    const msg=this.registry.sendInvitation(row);
    if(row.applicationState==='INVITED'){
      this.note(row,'INVITATION_QUEUED','MOCK notification adapter',
        'Ready-to-apply secure link queued for '+(row.category==='FOREIGN'?'authorised company representative':'UAE seafarer')+'. No email sent.');
    }
    return msg;
  }

  incomingSourceEvent(row:Seafarer,event:'COP'|'MEDICAL'|'HOLD'|'ENDORSEMENT'|'SOURCE',persona:DemoPersona):string{
    if(persona!=='OPERATIONS')return 'Only the controlled demo source-event simulator can perform this action.';
    if(event==='HOLD' && row.clearanceStatus!=='HOLD')return 'No source-owned HOLD exists.';
    if(event==='SOURCE' && row.sourceAvailable)return 'All demo source connections already respond.';
    this.registry.simulateSourceUpdate(row,event);
    this.note(row,'SOURCE_EVENT_SIMULATED','MOCK authoritative source',
      event+' source update received and readiness recalculated. This is not a MOEI override.');
    // When evidence changes after authorisation, a new final decision is required.
    const c=this.caseOf(row);
    if(c.decision==='AUTHORISED' && row.applicationState==='SUBMITTED'){
      c.decision='NOT_EVALUATED';
      this.note(row,'DECISION_INVALIDATED','Deterministic demo rules',
        'Source evidence changed after a prior authorisation; final check must run again.');
    }
    return 'Mock '+event+' source event applied. All eligibility gates re-evaluated.';
  }

  submit(row:Seafarer,persona:DemoPersona):string{
    const c=this.caseOf(row);
    if(!c.applicantConfirmed || !c.documentsReviewed || !c.declarationAccepted)
      return 'Confirm applicant data, source documents and declaration before submitting.';
    if(!c.contactEmail.trim()||!/^\S+@\S+\.\S+$/.test(c.contactEmail.trim()))
      return 'Enter a valid POC contact email.';
    if(c.deliveryMode==='COURIER'&&!c.deliveryAddress.trim())
      return 'Enter a delivery address for the courier scenario.';
    const msg=this.registry.submit(row,persona);
    if(row.applicationState==='SUBMITTED'){
      this.note(row,'APPLICATION_SUBMITTED','MOCK '+persona+' applicant',
        'Confirmed SDB '+(row.service==='FIRST_ISSUE'?'first issue':'renewal')+
        ' request, source-document review, declaration and '+c.deliveryMode.toLowerCase()+' fulfilment.');
    }
    return msg;
  }

  authorise(row:Seafarer,persona:DemoPersona):string{
    if(persona!=='OPERATIONS')return 'The rule-engine simulation is available only in operations demo mode.';
    if(row.applicationState!=='SUBMITTED')
      return 'Submit an applicant-authorised SDB application before final eligibility assessment.';
    const c=this.caseOf(row);
    const checks=this.registry.evidence(row);
    const current=this.registry.readiness(row);
    c.decisionEvidence=checks.map(ev=>({...ev}));
    c.decisionTime=this.now();
    c.decisionRuleVersion='POC-SDB-RULESET-v1.0';
    if(current!=='READY_TO_APPLY'||checks.some(ev=>ev.result==='FAIL'||ev.result==='PENDING')){
      c.decision='FAILED';
      this.note(row,'AUTO_AUTHORIZATION_BLOCKED','MOCK deterministic rule engine',
        'Failed closed: '+current+'; no officer bypass or AI override.');
      return 'Deterministic re-verification failed. Correct evidence at its owning source.';
    }
    c.decision='AUTHORISED';
    this.note(row,'AUTO_AUTHORIZED_SIMULATED','MOCK deterministic rule engine',
      'Eight evidence gates evaluated against '+c.decisionRuleVersion+
      '; no routine officer sign-off. MOEI regulatory auto-issuance approval remains outstanding.');
    return 'MOCK authorisation completed: all mandatory source evidence verified.';
  }

  pay(row:Seafarer,persona:DemoPersona):string{
    if(persona!=='OPERATIONS')return 'Use the operations persona for the mock payment callback.';
    const c=this.caseOf(row);
    if(c.decision!=='AUTHORISED')return 'Payment unavailable until the rules engine authorises the case.';
    const msg=this.registry.simulatePayment(row);
    if(row.applicationState==='PAYMENT_SIMULATED'){
      c.paymentReference='PAY-DEMO-'+(++this.counter)+'-'+row.id;
      this.note(row,'PAYMENT_CONFIRMED_SIMULATED','MOCK payment gateway',
        'Payment status callback verified, transaction reference '+c.paymentReference+'. No money moved or fee calculated.');
    }
    return msg;
  }

  issue(row:Seafarer,persona:DemoPersona):string{
    if(persona!=='OPERATIONS')return 'Issuance simulation must be triggered by the system/operations persona.';
    const c=this.caseOf(row);
    if(c.decision!=='AUTHORISED'||!c.paymentReference)
      return 'Authorised decision and confirmed mock payment are both mandatory.';
    const originalSid=row.sid;
    const msg=this.registry.issue(row);
    if(row.applicationState==='ISSUED'){
      this.note(row,'SDB_ISSUED_SIMULATED','MOCK issuance engine',
        originalSid
        ?'Renewal version created with unchanged SID '+row.sid+'. No actual booklet generated.'
        :'First issuance allocated synthetic SID '+row.sid+'. No government identifier generated.');
    }
    return msg;
  }

  queuePrint(row:Seafarer,persona:DemoPersona):string{
    const c=this.caseOf(row);
    if(persona!=='OPERATIONS')return 'Only MOEI operations can run the mock printing workflow.';
    if(row.applicationState!=='ISSUED')return 'SDB must be issued before printing.';
    if(c.printState!=='NOT_REQUESTED')return 'Print job already queued or completed.';
    c.printState='QUEUED';c.printReference='PRINT-DEMO-'+row.id;
    this.note(row,'PRINT_QUEUED_SIMULATED','MOCK print service',
      'Print instruction '+c.printReference+' created. No physical printing performed.');
    return 'Mock print job queued.';
  }

  markPrinted(row:Seafarer,persona:DemoPersona):string{
    const c=this.caseOf(row);
    if(persona!=='OPERATIONS')return 'Only MOEI operations can confirm mock print production.';
    if(c.printState!=='QUEUED')return 'Queue a print job before marking it complete.';
    c.printState='PRINTED';
    if(c.deliveryMode==='COLLECTION')c.deliveryState='READY_FOR_COLLECTION';
    this.note(row,'PRINT_CONFIRMED_SIMULATED','MOCK print operator',
      'Demo booklet marked printed; '+(c.deliveryMode==='COLLECTION'?'ready for collection.':'awaiting courier dispatch.'));
    return 'Mock booklet printed. Proceed to '+(c.deliveryMode==='COLLECTION'?'collection':'courier dispatch')+'.';
  }

  dispatch(row:Seafarer,persona:DemoPersona):string{
    const c=this.caseOf(row);
    if(persona!=='OPERATIONS')return 'Only MOEI operations can dispatch the mock booklet.';
    if(c.printState!=='PRINTED'||c.deliveryMode!=='COURIER'||c.deliveryState!=='NOT_STARTED')
      return 'Printed courier fulfilment is required before dispatch.';
    c.deliveryState='DISPATCHED';
    this.note(row,'DISPATCHED_SIMULATED','MOCK logistics adapter','Demo courier dispatch recorded; no external carrier connected.');
    return 'Mock booklet dispatched.';
  }

  completeDelivery(row:Seafarer,persona:DemoPersona):string{
    const c=this.caseOf(row);
    if(persona!=='OPERATIONS')return 'Only MOEI operations can confirm collection or delivery.';
    if(c.printState!=='PRINTED'||(
       c.deliveryMode==='COURIER'&&c.deliveryState!=='DISPATCHED')||(
       c.deliveryMode==='COLLECTION'&&c.deliveryState!=='READY_FOR_COLLECTION'))
       return 'Printing and appropriate collection / dispatch steps must be complete.';
    c.deliveryState='COMPLETED';c.deliveryTime=this.now();
    this.note(row,'FULFILMENT_COMPLETED_SIMULATED','MOCK fulfilment operator',
      c.deliveryMode==='COLLECTION'?'Demo booklet collected by applicant.':'Demo courier delivery confirmed.');
    return 'Synthetic fulfilment successfully completed.';
  }

  nextRequiredAction(row:Seafarer):string {
    const c=this.caseOf(row);
    const status=this.registry.readiness(row);
    if(status!=='READY_TO_APPLY')return 'Resolve prerequisites at source: '+status.replace(/_/g,' ');
    if(row.applicationState==='NOT_STARTED')return 'Queue the role-correct application invitation';
    if(row.applicationState==='INVITED')return 'Applicant review, declaration and submission';
    if(row.applicationState==='SUBMITTED')return c.decision==='AUTHORISED'?'Confirm payment':'Run final rules-based authorisation';
    if(row.applicationState==='PAYMENT_SIMULATED')return 'Create mock SDB issue / renewal';
    if(c.printState==='NOT_REQUESTED')return 'Create print instruction';
    if(c.printState==='QUEUED')return 'Record print completion';
    if(c.deliveryState!=='COMPLETED')return c.deliveryMode==='COURIER'&&c.deliveryState!=='DISPATCHED'
      ?'Record courier dispatch':'Confirm booklet handover';
    return 'Completed: next proactive renewal monitoring';
  }
}
