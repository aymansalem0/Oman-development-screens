import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';

export type CheckField='BOOLEAN'|'NOTE'|'EXPIRY_DATE'|'DATE'|'NUMBER'|'TEXT';
export type AiLevel='TEMPLATE'|'GROUP'|'ITEM';
export interface CheckAiSettings{
 enabled:boolean;instructions:string;requiresHumanReview?:boolean;
}
export interface ChecklistItem{
 id:string;title:string;description:string;fields:CheckField[];requiredFields:CheckField[];
 mandatory:boolean;order:number;options:string[];
 ai:CheckAiSettings;sourceReferences:string[];
}
export interface ChecklistGroup{
 id:string;title:string;description:string;order:number;
 ai:CheckAiSettings;items:ChecklistItem[];
}
export interface ChecklistRule{
 vesselTypes:string[];inspectionRegimes:string[];sourceTypes:string[];
 minGT:number|null;maxGT:number|null;minDWT:number|null;maxDWT:number|null;
}
export interface ChecklistDraft{
 title:string;description:string;mandatory:boolean;
 applicability:ChecklistRule;ai:CheckAiSettings;groups:ChecklistGroup[];
}
export interface ChecklistTemplate{
 id:string;draft:ChecklistDraft;revision:number;
 published:(ChecklistDraft&{revision:number;publishedAt:string;contentHash:string})[];
 updatedAt:string;updatedBy:string;createdAt:string;createdBy:string;
}
export interface ChecklistSummary{
 id:string;title:string;mandatory:boolean;revision:number;
 published:boolean;groupCount:number;itemCount:number;updatedAt:string;updatedBy:string;
}
export interface ChecklistBuilderReply{
 status:'DRAFT_REQUIRES_ADMIN_REVIEW';provider:'AIRIA';
 suggestedGroups:Partial<ChecklistGroup>[];suggestedItems:Partial<ChecklistItem>[];
 rationale:string;noRegulatoryVerification:true;
}
export interface ChecklistVessel{
 imo:string;name:string|null;vesselType:string|null;
 grossTonnage:number|null;deadweightTonnage:number|null;
}
export interface ChecklistProposal{
 id:string;level:AiLevel;status:string;at:string;
 imageEvidenceRef:{id:string;mimeType:string;sha256:string;byteLength:number}|null;
 recommendations:{itemId:string;proposedAnswers:Record<CheckField,unknown>;
  rationale:string;confidence:number;dataGaps:string[]}[];
 reviews:{itemId:string;decision:'ACCEPT'|'EDIT'|'REJECT';at:string;actor:string}[];
}
export interface ChecklistInstanceItem extends ChecklistItem{
 instanceId:string;answers:Partial<Record<CheckField,unknown>>;
 answerStatus:string;answeredBy:string|null;
 answerUpdatedAt:string|null;evidenceRefs:string[];
 reviewHistory:unknown[];
}
export interface ChecklistInstanceGroup extends ChecklistGroup{
 instanceId:string;items:ChecklistInstanceItem[];
}
export interface ChecklistInstanceTemplate{
 templateId:string;revision:number;title:string;mandatory:boolean;contentHash:string;
 ai:CheckAiSettings;groups:ChecklistInstanceGroup[];
}
export interface ChecklistExecution{
 caseId:string;imo:string;version:number;status:'IN_PROGRESS'|'SUBMITTED_FOR_REVIEW';
 createdAt:string;createdBy:string;updatedAt:string;updatedBy:string;
 vessel:ChecklistVessel;inspectionReasons:unknown[];
 applicabilityWarnings:{title:string;missing:string[]}[];
 templates:ChecklistInstanceTemplate[];
 proposals:ChecklistProposal[];audit:unknown[];
}
export interface ChecklistPreview{
 status:'ok';caseId:string;imo:string;vessel:ChecklistVessel;
 inspectionReasons:unknown[];
 selectedTemplates:{templateId:string;revision:number;title:string;
  groupCount:number;itemCount:number;mandatory:boolean}[];
 warnings:{templateId:string;title:string;missing:string[]}[];
 saved:ChecklistExecution|null;immutableLegacyBaseline:true;
 requiresInspectorReview:true;
}
@Injectable({providedIn:'root'})
export class SiChecklistsService{
 private url='/api/si/v1/checklists';
 constructor(private http:HttpClient){}
 list():Observable<{templates:ChecklistSummary[]}>{
  return this.http.get<{templates:ChecklistSummary[]}>(this.url);
 }
 detail(id:string):Observable<ChecklistTemplate>{
  return this.http.get<ChecklistTemplate>(this.url+'/'+encodeURIComponent(id));
 }
 create(draft:ChecklistDraft):Observable<ChecklistTemplate>{
  return this.http.post<ChecklistTemplate>(this.url,draft);
 }
 save(t:ChecklistTemplate):Observable<ChecklistTemplate>{
  return this.http.put<ChecklistTemplate>(this.url+'/'+t.id,
   {...t.draft,expectedRevision:t.revision,expectedUpdatedAt:t.updatedAt});
 }
 publish(t:ChecklistTemplate):Observable<ChecklistTemplate>{
  return this.http.post<ChecklistTemplate>(this.url+'/'+t.id+'/publish',
   {expectedUpdatedAt:t.updatedAt});
 }
 aiStatus():Observable<{enabled:boolean;builderConfigured:boolean;visionConfigured:boolean;
   provider:string;automaticRuns:boolean;imageTransport:string}>{
  return this.http.get<any>(this.url+'/ai/status');
 }
 suggestTemplate(input:{level:AiLevel;template:ChecklistDraft;
  groupId?:string;itemId?:string;instructions?:string;operatorPrompt:string}):
   Observable<ChecklistBuilderReply>{
  return this.http.post<ChecklistBuilderReply>(this.url+'/ai/builder',input);
 }
 preview(caseId:string):Observable<ChecklistPreview>{
  return this.http.get<ChecklistPreview>(this.url+'/cases/'+caseId);
 }
 start(caseId:string):Observable<ChecklistExecution>{
  return this.http.post<ChecklistExecution>(this.url+'/cases/'+caseId+'/start',{});
 }
 answers(caseId:string,version:number,answers:{itemId:string;
   values:Partial<Record<CheckField,unknown>>}[]):Observable<ChecklistExecution>{
  return this.http.post<ChecklistExecution>(this.url+'/cases/'+caseId+'/answers',
   {expectedVersion:version,answers});
 }
 aiSuggest(caseId:string,body:{level:AiLevel;templateId?:string;
  groupId?:string;itemId?:string;text?:string;
  image?:{mimeType:string;base64:string};confirmCost:true}):
   Observable<{proposal:ChecklistProposal;version:number}>{
  return this.http.post<any>(this.url+'/cases/'+caseId+'/ai/suggest',body);
 }
 review(caseId:string,body:{expectedVersion:number;proposalId:string;
  itemId:string;decision:'ACCEPT'|'EDIT'|'REJECT';
  editedAnswers?:Partial<Record<CheckField,unknown>>;reviewNote?:string}):
   Observable<ChecklistExecution>{
  return this.http.post<ChecklistExecution>(this.url+'/cases/'+caseId+'/ai/review',body);
 }
 submit(caseId:string,version:number):Observable<ChecklistExecution>{
  return this.http.post<ChecklistExecution>(this.url+'/cases/'+caseId+'/submit',
   {expectedVersion:version});
 }
}
