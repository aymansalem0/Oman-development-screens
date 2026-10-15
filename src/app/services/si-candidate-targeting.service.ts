import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiRegime='FOCUSED_INSPECTION'|'FOLLOW_UP_INSPECTION'|'PORT_STATE_CONTROL'|'UAE_SERVICE_INSPECTION';
export type SiCandidateStatus='PENDING_REVIEW'|'DEFERRED'|'REJECTED'|'INSPECTION_CREATED'|'EXTERNALLY_SCHEDULED';
export interface SiCandidateEvent{
  eventKey:string;sourceType:'NMC_CASE'|'SERVICE_REQUEST'|'PSC_PORT_CALL';
  sourceEventId:string;sourceReference:string;provenance:string;
  approval:string;evidenceIds:string[];
  importFile?:string|null;importBatchId?:string|null;importExcelRow?:number|null;
}
export interface SiCandidate{
  key:string;imo:string;vesselName:string;flag:string;vesselType:string;
  regime:SiRegime;eligibility:'MANDATORY'|'MANUAL_REVIEW';priority:string;
  reasons:string[];status:SiCandidateStatus;events:SiCandidateEvent[];
  currentRisk:{score:number;level:string;assessmentId:string;policyRevision:number}|null;
  inspectionCase:{id:string;status:string;createdAt:string;approvedBy:string}|null;
  lastDecision:{id:string;action:string;actor:string;note:string;at:string}|null;
}
/** One grid row per vessel IMO; individual regimes remain independent decisions. */
export interface SiVesselCandidate{
  imo:string;vesselName:string;flag:string;vesselType:string;
  currentRisk:SiCandidate['currentRisk'];
  arrivalAt?:string|null;arrivalStatus?:'MISSING'|'VERIFIED'|'CONFLICT';
  arrivalSourceReference?:string|null;
  departureAt?:string|null;departureVerified?:boolean;
  departureStatus?:'MISSING'|'VERIFIED'|'CONFLICT';
  departureSourceReference?:string|null;
  candidateKeys:string[];regimes:SiRegime[];
  sourceTypes:SiCandidateEvent['sourceType'][];
  sourceEvents:SiCandidateEvent[];
  workflows:{
    candidateKey:string;regime:SiRegime;status:SiCandidateStatus;
    eligibility:SiCandidate['eligibility'];priority:string;
    eventCount:number;inspectionCaseId:string|null;
  }[];
  pendingWorkflows:number;createdWorkflows:number;scheduledWorkflows:number;
  highestPriority:string;eligibility:SiCandidate['eligibility'];
}
export interface SiPriorityWeights{
  risk:number;trigger:number;history:number;deadline:number;urgency:number;
}
export interface SiPriorityPolicy{
  weights:SiPriorityWeights;approvedNmcFirst:true;missingRiskAction:'REVIEW_REQUIRED';
  sourceTriggerScores?:{NMC_CASE:number;SERVICE_REQUEST:number;PSC_PORT_CALL:number};
}
export type SiC01Signal='SOURCE_EVENT_EVIDENCE'|'VERIFIED_ETD'|'REVIEWED_INCIDENT'|'SAVED_VESSEL_RISK';
export interface SiC01AdvisoryRules{
 selectionSignals:SiC01Signal[];
 minimumSelectionConfidence:number;
 selectionInstructions:string;
 priorityInstructions:string;
}
export interface SiSelectionRules{
  pscRiskRatePercent:number;uaeFlagRatePercent:number;
  uaePoolMode:'ELIGIBLE_CANDIDATES_ONLY';
  pscPoolMode:'PUBLISHED_PSC_SHORTLIST_ONLY';
  aiSelectionMode:'RECOMMEND_WITHIN_ELIGIBLE_QUOTAS';
  serviceRequestPlanCap:number|null;maxPlannedVessels:number|null;
}
export interface SiSelectionProposal{
  mode:'AI_RECOMMENDATION_UNDER_PUBLISHED_POLICY_NOT_APPROVAL';
  policyRevision:number;snapshotHash:string;approved:false;
  pscRisk:{eligibleImos:number;cap:number;aiSelectedImos:string[];missingRisk:number};
  uaeFlag:{eligibleImos:number;cap:number;aiSelectedImos:string[]};
  serviceRequests?:{eligibleImos:number;cap:number|null;aiSelectedImos:string[];
     waitingInBacklogImos:string[]};
  maxPlannedVessels?:number|null;
  maxPlanExceededByProtectedSources?:boolean;
  mandatoryImos:string[];selectedImos:string[];
  overlappingImos:string[];aiRecommendedButQuotaExcluded:string[];
  manualReviewImos:string[];sourceCandidateImos:number;
  selectedRows:{imo:string;selectionBasis:string[];candidateKeys:string[];
    evidenceRefs:string[];aiRecommendationConfidence:number|null}[];
}
export interface SiTargetingPolicyConfig{
  /** Active execution priority (separate from source workflow eligibility). */
  ranking?:{criteria:('DEPARTURE_SOON'|'INCIDENT_SEVERITY')[]};
  aiAdvisory?:SiC01AdvisoryRules;
  selection?:SiSelectionRules;
  /** Legacy historical scoring only; no longer drives C01 selection/ranking. */
  sourceTriggerScores?:{NMC_CASE:number;SERVICE_REQUEST:number;PSC_PORT_CALL:number};
  /** Legacy archived policy shape (historical P01 views only). */
  riskPriorityThreshold?:number;includeMissingRiskInReview?:boolean;
  prioritization?:SiPriorityPolicy;
}
export interface SiDashboard{
  status:string;source:string;fleetSnapshotId:string;evaluatedAt:string;
  policy:{version:number;config:SiTargetingPolicyConfig};
  riskPolicyRevision:number;
  summary:{
    evaluatedPopulation:number;assessedRiskVessels:number;candidates:number;
    pendingReview:number;inspectionsCreated:number;externalScheduled:number;
    bySource:Record<string,number>;
    candidateVessels:number;pendingVessels:number;createdVessels:number;
  };
  candidates:SiCandidate[];vesselCandidates:SiVesselCandidate[];
}
export interface SiPriorityRecommendation{
  candidateKey:string;imo:string;vesselName:string;regime:string;
  effectiveRank:number;suggestedRank:number;ruleRank:number;
  rationale:string;evidenceRefs:string[];dataGaps:string[];confidence:number;
  rulePriority:string;protectedTier:number;missingRuleData:string[];
  officialRisk:SiCandidate['currentRisk'];
}
export interface SiPriorityRun{
  id:string;status:'SUCCEEDED'|'FAILED';startedAt:string;completedAt:string;
  actor:string;policyVersion:number;riskPolicyRevision:number;
  snapshotHash:string;source:string;errorCode?:string;requestedCandidates:number;
  recommendations:SiPriorityRecommendation[];isStale?:boolean;
}
export interface SiPriorityPreviewItem{
  candidateKey:string;imo:string;vesselName:string;ruleRank:number;
  protectedTier:number;rulePriority:string;provisionalScore:number|null;
  risk:SiCandidate['currentRisk'];missingData:string[];
}
export interface SiPriorityPreview{
  status:string;enabled:boolean;snapshotHash:string;eligibleCount:number;
  policyVersion:number;riskPolicyRevision:number;policy:SiPriorityPolicy;
  items:SiPriorityPreviewItem[];
}
export interface SiPriorityStatus{
  status:string;enabled:boolean;provider?:'MOCK'|'AIRIA';preview:{snapshotHash:string;eligibleCount:number;
    policyVersion:number;riskPolicyRevision:number};
  latest:SiPriorityRun|null;
}
export interface SiImpact{
  status:string;fleetSnapshotId:string;evaluatedPopulation:number;
  affectedImos:string[];affectedCandidateCount:number;unevaluatedRiskVessels:number;
  warning:string;aiSettingsChanged?:boolean;
  potentialRankingCandidates?:number;requiresManualAiRerun?:boolean;
  selectionImpact?:{
    candidatePoolImos:number;pscEligibleImos:number;uaeEligibleImos:number;
    pscTargetImos:number;uaeTargetImos:number;mandatoryImos:number;
    serviceEligibleImos:number;serviceTargetImos:number|null;
    maxPlannedVessels:number|null;theoreticalSelectedCeiling:number;
    unverifiedCandidates:number;pendingServiceRequestsRemainInBacklog:true;
    independentFactors:true;aiRunRequiredToChooseOptionalImos:true;
    pscQuotaFirst:true;uaePopulation:'ELIGIBLE_CANDIDATES_ONLY'
  };
}
export interface SiC01Recommendation{
  candidateKey:string;imo:string;regime:string;
  recommendation:'SELECT_RECOMMENDED'|'DEFER_RECOMMENDED'|'MANUAL_REVIEW';
  confidence:number;reason:string;priorityRationale:string;suggestedRank:number|null;
  priorityRationaleSource?:'AGENT_OUTPUT'|'DETERMINISTIC_BUSINESS_RULE';
  evidenceRefs:string[];dataGaps:string[];
  modelRecommendation?:'SELECT_RECOMMENDED'|'DEFER_RECOMMENDED'|'MANUAL_REVIEW';
  selectionReviewGate?:'BELOW_PUBLISHED_CONFIDENCE'|'AIRIA_OUTPUT_NOT_VERIFIED'|null;
  requiresHumanReview:true;regulatoryDecision:false;
}
export interface SiDraftScope {
 status:'READY'|'SELECTION_POLICY_REPUBLICATION_REQUIRED'|
  'PROTECTED_NMC_REFERRALS_EXCEED_PUBLISHED_PLAN_CAP'|
  'PROTECTED_NMC_REFERRALS_EXCEED_SOLVER_MAX';
 eligibleVessels:number;candidateWorkflows:number;
 protectedNmcVessels:number;serviceRequestVessels:number;
 legacyServiceRequestsForcedIntoOnePlan:number;
 hasPublishedCappedPolicy:boolean;
 publishedServiceRequestPlanCap:number|null;
 publishedMaxPlannedVessels:number|null;
 solverMaxVessels:number;sourcePolicyRevision:number;
 requiresOfficerAction:boolean;noAiCalls:true;noSourceMutation:true;
}
export interface SiC01Preview {

