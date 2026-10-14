import { Injectable } from '@angular/core';

/**
 * MOEI SDB POC fixture store.
 *
 * ALL records, source updates, payments, emails and decisions in this service
 * are simulated. No external platform, MOEI registry, payment provider, or
 * government system is called. A future Spring Boot API will replace this.
 */

export type ApplicantChannel = 'SELF' | 'COMPANY';
export type Category = 'UAE' | 'FOREIGN';
export type ClearanceStatus = 'NO_OBJECTION' | 'HOLD' | 'PENDING';
export type ReadinessStatus =
  | 'READY_TO_APPLY'
  | 'EXTERNAL_HOLD'
  | 'MISSING_ENDORSEMENT'
  | 'PENDING_VERIFICATION'
  | 'REQUIREMENT_MISSING';
export type ApplicationState = 'NOT_STARTED' | 'INVITED' | 'SUBMITTED' | 'PAYMENT_SIMULATED' | 'ISSUED';

export interface Seafarer {
  id: string;
  name: string;
  sid: string | null;
  nationality: string;
  category: Category;
  rank: string;
  service: 'FIRST_ISSUE' | 'RENEWAL';
  company: string | null;
  academy: string | null;
  companyAuthorised: boolean;
  passportVerified: boolean;
  medicalValid: boolean;
  copCount: number;
  requiredCopCount: number;
  cocRequired: boolean;
  cocValid: boolean;
  endorsementValid: boolean;
  endorsementReference: string | null;
  clearanceStatus: ClearanceStatus;
  clearanceSource: string;
  holdReason: string | null;
  sourceAvailable: boolean;
  bookletExpiry: string | null;
  applicationState: ApplicationState;
  applicationReference: string | null;
  lastVerified: string;
}

export interface EvidenceCheck {
  rule: string;
  label: string;
  source: string;
  result: 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
  explanation: string;
}

export interface AuditItem {
  id: number;
  seafarerId: string;
  time: string;
  event: string;
  actor: string;
  detail: string;
}

