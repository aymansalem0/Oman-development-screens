import {CommonModule} from '@angular/common';
import {Component,OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,Router} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {MoeiAuthService} from '../services/moei-auth.service';
import {NmcMinistryLogoComponent} from '../components/nmc-ministry-logo.component';

@Component({
 selector:'app-moei-admin-login',standalone:true,imports:[CommonModule,FormsModule,NmcMinistryLogoComponent],
 templateUrl:'./moei-admin-login.component.html',
 styleUrl:'./moei-admin-login.component.css'
})
export class MoeiAdminLoginComponent implements OnInit{
 username='admin';password='';busy=false;error='';
 mode='google';googleConfigured=false;loading=true;
 constructor(public lang:LanguageService,private auth:MoeiAuthService,
   private router:Router,private route:ActivatedRoute){}
 copy(en:string,ar:string){return this.lang.pick(en,ar);}
 ngOnInit():void{
   const message=this.route.snapshot.queryParamMap.get('error');
   if(message){
     this.error=message==='MOEI_GOOGLE_ACCOUNT_NOT_ALLOWED'?
       this.copy('This Google account is not authorized. Contact an administrator.',
         'حساب Google هذا غير مصرح له بالدخول. تواصل مع مدير النظام.'):
       this.copy('Google sign-in was not completed. Please try again.',
         'لم يكتمل تسجيل الدخول بواسطة Google. حاول مرة أخرى.');
   }
   this.auth.providers().subscribe({
     next:r=>{this.mode=r.mode;this.googleConfigured=r.googleConfigured;this.loading=false;},
     error:()=>{this.loading=false;this.error=this.copy('Authentication service unavailable.',
       'خدمة تسجيل الدخول غير متاحة حالياً.');}
   });
 }
 googleSignIn():void{if(!this.busy&&this.googleConfigured)this.auth.googleSignIn();}
 submit():void{
  if(this.busy||this.mode!=='local'||!this.username.trim()||!this.password)return;
  this.busy=true;this.error='';
  this.auth.login(this.username.trim(),this.password).subscribe({
   next:()=>{this.busy=false;this.password='';void this.router.navigate(['/moei/nmc']);},
   error:()=>{this.busy=false;this.password='';
     this.error=this.copy('Username or password is incorrect.','اسم المستخدم أو كلمة المرور غير صحيحة.');
   }
  });
 }
}
