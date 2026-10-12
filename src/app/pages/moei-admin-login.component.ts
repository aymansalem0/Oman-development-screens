import {CommonModule} from '@angular/common';
import {Component} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';

@Component({
 selector:'app-moei-admin-login',standalone:true,imports:[CommonModule,FormsModule],
 templateUrl:'./moei-admin-login.component.html',
 styleUrl:'./moei-admin-login.component.css'
})
export class MoeiAdminLoginComponent{
 username='admin';password='';busy=false;error='';
 constructor(public lang:LanguageService,private auth:MoeiAuthService,private router:Router){}
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 submit():void{
  if(this.busy||!this.username.trim()||!this.password)return;
  this.busy=true;this.error='';
  this.auth.login(this.username.trim(),this.password).subscribe({
   next:()=>{this.busy=false;this.password='';void this.router.navigate(['/moei/nmc']);},
   error:e=>{this.busy=false;this.password='';
    const code=e?.error?.error;
    this.error=code==='MOEI_ADMIN_LOGIN_NOT_CONFIGURED'?
      this.copy('Admin password is not configured on the server. Ask the operator to set MOEI_ADMIN_PASSWORD (12+ characters) and restart ai-proxy.',
        'كلمة مرور المشرف غير مُعدّة على الخادم. اضبط MOEI_ADMIN_PASSWORD ثم أعد تشغيل ai-proxy.'):
      code==='MOEI_LOGIN_RATE_LIMITED'?
        this.copy('Too many attempts. Please retry after one minute.',
          'محاولات كثيرة. يرجى المحاولة بعد دقيقة.'):
      this.copy('Username or password is incorrect.','اسم المستخدم أو كلمة المرور غير صحيحة.');
   }
  });
 }
}