const fixtureRows: Seafarer[] = [
  {
    id:'SF-001',name:'Amal Al Nuaimi',sid:null,nationality:'UAE',category:'UAE',rank:'Cadet',
    service:'FIRST_ISSUE',company:null,academy:'Gulf Maritime Academy',
    companyAuthorised:false,passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,
    cocRequired:false,cocValid:false,endorsementValid:false,endorsementReference:null,
    clearanceStatus:'NO_OBJECTION',clearanceSource:'Gulf Maritime Academy',holdReason:null,
    sourceAvailable:true,bookletExpiry:null,applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-002',name:'Yousef Al Mansoori',sid:null,nationality:'UAE',category:'UAE',rank:'Cadet',
    service:'FIRST_ISSUE',company:null,academy:'Gulf Maritime Academy',
    companyAuthorised:false,passportVerified:true,medicalValid:true,copCount:3,requiredCopCount:4,
    cocRequired:false,cocValid:false,endorsementValid:false,endorsementReference:null,
    clearanceStatus:'HOLD',clearanceSource:'Gulf Maritime Academy',
    holdReason:'Basic safety training module 4 must be completed.',
    sourceAvailable:true,bookletExpiry:null,applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-003',name:'Daniel Okafor',sid:'SID-DEMO-2003',nationality:'Nigeria',category:'FOREIGN',rank:'Master',
    service:'RENEWAL',company:'Ocean Bridge Shipping',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,cocRequired:true,
    cocValid:true,endorsementValid:true,endorsementReference:'END-DEMO-6003',
    clearanceStatus:'NO_OBJECTION',clearanceSource:'Ocean Bridge Shipping',holdReason:null,
    sourceAvailable:true,bookletExpiry:'2026-12-30',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-004',name:'Arjun Mehta',sid:'SID-DEMO-2004',nationality:'India',category:'FOREIGN',rank:'Chief Engineer',
    service:'RENEWAL',company:'Ocean Bridge Shipping',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,cocRequired:true,
    cocValid:true,endorsementValid:false,endorsementReference:'END-DEMO-EXPIRED',
    clearanceStatus:'NO_OBJECTION',clearanceSource:'Ocean Bridge Shipping',holdReason:null,
    sourceAvailable:true,bookletExpiry:'2026-11-24',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-005',name:'Marco Santos',sid:'SID-DEMO-2005',nationality:'Philippines',category:'FOREIGN',rank:'Deck Officer',
    service:'RENEWAL',company:'Harbour Marine LLC',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,cocRequired:true,
    cocValid:true,endorsementValid:true,endorsementReference:'END-DEMO-6005',
    clearanceStatus:'HOLD',clearanceSource:'Harbour Marine LLC',
    holdReason:'Company has placed a temporary hold pending completion of mandatory familiarisation.',
    sourceAvailable:true,bookletExpiry:'2026-12-19',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-006',name:'Mariam Al Shamsi',sid:'SID-DEMO-2006',nationality:'UAE',category:'UAE',rank:'Second Officer',
    service:'RENEWAL',company:'National Sea Transport',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:false,copCount:4,requiredCopCount:4,cocRequired:true,
    cocValid:true,endorsementValid:false,endorsementReference:null,
    clearanceStatus:'NO_OBJECTION',clearanceSource:'National Sea Transport',holdReason:null,
    sourceAvailable:true,bookletExpiry:'2026-11-03',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  },
  {
    id:'SF-007',name:'Khalid Rahman',sid:'SID-DEMO-2007',nationality:'Pakistan',category:'FOREIGN',rank:'Second Engineer',
    service:'RENEWAL',company:'Harbour Marine LLC',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,cocRequired:true,
    cocValid:true,endorsementValid:true,endorsementReference:'END-DEMO-6007',
    clearanceStatus:'PENDING',clearanceSource:'Harbour Marine LLC',holdReason:null,
    sourceAvailable:false,bookletExpiry:'2027-01-13',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-13'
  },
  {
    id:'SF-008',name:'Faisal Al Hamadi',sid:'SID-DEMO-2008',nationality:'UAE',category:'UAE',rank:'Able Seafarer',
    service:'RENEWAL',company:'National Sea Transport',academy:null,companyAuthorised:true,
    passportVerified:true,medicalValid:true,copCount:4,requiredCopCount:4,cocRequired:false,
    cocValid:false,endorsementValid:false,endorsementReference:null,
    clearanceStatus:'NO_OBJECTION',clearanceSource:'National Sea Transport',holdReason:null,
    sourceAvailable:true,bookletExpiry:'2027-02-04',applicationState:'NOT_STARTED',
    applicationReference:null,lastVerified:'2026-10-14'
  }
];

@Injectable({providedIn: 'root'})
export class SdbPocService {
  seafarers: Seafarer[] = [];
  audit: AuditItem[] = [];
  private sequence = 0;

  constructor() { this.reset(); }

  reset(): void {
    this.seafarers = fixtureRows.map(row => ({...row}));
    this.audit = [];
    this.sequence = 0;
    this.addAudit('SYSTEM','Fixture reset','Demo seed','Synthetic POC universe loaded (8 records)');
  }

  getSeafarer(id: string): Seafarer | undefined {
    return this.seafarers.find(row => row.id === id);
  }

  private addAudit(id: string, event: string, actor: string, detail: string): void {
    this.audit.unshift({
      id: ++this.sequence, seafarerId:id, event, actor, detail, time:new Date().toISOString()
    });
  }

  /** Add a fixture-only audit record from the SDB workflow simulator. */
  recordDemoEvent(id:string,event:string,actor:string,detail:string):void {
    this.addAudit(id,event,actor,detail);
  }

  getChannel(row: Seafarer): ApplicantChannel {
    return row.category === 'FOREIGN' ? 'COMPANY' : 'SELF';
  }