 status:'PREVIEW_ONLY_NO_AI';provider:'MOCK'|'AIRIA';
 snapshotHash:string;policyRevision:number;pscQuotaPolicyRevision:number|null;
 riskPolicyRevision:number;eligibleCount:number;externalCalls:0;
 aiAdvisory?:SiC01AdvisoryRules;
 selectionPolicy?:SiSelectionRules;
 draftScope?:SiDraftScope;
  expectedBatches?:number;estimatedAiriaCalls?:number;
 candidates:{candidateKey:string;imo:string;regime:string;
    vesselName:string;sourceTypes:string[];allowedEvidence:string[];
    currentRisk:SiCandidate['currentRisk']}[];
 latest:{agentRunId:string;isStale:boolean;provider:string}|null;
}
export interface SiC01Run{
 status:'ADVISORY_REVIEW_REQUIRED';agentCode:'SI-C01';agentRunId:string;
 provider:'MOCK'|'AIRIA';mock:boolean;simulationLabel:string|null;
 snapshotHash:string;policyRevision:number;riskPolicyRevision:number;
 actor:string;generatedAt:string;externalCalls:number;humanDecisionRequired:true;
 mutations:false;warning:string;recommendations:SiC01Recommendation[];
  configuredSelectionPolicy?:SiSelectionRules;selectionProposal?:SiSelectionProposal;
 batchesValidated?:number;candidatesAnalyzed?:number;
 verifiedAiRecommendations?:number;manualReviewDueToAiContract?:number;
 ignoredUnknownRecommendations?:number;verificationFailures?:Record<string,number>;
}
export interface SiVesselPeriodEligibility{
 status:'WITHIN_SOURCE_WINDOW'|'NEEDS_CAPACITY_CHECK'|'OUTSIDE_EXECUTION_PLAN';
 reasonCode:string|null;firstSourceRef:string|null;
 planStartsOn:string;planEndsOn:string;
}
export interface SiInspectionPlanRow{
 imo:string;vesselName:string;flag:string;vesselType:string;
 sources:string[];regimes:string[];sourceEvents:SiCandidateEvent[];
 risk:SiCandidate['currentRisk'];
 pendingWorkflows:number;approvedCases:number;externalScheduled:number;
 aiRecommended:boolean|null;planSelected:boolean|null;
  aiQuotaSelected?:boolean|null;aiSelectionBasis?:string[];
 selectionOrigin:'AI_ADVISORY'|'OFFICER_AMENDED'|'NOT_EVALUATED'|
    'PUBLISHED_SOURCE_RULE'|'AI_SELECTION_WITHIN_PUBLISHED_QUOTAS';
 disposition?:'AVAILABLE'|'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE';
 reviewAfter?:string|null;previousDisposition?:string|null;
 previousPlan?:string|null;reviewDue?:boolean;
 officerReason:string|null;officerActor:string|null;
 requestedRank:number|null;modelRank:number|null;effectiveRank:number|null;
 priorityReason:string|null;selectionReason:string|null;
 evidenceRefs:string[];dataGaps:string[];confidence:number|null;
 editable:boolean;locked:boolean;mandatoryReferral:boolean;
 periodEligibility?:SiVesselPeriodEligibility;
 regimeAdvisories:SiC01Recommendation[];
}
export interface SiRollingPlan{
 id:string;number:string;title:string;startsOn:string;endsOn:string;
 notes:string;status:'DRAFT'|'READY_FOR_APPROVAL'|
 'APPROVED'|'IN_EXECUTION'|'COMPLETED'|'CANCELLED';
 revision:number;createdAt:string;createdBy:string;updatedAt:string;
 updatedBy:string;approvedAt:string|null;approvedBy:string|null;
 approvedBatchId:string|null;vesselCount:number;
 candidateCount?:number;deferredCount?:number;
}
export interface SiC01DataReadiness{
 schemaVersion:'SI_C01_READINESS_V1';
 status:'NO_CANDIDATES'|'SCOPE_LIMIT'|'REVIEW_RECOMMENDED'|'READY_WITH_GAPS'|'READY';
 sourceSnapshotHash:string|null;currentSourceOnly:true;externalAiCalls:0;
 eligibleWorkflows:number;eligibleVessels:number;
 confirmedEtdVessels:number;missingConfirmedEtdVessels:number;
 conflictingEtdVessels:number;incidentReviewedVessels:number;
 riskAssessedVessels:number;evidenceBackedVessels:number;
 withoutExecutionSignalVessels:number;
 selectionRequiresOfficerApproval:true;etDAndIncidentRankingOnly:true;
 notes:string;
}
export interface SiInspectionPlanState{
 planId?:string|null;planNumber?:string|null;planStatus?:string|null;
 readOnlyHistorical?:boolean;historicalSourceChanged?:boolean;
 selectionMode?:'MANUAL'|'AI_ASSISTED';manualSelection?:boolean;
  selectionProposal?:SiSelectionProposal|null;
 capacityDraft?:{
  status:string;generatedAt:string;demoMode:boolean;
  erpSnapshotId:string;selectedImos:string[];
  mandatoryUnscheduled:string[];outsidePlanPeriod:string[];
  proposedAssignments:{imo:string;inspectorName:string;startLocal:string;
   endLocal:string;portName:string;crossPort:boolean}[];
  unscheduled:{imo:string;blocker:string|null}[];
 }|null;
 availableCount?:number;deferredCount?:number;notSelectedCount?:number;
 candidatesAtCreation?:number|null;
 dataReadiness?:SiC01DataReadiness|null;
 planPeriod?:{startsOn:string;endsOn:string}|null;
 status:'ok';provider:'MOCK'|'AIRIA';mock:boolean;
 sourceHash:string;revision:number;generatedAt:string|null;
 agentRunId:string|null;stale:boolean;externalCallsOnRead:0;
 aiRecommendedVessels:number|null;selectedForPlan:number|null;
 approvedCases:number;warning:string;rows:SiInspectionPlanRow[];
}
export interface SiInspectionPlanResult{
 status:'RECALCULATED';provider:'MOCK'|'AIRIA';mock:boolean;
 agentRunId:string;externalCalls:number;revision:number;sourceHash:string;
 aiRecommendedVessels:number;selectedForPlan:number;
 verifiedAiRecommendations?:number;manualReviewDueToAiContract?:number;
 ignoredUnknownRecommendations?:number;verificationFailures?:Record<string,number>;
 humanApprovalStillRequired:true;rows:SiInspectionPlanRow[];
  selectionProposal?:SiSelectionProposal;
}
@Injectable({providedIn:'root'})
export class SiCandidateTargetingService{
  private readonly api='/api/si/v1';
  constructor(private http:HttpClient){}
  dashboard():Observable<SiDashboard>{
    return this.http.get<SiDashboard>(this.api+'/candidates/dashboard');
  }
  rules():Observable<{status:string;policy:{version:number;config:SiTargetingPolicyConfig}}>{
    return this.http.get<{status:string;policy:{version:number;config:SiTargetingPolicyConfig}}>(
      this.api+'/rules');
  }
  addEvent(body:Record<string,unknown>,key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/source-events',body,{headers:this.headers(key)});
  }
  decision(body:{candidateKey:string;imo:string;action:string;actor:string;note:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/candidates/decision',body,{headers:this.headers(key)});
  }
  preview(config:SiTargetingPolicyConfig,key:string):Observable<SiImpact>{
    return this.http.post<SiImpact>(this.api+'/rules/impact-preview',{config},{headers:this.headers(key)});
  }
  publish(body:{config:SiTargetingPolicyConfig;
    expectedVersion:number;publishedBy:string;reason:string},key:string):Observable<unknown>{
    return this.http.post(this.api+'/rules/publish',body,{headers:this.headers(key)});
  }
  rollingPlans():Observable<{plans:SiRollingPlan[]}>{
    return this.http.get<{plans:SiRollingPlan[]}>(this.api+'/inspection-plans');
  }
  createRollingPlan(input:{title:string;startsOn:string;endsOn:string;
    notes?:string}):Observable<SiRollingPlan>{
    return this.http.post<SiRollingPlan>(this.api+'/inspection-plans',input);
  }
  rollingPlan(id:string):Observable<SiRollingPlan>{
    return this.http.get<SiRollingPlan>(this.api+'/inspection-plans/'+encodeURIComponent(id));
  }
  selectRollingVessel(id:string,input:{
    imo:string;action:'INCLUDE'|'NOT_SELECTED'|'DEFER'|'NOT_APPLICABLE';
    reason:string;reviewAfter?:string|null;
    expectedRevision:number;expectedSourceHash:string
  }):Observable<{status:'SAVED';planId:string;revision:number;
    included:number;disposition:string;externalCalls:0}>{
    return this.http.post<{status:'SAVED';planId:string;revision:number;
      included:number;disposition:string;externalCalls:0}>(
      this.api+'/inspection-plans/'+encodeURIComponent(id)+'/selection',input);
  }
  bulkSelectRollingVessels(id:string,input:{
    imos:string[];action:'NOT_SELECTED'|'DEFER';
    reason:string;reviewAfter?:string|null;
    expectedRevision:number;expectedSourceHash:string
  }):Observable<{status:'SAVED';planId:string;revision:number;
    affectedCount:number;imos:string[];disposition:'NOT_SELECTED'|'DEFER';
    included:number;externalCalls:0;inspectionCasesChanged:0}>{
    return this.http.post<{status:'SAVED';planId:string;revision:number;
      affectedCount:number;imos:string[];disposition:'NOT_SELECTED'|'DEFER';
      included:number;externalCalls:0;inspectionCasesChanged:0}>(
      this.api+'/inspection-plans/'+encodeURIComponent(id)+'/selection-bulk',input);
  }
  cancelRollingPlan(id:string,expectedRevision:number,reason:string):Observable<SiRollingPlan>{
    return this.http.post<SiRollingPlan>(this.api+'/inspection-plans/'+
      encodeURIComponent(id)+'/cancel',{expectedRevision,reason});
  }
  inspectionPlan(key:string,planId?:string|null):Observable<SiInspectionPlanState>{
    return this.http.get<SiInspectionPlanState>(this.api+'/inspection-plan',
      {headers:this.headers(key),
       params:planId?{planId}:{}});
  }
  rerankInspectionPlan(key:string,body:{
    actor:string;expectedSourceHash:string;expectedRevision:number;
    planId?:string;confirmRun:true;confirmCost:boolean;
    confirmBatchCount?:number;
    change?:{imo:string;selected:boolean;requestedRank:number|null;reason:string}
  }):Observable<SiInspectionPlanResult>{
    return this.http.post<SiInspectionPlanResult>(
      this.api+'/inspection-plan/rerank',body,{headers:this.headers(key)});
  }
  candidateAiConfiguration(key:string):Observable<{status:string;provider:'MOCK'|'AIRIA';mock:boolean;agents:string[];externalCallsInMock:number}>{
    return this.http.get<{status:string;provider:'MOCK'|'AIRIA';mock:boolean;agents:string[];externalCallsInMock:number}>(
      this.api+'/agents/configuration',{headers:this.headers(key)});
  }
  candidateAiPreview(key:string):Observable<SiC01Preview>{
    return this.http.get<SiC01Preview>(this.api+'/agents/candidate-selection/preview',
      {headers:this.headers(key)});
  }
  candidateAiRun(key:string,body:{actor:string;expectedSnapshotHash:string;
    confirmRun:true;confirmCost:boolean;confirmBatchCount?:number}):Observable<SiC01Run>{
    return this.http.post<SiC01Run>(this.api+'/agents/candidate-selection/run',body,
      {headers:this.headers(key)});
  }
  prioritizationStatus(key:string):Observable<SiPriorityStatus>{
    return this.http.get<SiPriorityStatus>(this.api+'/prioritization',{headers:this.headers(key)});
  }
  prioritizationPreview(key:string):Observable<SiPriorityPreview>{
    return this.http.post<SiPriorityPreview>(this.api+'/prioritization/preview',{},
      {headers:this.headers(key)});
  }
  runPrioritization(key:string,body:{actor:string;confirmCost:true;expectedSnapshotHash:string}):Observable<SiPriorityRun>{
    return this.http.post<SiPriorityRun>(this.api+'/prioritization/run',body,
      {headers:this.headers(key)});
  }
  prioritizationHistory(key:string):Observable<{status:string;runs:SiPriorityRun[]}>{
    return this.http.get<{status:string;runs:SiPriorityRun[]}>(
      this.api+'/prioritization/history',{headers:this.headers(key)});
  }
  private headers(key:string):HttpHeaders{
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});
  }
}
