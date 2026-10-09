import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { DashboardDefinition, DashboardMenuPlacement } from './nmc-dashboard-store.service';

interface DashboardListResponse {status:'ok';dashboards:DashboardDefinition[];}
export interface PublishedDashboardMenuItem {
  id:string;title:string;menuPlacement:DashboardMenuPlacement;
}
interface PublishedDashboardMenuResponse {
  status:'ok';dashboards:PublishedDashboardMenuItem[];
}
interface DashboardOneResponse {status:'ok';dashboard:DashboardDefinition;}
export interface DashboardRevision {version:number;action:string;role:string;at:string;}
interface DashboardRevisionsResponse {status:'ok';revisions:DashboardRevision[];}

@Injectable({providedIn:'root'})
export class NmcDashboardWorkspaceService {
  private readonly root='/api/ai/dashboards';
  private editorKey='';
  private publisherKey='';

  constructor(private readonly http:HttpClient){}

  /** Lists published dashboard links only; never includes drafts or widget data. */
  publishedMenu():Observable<PublishedDashboardMenuResponse>{
    return this.http.get<PublishedDashboardMenuResponse>(this.root+'/published');
  }

  list():Observable<DashboardListResponse>{
    return this.http.get<DashboardListResponse>(this.root);
  }

  get(id:string):Observable<DashboardOneResponse>{
    return this.http.get<DashboardOneResponse>(this.root+'/'+encodeURIComponent(id));
  }

  /** Public read-only representation; draft/archived dashboards return 404. */
  published(id:string):Observable<DashboardOneResponse>{
    return this.http.get<DashboardOneResponse>(
      this.root+'/published/'+encodeURIComponent(id)
    );
  }

  revisions(id:string):Observable<DashboardRevisionsResponse>{
    return this.http.get<DashboardRevisionsResponse>(this.root+'/'+encodeURIComponent(id)+'/revisions');
  }

  create(dashboard:DashboardDefinition):Observable<DashboardOneResponse>{
    const key=this.requireKey('editor');
    return this.http.post<DashboardOneResponse>(this.root,{dashboard},{headers:this.headers(key)})
      .pipe(catchError(err=>this.catchCredentialFailure(err,'editor')));
  }

  save(dashboard:DashboardDefinition,expectedVersion:number):Observable<DashboardOneResponse>{
    const key=this.requireKey('editor');
    const payload={dashboard:{...dashboard,version:expectedVersion}};
    return this.http.put<DashboardOneResponse>(
      this.root+'/'+encodeURIComponent(dashboard.id),payload,{headers:this.headers(key)}
    ).pipe(catchError(err=>this.catchCredentialFailure(err,'editor')));
  }

  publish(id:string,version:number):Observable<DashboardOneResponse>{
    const key=this.requireKey('publisher');
    return this.http.post<DashboardOneResponse>(
      this.root+'/'+encodeURIComponent(id)+'/publish',{version},{headers:this.headers(key)}
    ).pipe(catchError(err=>this.catchCredentialFailure(err,'publisher')));
  }

  archive(id:string,version:number):Observable<{status:'ok'}>{
    const key=this.requireKey('editor');
    return this.http.request<{status:'ok'}>('DELETE',this.root+'/'+encodeURIComponent(id),{
      body:{version},headers:this.headers(key)
    }).pipe(catchError(err=>this.catchCredentialFailure(err,'editor')));
  }

  private headers(key:string):HttpHeaders {
    return new HttpHeaders({'X-NMC-DASHBOARD-KEY':key});
  }

  private requireKey(kind:'editor'|'publisher'):string{
    const prior=kind==='editor'?this.editorKey:this.publisherKey;
    if(prior)return prior;
    const value=window.prompt(
      kind==='editor'
        ?'Enter the authorized dashboard editor access key (held in this tab only).'
        :'Enter the authorized dashboard publishing access key (held in this tab only).'
    );
    if(!value?.trim())throw new Error('ACCESS_KEY_REQUIRED');
    if(kind==='editor')this.editorKey=value.trim();
    else this.publisherKey=value.trim();
    return value.trim();
  }

  private catchCredentialFailure(error:unknown,kind:'editor'|'publisher'):Observable<never>{
    if(error instanceof HttpErrorResponse && error.status===403){
      if(kind==='editor')this.editorKey='';
      else this.publisherKey='';
    }
    return throwError(()=>error);
  }

  readableError(error:unknown,arabic=false):string{
    const code=(error instanceof HttpErrorResponse
      ?(error.error as {error?:string}|null)?.error
      :error instanceof Error?error.message:null)||'DASHBOARD_STORE_UNAVAILABLE';
    const messages:Record<string,[string,string]>={
      ACCESS_KEY_REQUIRED:['A valid management access key is required.','يتطلب الإجراء مفتاح وصول معتمد.'],
      DASHBOARD_ACCESS_DENIED:['Access key was not accepted.','مفتاح الوصول غير صحيح.'],
      DASHBOARD_WRITE_NOT_CONFIGURED:['Workspace editing is not configured on the server.','إدارة لوحات المعلومات غير مفعلة على الخادم.'],
      DASHBOARD_SCHEMA_NOT_READY:['Central dashboard storage is not installed.','لم يتم تهيئة التخزين المركزي للوحات المعلومات.'],
      DASHBOARD_VERSION_CONFLICT:['Another version exists. Refresh shared dashboards before saving.','هناك إصدار أحدث. حدّث لوحات المعلومات المشتركة قبل الحفظ.'],
      PUBLISHED_DASHBOARD_LOCKED:['Published dashboards are read-only. Create an editable copy.','اللوحات المنشورة للعرض فقط. أنشئ نسخة قابلة للتعديل.'],
      DASHBOARD_STORE_UNAVAILABLE:['Workspace service is unavailable.','خدمة إدارة اللوحات غير متاحة.']
    };
    const entry=messages[code];
    return entry?entry[arabic?1:0]:(arabic?'تعذر تنفيذ العملية.':'Operation could not be completed.');
  }
}