  evidence(row: Seafarer): EvidenceCheck[] {
    const items: EvidenceCheck[] = [
      {rule:'SDB-01',label:'Identity and passport',source:'ICP / Identity registry (simulated)',
       result:row.passportVerified?'PASS':'FAIL',
       explanation:row.passportVerified?'Verified identity source':'Identity validation missing or conflicting'},
      {rule:'SDB-02',label:'Medical fitness',source:'MARASI (simulated)',
       result:row.medicalValid?'PASS':'FAIL',
       explanation:row.medicalValid?'Valid medical fitness record':'Medical certificate requires renewal'},
      {rule:'SDB-03',label:'Basic safety training / CoP',source:'Academy registry (simulated)',
       result:row.copCount >= row.requiredCopCount?'PASS':'FAIL',
       explanation:row.copCount + ' / ' + row.requiredCopCount + ' CoP prerequisites fulfilled'},
      {rule:'SDB-04',label:'CoC verification',source:'Seafarer certificate registry (simulated)',
       result:!row.cocRequired?'NOT_APPLICABLE':row.cocValid?'PASS':'FAIL',
       explanation:!row.cocRequired?'Not required for this fixture category':row.cocValid?'Valid CoC':'CoC missing or not valid'},
      {rule:'SDB-05',label:'Foreign endorsement',source:'Endorsement registry (simulated)',
       result:row.category==='UAE'?'NOT_APPLICABLE':row.endorsementValid?'PASS':'FAIL',
       explanation:row.category==='UAE'?'Not applicable to UAE self-service':
         row.endorsementValid?'Verified '+row.endorsementReference:'Valid endorsement mandatory before foreign SDB application'},
      {rule:'SDB-06',label:'Academy / employer clearance',source:row.clearanceSource + ' API (simulated)',
       result:row.clearanceStatus==='HOLD'?'FAIL':row.clearanceStatus==='PENDING'?'PENDING':'PASS',
       explanation:row.clearanceStatus==='HOLD'?(row.holdReason || 'Hold reason missing'):
         row.clearanceStatus==='PENDING'?'Source verification pending':'Source-verified NO OBJECTION'},
      {rule:'SDB-07',label:'Source availability',source:'Integration health (simulated)',
       result:row.sourceAvailable?'PASS':'PENDING',
       explanation:row.sourceAvailable?'Required source connections responded':'Source unavailable: fail closed'},
      {rule:'SDB-08',label:'Company representation',source:'Company association registry (simulated)',
       result:row.category==='UAE'?'NOT_APPLICABLE':row.companyAuthorised?'PASS':'FAIL',
       explanation:row.category==='UAE'?'Self-service applicant':
         row.companyAuthorised?'Representative associated with company':'Company authorisation required'}
    ];
    return items;
  }

  readiness(row: Seafarer): ReadinessStatus {
    // A deterministic rule engine, never an LLM decision.
    if (row.category==='FOREIGN' && !row.endorsementValid) { return 'MISSING_ENDORSEMENT'; }
    if (row.clearanceStatus==='HOLD') { return 'EXTERNAL_HOLD'; }
    if (!row.sourceAvailable || row.clearanceStatus==='PENDING') { return 'PENDING_VERIFICATION'; }
    return this.evidence(row).some(check => check.result==='FAIL')
      ? 'REQUIREMENT_MISSING' : 'READY_TO_APPLY';
  }

  blockers(row: Seafarer): EvidenceCheck[] {
    return this.evidence(row).filter(item => item.result === 'FAIL' || item.result === 'PENDING');
  }

  /** Illustrative deterministic narrative, explicitly NOT an executed AI call. */
  mockAiSummary(row: Seafarer): string {
    const failures = this.blockers(row);
    if (this.readiness(row)==='READY_TO_APPLY') {
      return 'DEMO AI EXPLANATION (fixture): Source-backed prerequisites are satisfied. ' +
        (row.category==='FOREIGN'?'An authorised company may initiate this foreign seafarer application.':
          'The seafarer can initiate self-service.') +
        ' Final checks are repeated before simulated issuance.';
    }
    return 'DEMO AI EXPLANATION (fixture): Application is not ready. ' +
      failures.map(item => item.label + ': ' + item.explanation).join(' | ') +
      '. The owning source must correct official evidence; the AI cannot lift HOLD or override requirements.';
  }

