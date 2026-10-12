import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Router} from '@angular/router';
import {Observable,of,tap,catchError,map} from 'rxjs';

export interface MoeiAdminIdentity{username:string;email?:string;role:'ADMIN'|'VIEWER';provider?:'google'|'local'}
export interface MoeiSessionReply{
  status:'ok';user:MoeiAdminIdentity;expiresAt:string
}
@Injectable({providedIn:'root'})
export class MoeiAuthService{
  private current:MoeiAdminIdentity|null=null;
  get user():MoeiAdminIdentity|null{return this.current;}
  get username():string{return this.current?.username||'';}
  get isAdmin():boolean{return this.current?.role==='ADMIN';}
  providers():Observable<{mode:string;googleConfigured:boolean;googleStart:string}>{
    return this.http.get<{mode:string;googleConfigured:boolean;googleStart:string}>('/api/moei/auth/providers');
  }
  googleSignIn():void{window.location.assign('/api/moei/auth/google/start');}
  constructor(private http:HttpClient,private router:Router){}
  check():Observable<boolean>{
    return this.http.get<MoeiSessionReply>('/api/moei/auth/session').pipe(
      tap(r=>this.current=r.user),map(()=>true),
      catchError(()=>{this.current=null;return of(false);})
    );
  }
  login(username:string,password:string):Observable<MoeiSessionReply>{
    return this.http.post<MoeiSessionReply>('/api/moei/auth/login',
      {username,password}).pipe(tap(r=>this.current=r.user));
  }
  logout():void{
    this.http.post('/api/moei/auth/logout',{}).subscribe({
      next:()=>this.clear(),
      error:()=>this.clear()
    });
  }
  sessionExpired():void{
    this.current=null;
    if(!this.router.url.startsWith('/moei/login'))
      void this.router.navigate(['/moei/login']);
  }
  private clear():void{
    this.current=null;void this.router.navigate(['/moei/login']);
  }
}
