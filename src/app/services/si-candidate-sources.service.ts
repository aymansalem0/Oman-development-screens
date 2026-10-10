import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

export type SiExcelSource='SERVICE_REQUEST'|'PSC_PORT_CALL';
export interface SiImportIssue{row:number;code:string;detail:string}
export interface SiImportPreview{
  status:'PREVIEW_READY'|'VALIDATION_FAILED';previewId:string;
  sourceType:SiExcelSource;fileName:string;sheet:string;fileSha256:string;expiresAt:string;
  totalRows:number;validRows:number;newEvents:number;replayedEvents:number;
  issues:SiImportIssue[];sample:{row:number;imo:string;reference:string;port:string}[];
  canCommit:boolean;
}
export interface SiSourceImportSummary{
  status:string;nmc:{mode:string;currentReferrals:number;details:string};
  excelSources:Record<SiExcelSource,{
    display:string;sheet:string;fields:string[];importedEvents:number;
    candidateVessels:number;
    lastImport:{batchId:string;sourceType:string;fileName:string;fileSha256:string;actor:string;
      importedAt:string;importedCount:number}|null
  }>;
  recentBatches:{batchId:string;sourceType:string;fileName:string;fileSha256:string;actor:string;
    importedAt:string;importedCount:number}[];
}
@Injectable({providedIn:'root'})
export class SiCandidateSourcesService{
  private base='/api/si/v1/candidate-sources';
  constructor(private readonly http:HttpClient){}
  private headers(key:string):HttpHeaders{return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});}
  status(key:string):Observable<SiSourceImportSummary>{
    return this.http.get<SiSourceImportSummary>(this.base,{headers:this.headers(key)});
  }
  preview(key:string,body:{sourceType:SiExcelSource;fileName:string;workbookBase64:string}):Observable<SiImportPreview>{
    return this.http.post<SiImportPreview>(this.base+'/preview',body,{headers:this.headers(key)});
  }
  commit(key:string,body:{sourceType:SiExcelSource;previewId:string;actor:string}):Observable<{
    status:string;sourceType:string;importedEvents:number;duplicateEvents:number;batchId:string
  }>{
    return this.http.post<{status:string;sourceType:string;importedEvents:number;
      duplicateEvents:number;batchId:string}>(this.base+'/commit',body,{headers:this.headers(key)});
  }
}