  simulateSourceUpdate(row: Seafarer, field: 'HOLD' | 'MEDICAL' | 'COP' | 'ENDORSEMENT' | 'SOURCE'): void {
    if (field==='HOLD') {
      row.clearanceStatus='NO_OBJECTION'; row.holdReason=null;
    } else if (field==='MEDICAL') { row.medicalValid=true; }
    else if (field==='COP') { row.copCount=row.requiredCopCount; }
    else if (field==='ENDORSEMENT') {
      row.endorsementValid=true;
      row.endorsementReference='END-DEMO-UPDATED-'+row.id;
    } else if (field==='SOURCE') {
      row.sourceAvailable=true; row.clearanceStatus='NO_OBJECTION';
    }
    row.lastVerified=new Date().toISOString().slice(0,10);
    this.addAudit(row.id,'MOCK_SOURCE_EVENT','Simulated authoritative source',
      field + ' updated; all readiness checks recalculated. No live API invoked.');
  }

  sendInvitation(row: Seafarer): string {
    if (this.readiness(row)!=='READY_TO_APPLY') { return 'Cannot invite: prerequisites are not verified.'; }
    if (row.applicationState!=='NOT_STARTED') { return 'Invitation or application already exists.'; }
    row.applicationState='INVITED';
    this.addAudit(row.id,'INVITATION_SIMULATED','POC notification service',
      'Demo invitation queued for '+(row.category==='FOREIGN'?'company representative':'seafarer')+'. NO email sent.');
    return 'Invitation marked queued for demo only — no email was sent.';
  }

  submit(row: Seafarer, persona: 'OPERATIONS'|'COMPANY'|'SELF'): string {
    if (this.readiness(row)!=='READY_TO_APPLY') { return 'Submission blocked: re-verification failed.'; }
    if (row.applicationState!=='INVITED') { return 'A ready-to-apply invitation is required first.'; }
    if (row.category==='FOREIGN' && persona!=='COMPANY') {
      return 'Foreign SDB must be submitted by an authorised company representative.';
    }
    if (row.category==='UAE' && persona!=='SELF') {
      return 'UAE self-service application must be submitted by the seafarer.';
    }
    row.applicationState='SUBMITTED';
    row.applicationReference='SDB-DEMO-'+row.id;
    this.addAudit(row.id,'APPLICATION_SUBMITTED','Demo '+persona+' user',
      'Draft application submitted; source-verified eligibility rechecked.');
    return 'Demo application submitted. No production application was created.';
  }

  simulatePayment(row: Seafarer): string {
    if (row.applicationState!=='SUBMITTED' || this.readiness(row)!=='READY_TO_APPLY') {
      return 'Payment cannot proceed before verified submission.';
    }
    row.applicationState='PAYMENT_SIMULATED';
    this.addAudit(row.id,'PAYMENT_SIMULATED','POC payment adapter','Synthetic payment confirmed; no money moved.');
    return 'Synthetic payment confirmed; no transaction occurred.';
  }

  issue(row: Seafarer): string {
    if (row.applicationState!=='PAYMENT_SIMULATED'||this.readiness(row)!=='READY_TO_APPLY') {
      return 'Issuance blocked: payment or verified prerequisites are missing.';
    }
    row.applicationState='ISSUED';
    if (!row.sid) { row.sid='SID-DEMO-NEW-'+row.id; }
    this.addAudit(row.id,'SDB_ISSUED_SIMULATED','Deterministic demo rule engine',
      'Automated no-officer demonstration; no official certificate, registry update or print order.');
    return 'SIMULATED issuance completed with no routine officer approval. No official SDB issued.';
  }
}
