import {CommonModule} from '@angular/common';
import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';

interface AllowedUser{
 email:string;role:'ADMIN'|'VIEWER';active:boolean;linkedGoogleAccount:boolean;
 inspectorId?:string|null;addedAt?:string;addedBy?:string
}
interface ExistingInspector{
 id:string;name:string;source:string;active:true;
 existingOrderCount:number;linkedAccount:string|null
}
@Component({
 selector:'app-moei-user-management',
 standalone:true,imports:[CommonModule,FormsModule,RouterLink],
 template:`
 <main class="users-wrap" [attr.dir]="lang.dir">
  <header>
   <div><p class="eyebrow">MOEI · ACCESS CONTROL</p>
    <h1>{{copy('Google User Management','إدارة مستخدمي Google')}}</h1>
    <p>{{copy('Only explicitly approved Google accounts can enter NMC and Smart Inspection.',
     'فقط حسابات Google المعتمدة صراحة تستطيع الدخول إلى NMC والمعاينة الذكية.')}}</p></div>
   <a routerLink="/moei/nmc">{{copy('Back to NMC','العودة للمركز البحري')}}</a>
  </header>
  <p class="alert" *ngIf="error" role="alert">{{error}}</p>
  <p class="success" *ngIf="success">{{success}}</p>
  <ng-container *ngIf="auth.isAdmin; else forbidden">
   <section class="card">
    <h2>{{copy('Add approved Google account','إضافة حساب Google مصرح به')}}</h2>
    <form (ngSubmit)="add()">
     <label>{{copy('Google email','البريد الإلكتروني في Google')}}
      <input type="email" name="email" required autocomplete="off"
         [(ngModel)]="newEmail" placeholder="name@gmail.com" [disabled]="busy"/></label>
     <label>{{copy('Role','الصلاحية')}}
      <select name="role" [(ngModel)]="newRole" [disabled]="busy">
       <option value="VIEWER">VIEWER — {{copy('Read only','عرض فقط')}}</option>
       <option value="ADMIN">ADMIN — {{copy('Full POC access','مدير النظام')}}</option>
      </select></label>
     <button type="submit" [disabled]="busy||!newEmail.trim()">
      {{copy('Add user','إضافة المستخدم')}}</button>
    </form>
   </section>
   <section class="card">
    <div class="heading"><h2>{{copy('Approved accounts','الحسابات المعتمدة')}}</h2>
      <button type="button" class="secondary" (click)="refresh()" [disabled]="busy">
       {{copy('Refresh','تحديث')}}</button></div>
    <div class="inspector-note">
     <b>⚓ {{copy('Inspector-to-Google Account Mapping','ربط حساب Google بالمفتش البحري')}}</b>
     <p>{{copy('Assign one of the existing ERP inspectors or approved work-order assignees to each Google account. Only the vessels already allocated to that inspector will appear in My Inspections. The assignment does not change the plan or grant supervisor authority.',
      'اربط كل حساب بمفتش موجود في بيانات ERP أو أوامر المعاينة المعتمدة. ستظهر للحساب فقط السفن الموزعة مسبقًا على المفتش في «معايناتي». الربط لا يغير الخطة ولا يمنح صلاحية المشرف.')}}</p>
     <span>{{copy('Existing inspectors','المفتشون الموجودون')}}: {{inspectors.length}}
      · {{copy('Assigned accounts','حسابات تم ربطها')}}: {{linkedCount}}</span>
    </div>
    <div class="table-scroll">
     <table><thead><tr><th>{{copy('Google email','البريد الإلكتروني')}}</th>
      <th>{{copy('Role','الصلاحية')}}</th><th>{{copy('Status','الحالة')}}</th>
      <th>{{copy('Assigned Inspector','المفتش المرتبط')}}</th>
      <th>{{copy('Actions','الإجراءات')}}</th></tr></thead>
      <tbody><tr *ngFor="let user of users">
       <td><strong>{{user.email}}</strong><small>{{user.linkedGoogleAccount?
        copy('Google identity linked','تم الربط بحساب Google'):
        copy('Not signed in yet','لم يسجل الدخول بعد')}}</small></td>
       <td><span class="badge">{{user.role}}</span></td>
       <td><span [class.inactive]="!user.active">{{user.active?
         copy('Active','نشط'):copy('Disabled','موقوف')}}</span></td>
       <td>
        <label class="inspector-select">
         <select [value]="user.inspectorId||''" [disabled]="busy||!user.active||!inspectors.length"
          [attr.aria-label]="copy('Inspector for','المفتش المرتبط بالحساب')+' '+user.email"
          (change)="assignInspector(user,$event)">
          <option value="">{{copy('Not assigned','غير مرتبط')}}</option>
          <option *ngFor="let inspector of inspectors"
           [value]="inspector.id"
           [disabled]="!!inspector.linkedAccount&&inspector.linkedAccount!==user.email">
           {{inspector.name}} ({{inspector.id}})
           · {{inspector.existingOrderCount}} {{copy('assigned vessels','سفينة بالخطة')}}
           {{inspector.linkedAccount&&inspector.linkedAccount!==user.email?
             copy(' · Linked to another account',' · مرتبط بحساب آخر'):''}}
          </option>
         </select>
         <small *ngIf="user.inspectorId">{{inspectorName(user.inspectorId)}}</small>
        </label>
       </td>
       <td><button type="button" class="secondary" [disabled]="busy"
          (click)="toggle(user)">
         {{user.active?copy('Disable','إيقاف'):copy('Enable','تفعيل')}}</button>
        <button type="button" class="secondary" [disabled]="busy"
          (click)="changeRole(user)">
         {{user.role==='ADMIN'?copy('Make viewer','تحويل لعرض فقط'):
           copy('Make admin','تحويل لمدير')}}</button>
       </td>
      </tr></tbody>
     </table></div>
    <p class="note">{{copy('Inspector mapping is recorded on the server with audit history. Unmapped users see no ERP-assigned vessels unless explicitly permitted by the legacy POC identity mode. Changes take effect immediately; no work orders are reassigned.',
       'يُحفظ ربط المفتش على الخادم مع سجل تدقيق. لا تظهر سفن المفتشين لحسابات غير مرتبطة إلا في الوضع التجريبي القديم المصرح به. يبدأ تطبيق الربط فورًا ولا يعيد توزيع أوامر المعاينة.')}}</p>
   </section>
  </ng-container>
  <ng-template #forbidden><div class="card">
    {{copy('Administrator access required.','يجب امتلاك صلاحية مدير النظام.')}}
   </div></ng-template>
 </main>`,
 styles:[`
 :host{display:block;min-height:100%;background:#f2f6f8}
 .users-wrap{padding:28px;max-width:1200px;margin:auto;color:#183e54;font-family:Arial,sans-serif}
 header{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-bottom:25px}
 header a{font-weight:700;color:#0b8077}header p{color:#648290}
 .eyebrow{color:#087e75;font-size:11px;font-weight:900;letter-spacing:1px}
 h1{font-size:28px;margin:9px 0}h2{font-size:18px;margin:0 0 17px}
 .card{background:white;border:1px solid #dbe7e9;border-radius:14px;padding:24px;margin-bottom:22px}
 form{display:flex;align-items:flex-end;flex-wrap:wrap;gap:13px}
 label{font-size:13px;font-weight:700;display:grid;gap:7px;flex:1;min-width:185px}
 input,select{border:1px solid #c7dadd;border-radius:8px;padding:11px;font:inherit;background:white}
 button{background:#088377;border:0;border-radius:8px;color:white;font-weight:700;cursor:pointer;padding:12px 16px}
 button:disabled{opacity:.55;cursor:not-allowed}.secondary{background:#e9f3f3;color:#06796f;margin:3px}
 .heading{display:flex;justify-content:space-between;align-items:center}
 .table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:start}
 th,td{padding:12px;text-align:start;border-bottom:1px solid #e2eded;font-size:13px}
 td small{display:block;color:#80949f;margin-top:4px}
 .badge{background:#eaf5f2;border-radius:7px;padding:6px 10px}
 .inactive{color:#bd453b}.alert{background:#fff0ef;color:#ae382d;padding:13px;border-radius:9px}
 .success{background:#e2f6eb;color:#0c6c42;padding:13px;border-radius:9px}
 .note{font-size:12px;color:#647c89}
 .inspector-note{background:#eff9fb;border:1px solid #cee6e9;
  border-radius:10px;padding:15px 18px;margin-bottom:15px;color:#385e73}
 .inspector-note b{font-size:14px;color:#087e75}
 .inspector-note p{font-size:12px;line-height:1.85}
 .inspector-note span{font-size:11px;color:#6b8799}
 .inspector-select{min-width:280px;display:block}
 .inspector-select select{width:100%;min-width:260px;font-size:11px;padding:10px}
 .inspector-select small{font-size:10px;color:#207a69}
 .table-scroll{max-width:100%;overflow-x:auto}
 .table-scroll table{min-width:1000px}
 @media(max-width:600px){.users-wrap{padding:14px}header{display:block}}
 `]
})
export class MoeiUserManagementComponent implements OnInit{
 users:AllowedUser[]=[];inspectors:ExistingInspector[]=[];
 newEmail='';newRole:'ADMIN'|'VIEWER'='VIEWER';
 busy=false;error='';success='';
 constructor(private http:HttpClient,public auth:MoeiAuthService,public lang:LanguageService){}
 copy(en:string,ar:string):string{return this.lang.pick(en,ar);}
 ngOnInit():void{this.auth.check().subscribe(ok=>{if(ok&&this.auth.isAdmin)this.refresh();});}
 get linkedCount():number{return this.users.filter(u=>u.active&&!!u.inspectorId).length;}
 inspectorName(id:string):string{return this.inspectors.find(i=>i.id===id)?.name||id;}
 loadInspectors():void{
  this.http.get<{inspectors:ExistingInspector[]}>('/api/moei/admin/inspectors')
   .subscribe({next:r=>{this.inspectors=r.inspectors;},
    error:e=>this.failed(e)});
 }
 assignInspector(user:AllowedUser,event:Event):void{
  if(this.busy||!user.active)return;
  const id=(event.target as HTMLSelectElement).value||null;
  if(id===user.inspectorId)return;
  this.update(user,{inspectorId:id});
 }
 refresh():void{
  this.busy=true;this.error='';
  this.http.get<{users:AllowedUser[]}>('/api/moei/admin/users').subscribe({
   next:r=>{this.users=r.users;this.busy=false;this.loadInspectors();},
   error:e=>this.failed(e)
  });
 }
 add():void{
  if(this.busy)return;
  this.busy=true;this.error='';this.success='';
  this.http.post('/api/moei/admin/users',
   {email:this.newEmail.trim(),role:this.newRole}).subscribe({
    next:()=>{this.newEmail='';this.success=this.copy('Account approved.','تم اعتماد الحساب.');this.refresh();},
    error:e=>this.failed(e)
   });
 }
 toggle(user:AllowedUser):void{
  if(this.busy)return;
  this.update(user,{active:!user.active});
 }
 changeRole(user:AllowedUser):void{
  if(this.busy)return;
  this.update(user,{role:user.role==='ADMIN'?'VIEWER':'ADMIN'});
 }
 private update(user:AllowedUser,changes:{
  active?:boolean;role?:'ADMIN'|'VIEWER';inspectorId?:string|null}):void{
  this.busy=true;this.error='';this.success='';
  this.http.patch('/api/moei/admin/users/'+encodeURIComponent(user.email),changes).subscribe({
   next:()=>{this.success=this.copy('Account updated.','تم تعديل الحساب.');this.refresh();},
   error:e=>this.failed(e)
  });
 }
 private failed(e:HttpErrorResponse):void{
  this.busy=false;
  const code=e.error?.error;
  this.error=code==='MOEI_LAST_ADMIN_REQUIRED'?
   this.copy('At least one active administrator is required.',
     'يجب الاحتفاظ بحساب مدير واحد نشط على الأقل.'):
   code==='MOEI_USER_ALREADY_EXISTS'?
   this.copy('Account already exists. Enable it instead.','الحساب موجود بالفعل، يمكنك تفعيله.'):
   code==='MOEI_INSPECTOR_ALREADY_LINKED'?
   this.copy('This inspector is already assigned to another active Google account.',
    'المفتش مرتبط بحساب Google نشط آخر.'):
   code==='MOEI_INSPECTOR_NOT_IN_EXISTING_ROSTER'?
   this.copy('Select an existing inspector from the authoritative ERP/schedule list.',
    'اختر مفتشًا موجودًا في بيانات ERP أو جدول المعاينات المعتمد.'):
   this.copy('Unable to save. Check permissions, email and server connection.',
     'تعذر الحفظ، راجع الصلاحية والبريد واتصال الخادم.');
 }
}
