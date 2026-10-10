import {Injectable} from '@angular/core';
import {HttpClient,HttpHeaders} from '@angular/common/http';
import {Observable,throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';

export type DocumentState='NOT_ANALYZED'|'SOURCE_CHANGED'|'ANALYZING'|'DRAFT_REVIEW'|'APPROVED'|'REJECTED'|'FAILED';
export interface A03Result {
  id:string;imo:string;fileId:string;fileName:string;version:number;
  status:Exclude<DocumentState,'NOT_ANALYZED'|'SOURCE_CHANGED'>;
  analyzedModifiedTime:string|null;
  confidence:number|null;
  extracted?:{
    imo:string|null;vesselName:string|null;documentType:string|null;
    certificateNumber:string|null;issuingAuthority:string|null;
    issueDate:string|null;expiryDate:string|null;
  }|null;
  evidenceQuotes?:string[];
  conflicts?:{field:string;documentValue:string;expectedValue:string|null;reason:string}[];
  reviewedBy?:string|null;reviewedAt?:string|null;reviewReason?:string|null;
  failureCode?:string|null;authenticityVerified?:boolean;
}
export interface VesselDriveDoc{
  fileId:string;name:string;mimeType:string;modifiedTime:string;
  viewUrl:string|null;savedStatus:DocumentState;version:number;
  analysis:A03Result|null;
}
export interface VesselDriveListing{
  status:'ok'|'not_configured';imo:string;driveConnected:boolean;
  documents:VesselDriveDoc[];
}
@Injectable({providedIn:'root'})
export class NmcDocumentsService {
  private editorKey='';
  constructor(private readonly http:HttpClient){}
  private url(imo:string,fileId?:string){
    return '/api/ai/vessels/'+encodeURIComponent(imo)+'/documents'+
      (fileId?'/'+encodeURIComponent(fileId):'');
  }
  list(imo:string):Observable<VesselDriveListing>{
    return this.http.get<VesselDriveListing>(this.url(imo));
  }
  private headers():HttpHeaders|null{
    if(!this.editorKey){
      const k=window.prompt('NMC Editor access key / مفتاح صلاحية المحرر');
      if(!k)return null;
      this.editorKey=k.trim();
    }
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':this.editorKey});
  }
  analyze(imo:string,fileId:string,actor:string):Observable<{status:'ok';analysis:A03Result}>{
    const headers=this.headers();
    if(!headers)return throwError(()=>new Error('ACTION_CANCELLED'));
    if(!window.confirm('Send document text to Airia A03 for analysis? This may incur AI usage cost. No changes to saved risk or certificates.\nإرسال نص المستند إلى A03 للتحليل؟ قد يترتب عليه تكلفة، دون تعديل بيانات السفينة تلقائيًا.'))
      return throwError(()=>new Error('ACTION_CANCELLED'));
    return this.http.post<{status:'ok';analysis:A03Result}>(
      this.url(imo,fileId)+'/analyze',{actor,confirmCost:true},{headers}
    ).pipe(catchError(error=>this.handle(error)));
  }
  review(imo:string,fileId:string,actor:string,decision:'APPROVE'|'REJECT',
    reason:string,expectedVersion:number):Observable<{status:'ok';analysis:A03Result}>{
    const headers=this.headers();
    if(!headers)return throwError(()=>new Error('ACTION_CANCELLED'));
    return this.http.post<{status:'ok';analysis:A03Result}>(
      this.url(imo,fileId)+'/review',
      {actor,decision,reason,expectedVersion},{headers}
    ).pipe(catchError(error=>this.handle(error)));
  }
  private handle(error:any):Observable<never>{
    if(error?.status===403||error?.status===503)this.editorKey='';
    return throwError(()=>error);
  }
  error(error:any,arabic:boolean):string{
    if(error?.message==='ACTION_CANCELLED')
      return arabic?'تم إلغاء الإجراء.':'Action cancelled.';
    const code=error?.error?.error||'';
    const messages:Record<string,[string,string]>={
      GOOGLE_DRIVE_NOT_CONFIGURED:['Configure NMC_DRIVE_ROOT_FOLDER_ID first.','يلزم ضبط مجلد Google Drive أولاً.'],
      GOOGLE_DRIVE_REQUEST_FAILED:['Google Drive read failed. Check folder sharing and service account.','فشل الاتصال بـ Google Drive؛ راجع مشاركة المجلد.'],
      GOOGLE_DRIVE_CREDENTIALS_MISSING:['Google Drive service account credentials are missing.','بيانات اتصال Google Drive غير موجودة.'],
      DOCUMENT_TEXT_UNAVAILABLE_OCR_REQUIRED:['Scanned/image PDF needs OCR. Text extraction did not start A03.','المستند المصور يحتاج OCR؛ لم يتم تشغيل A03.'],
      A03_NOT_ENABLED:['Enable A03 in the backend after confirming the Airia contract.','فعّل A03 على الخادم بعد التأكد من عقد المخرجات.'],
      A03_RESPONSE_CONTRACT_UNVERIFIED:['A03 output does not match the required structured schema; nothing was approved.','مخرجات A03 لا تطابق الهيكل المطلوب؛ لم تُعتمد بيانات.'],
      A03_EVIDENCE_NOT_IN_DOCUMENT:['AI quotation was not found in the document; review blocked.','النص الذي استشهد به AI غير موجود في المستند؛ تم منع اعتماده.'],
      DOCUMENT_IMO_MATCH_REQUIRED:['Document IMO must match the selected vessel before approval.','يجب أن يطابق IMO الموجود بالمستند السفينة قبل الاعتماد.'],
      DOCUMENT_SOURCE_CHANGED:['Document changed in Google Drive. Analyze the new version first.','تغير المستند في Google Drive ويجب إعادة تحليله قبل الاعتماد.'],
      DOCUMENT_VERSION_CONFLICT:['Document changed in another session. Refresh first.','تغير المستند في جلسة أخرى؛ حدّث الصفحة.'],
      DOCUMENT_SCHEMA_NOT_READY:['Oracle migration 015 has not been applied.','لم يتم تنفيذ Migration 015 في Oracle.'],
      DASHBOARD_ACCESS_DENIED:['Invalid editor key.','مفتاح المحرر غير صحيح.']
    };
    const msg=messages[code];
    return msg?msg[arabic?1:0]:(arabic?'تعذر إتمام العملية: ':'Operation failed: ')+(code||error?.status||'UNKNOWN');
  }
}
