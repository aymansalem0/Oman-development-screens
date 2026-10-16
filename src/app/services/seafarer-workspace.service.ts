import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";


export type SdbInputMode='INTEGRATION'|'PLATFORM_ENTRY'|'ATTACHMENT';
export type SdbServiceScope='BOTH'|'FIRST_ISSUE'|'RENEWAL';
export interface SdbRequirement{
 id:string;title:string;titleAr:string;source:string;
 inputMode:SdbInputMode;scope:SdbServiceScope;active:boolean;
 mandatory:boolean;core:boolean;reviewUncertain:boolean;order:number;
}
export interface SdbReadinessSettings{
 version:number;baselinePolicyVersion:string;updatedAt:string|null;
 updatedBy:string|null;requirements:SdbRequirement[];
 engine:{type:string;mode:string;modelInvoked:false;
  documentAiProvider:'NOT_CONNECTED';attachmentBytesStored:false;
  baselineEnforced:true};
}
export interface SdbDocumentReview{
 id:string;profileId:string;requirementId:string;
 filename:string;mimeType:string;size:number;sha256:string;
 reference:string;submittedAt:string;
 reviewStatus:'AI_TRIAGE_QUEUED'|'PENDING_HUMAN_REVIEW'|'HUMAN_VERIFIED'|'REJECTED';
 aiModelInvoked:false;aiDecision:null;confidence:null;
 humanDecision:string|null;reviewedBy:string|null;reviewedAt:string|null;note:string;
 seafarerName?:string;service?:string;
}
export interface SdbReviewQueue{
 mode:string;aiProvider:'NOT_CONNECTED';aiModelInvoked:false;
 queued:SdbDocumentReview[];reviewed:SdbDocumentReview[];
}
export interface SdbCheck {
  key: string;
  label: string;
  source: string;
  result: string;
  reason: string;
  expiryDate: string | null;
  reference: string | null;
  inputMode?:SdbInputMode;configurable?:boolean;policyRequirementId?:string;
}
export interface SdbCertificate {
  id: string;
  type: string;
  title: string;
  status: string;
  issueDate: string;
  expiryDate: string;
  reference: string;
}
export interface SdbRecipient {
  recipient: string;
  email: string;
  phone: string;
  address: string;
}
export interface SdbApplication {
  id: string;
  profileId: string;
  service: string;
  status: string;
  version: number;
  createdAt: string;
  format: "ELECTRONIC" | "ELECTRONIC_PRINT";
  delivery: "NONE" | "POST" | "PICKUP";
  recipient: SdbRecipient;
  declaration: boolean;
  invoice: {
    id: string;
    currency: string;
    feeVersion: string;
    illustrative: boolean;
    lines: { code: string; description: string; amount: number }[];
    total: number;
    status: string;
  } | null;
  payment: {
    reference: string;
    result: string;
    amount: number;
    currency: string;
  } | null;
  digital: {
    number: string;
    sid: string;
    name: string;
    issuedAt: string;
    expiryDate: string;
    status: string;
    verificationReference: string;
    previousSdb: string | null;
  } | null;
  fulfilment: {
    status: string;
    trackingNumber: string | null;
    carrier: string | null;
    pickupAt: string | null;
    history: { status: string; at: string }[];
  } | null;
}
export interface SdbProfile {
  id: string;
  nationalId: string;
  name: string;
  rank: string;
  nationality: string;
  academyId: string;
  companyId: string | null;
  photoReference: string | null;
  existingSdb: { sid: string; number: string; expiryDate: string } | null;
  academyRequired?:boolean;
  cocRequired?:boolean;
  endorsementRequired?:boolean;
  coc?:{status:string;reference:string;expiryDate:string}|null;
  endorsement?:{status:string;reference:string;expiryDate:string}|null;
  version: number;
  createdAt: string;
  lastUpdated: string;
  certificates: SdbCertificate[];
  passport: {
    number: string;
    issueDate: string;
    expiryDate: string;
    status: string;
    reference: string;
  } | null;
  medical: {
    reference: string;
    status: string;
    issuedAt: string;
    expiryDate: string;
    validFor: string[];
  } | null;
  contact: SdbRecipient;
  clearances: Record<
    string,
    { status: string; reason: string; reference: string; updatedAt: string }
  >;
  sourceSync: Record<
    string,
    { status: string; checkedAt: string; reference: string }
  >;
  readiness: {
    service: string;
    status: string;
    checks: SdbCheck[];
    blockers: SdbCheck[];
    expiring: SdbCheck[];
    passed: number;
    total: number;
    percent: number;
    evaluatedAt: string;
    policyVersion: string;
  };
  applications: SdbApplication[];
  documents?:SdbDocumentReview[];
}
export interface SdbServiceScenario {
 id:string;title:string;titleAr:string;situation:string;situationAr:string;
 category:'ACADEMY'|'MARASI'|'COMPANY'|'READY';
 profileId:string;person:{name:string;rank:string;nationality:string};
 existingSdb:{sid:string;number:string;expiryDate:string}|null;
 readiness:SdbProfile['readiness'];canContinue:boolean;
 advisor:{mode:'EXPLAINABLE_RULES_POC';modelInvoked:false;
  classifiedService:'FIRST_ISSUE'|'RENEWAL';score:number;
  sourceBacked:boolean;requiresHumanClearance:boolean;
  evidence:{key:string;source:string;status:string;reason:string;
   reference:string|null;expiryDate:string|null}[];
  nextActions:{key:string;owner:string;action:string}[];
 };
}
export interface SdbServiceScenariosResponse{
 mode:'CONTRACT_SANDBOX';officialData:false;modelInvoked:false;
 scenarios:SdbServiceScenario[];
}
export interface SdbNotification {
  id: string;
  profileId: string;
  type: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  delivery: string;
  externalDelivery: string;
}
export interface SdbDashboard {
  mode: string;
  readinessConfigurationVersion?:number;
  readinessEngine?:{type:string;mode:string;aiModelInvoked:false;
    documentAiProvider:'NOT_CONNECTED';baselineEnforced:true};
  actor: {
    key: string;
    operations: boolean;
    seafarerId: string | null;
    companyId: string | null;
  };
  profiles: SdbProfile[];
  policy: { version: string; sourceMaxAgeHours: number; reminderDays: number };
  fees: {
    version: string;
    currency: string;
    issue: number;
    renewal: number;
    print: number;
    post: number;
  };
  summary: {
    candidates: number;
    ready: number;
    holds: number;
    pending: number;
  };
  connectors: { source: string; mode: string; liveConnected: boolean }[];
  companies: { id: string; name: string }[];
  notifications: SdbNotification[];
  audit: {
    id: string;
    profileId: string;
    event: string;
    actor: string;
    detail: string;
    at: string;
  }[];
}
@Injectable({ providedIn: "root" })
export class SeafarerWorkspaceService {
  private root = "/api/seafarers/v1";
  constructor(private http: HttpClient) {}
  dashboard(scope = "") {
    return this.http.get<SdbDashboard>(this.root + "/dashboard" + scope);
  }
  demoScenarios() {
    return this.http.get<SdbServiceScenariosResponse>(this.root + "/demo-scenarios");
  }
  demoScenario(id:string){
    return this.http.get<{mode:string;scenario:SdbServiceScenario}>(
      this.root+'/demo-scenarios/'+encodeURIComponent(id));
  }
  publicRequirements(){
    return this.http.get<{version:number;requirements:SdbRequirement[]}>(
      this.root+'/readiness-requirements');
  }
  readinessSettings(){
    return this.http.get<SdbReadinessSettings>(this.root+'/readiness-settings');
  }
  saveRequirement(item:SdbRequirement){
    return this.http.post<SdbReadinessSettings>(
      this.root+'/readiness-settings/requirements',item);
  }
  documentQueue(){
    return this.http.get<SdbReviewQueue>(this.root+'/document-review-queue');
  }
  uploadEvidenceMetadata(profileId:string,requirementId:string,data:{
    filename:string;mimeType:string;size:number;sha256:string
  }){
    return this.http.post<{document:SdbDocumentReview;readiness:SdbProfile['readiness']}>(
      this.root+'/profiles/'+encodeURIComponent(profileId)+
      '/requirements/'+encodeURIComponent(requirementId)+'/evidence',data);
  }
  reviewEvidence(id:string,decision:'HUMAN_VERIFIED'|'REJECTED',reason:string){
    return this.http.post<{document:SdbDocumentReview;readiness:SdbProfile['readiness']}>(
      this.root+'/document-reviews/'+encodeURIComponent(id)+'/decision',
      {decision,reason});
  }
  start(profileId: string, scope: string) {
    return this.http.post<SdbApplication>(
      this.root +
        "/profiles/" +
        encodeURIComponent(profileId) +
        "/applications" +
        scope,
      {},
    );
  }
  options(app: SdbApplication, body: unknown, scope: string) {
    return this.http.post<SdbApplication>(
      this.root + "/applications/" + app.id + "/options" + scope,
      body,
    );
  }
  invoice(app: SdbApplication, scope: string) {
    return this.http.post<SdbApplication>(
      this.root + "/applications/" + app.id + "/invoice" + scope,
      {},
    );
  }
  pay(app: SdbApplication, result: string, key: string, scope: string) {
    return this.http.post<SdbApplication>(
      this.root + "/applications/" + app.id + "/pay" + scope,
      { result, idempotencyKey: key },
    );
  }
  decision(id: string, body: unknown, scope: string) {
    return this.http.post<SdbProfile>(
      this.root + "/profiles/" + id + "/company-decision" + scope,
      body,
    );
  }
  simulate(id: string, action: string) {
    return this.http.post(this.root + "/profiles/" + id + "/simulate", {
      action,
    });
  }
  fulfil(id: string, body: unknown) {
    return this.http.post<SdbApplication>(
      this.root + "/applications/" + id + "/fulfil",
      body,
    );
  }
  readNotice(id: string, scope: string) {
    return this.http.post(
      this.root + "/notifications/" + id + "/read" + scope,
      {},
    );
  }
}
