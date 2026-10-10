import {CommonModule} from '@angular/common';
import {Component,EventEmitter,Input,Output} from '@angular/core';
import {RouterLink} from '@angular/router';
import {LanguageService} from '../services/language.service';
import {NmcMinistryLogoComponent} from './nmc-ministry-logo.component';

/**
 * Shared MOEI platform chrome for NMC and Smart Inspection.
 * The language toggle uses the exact same persisted LanguageService and
 * direction (html[dir] + app-shell[dir]) as all NMC business screens.
 * Platform header never reads or writes NMC/inspection business state.
 */
@Component({
  selector:'app-nmc-platform-header',
  standalone:true,
  imports:[CommonModule,RouterLink,NmcMinistryLogoComponent],
  template:`
    <header class="maritime-topbar" [attr.dir]="lang.dir"
       [attr.aria-label]="pick('MOEI maritime platform header','ترويسة المنصة البحرية لوزارة الطاقة والبنية التحتية')">
      <div class="maritime-brand">
        <app-nmc-ministry-logo class="maritime-ministry-logo"></app-nmc-ministry-logo>
        <div class="maritime-brand-copy">
          <div class="maritime-eyebrow">{{pick('MOEI · Maritime Transformation','وزارة الطاقة والبنية التحتية · التحول البحري')}}</div>
          <h1>{{pick('MOEI Maritime Unified Platform','المنصة البحرية الموحدة لوزارة الطاقة والبنية التحتية')}}</h1>
          <p>{{area==='nmc'
            ?pick('Operational picture · Maritime situational awareness','الصورة التشغيلية · الوعي بالموقف البحري')
            :pick('Smart Inspection · Integrated maritime services','المعاينة الذكية · الخدمات البحرية المتكاملة')}}</p>
        </div>
      </div>
      <div class="maritime-status" *ngIf="area==='nmc'; else siContext">
        <span class="maritime-live" [class.paused]="!feedLive">
          <span class="maritime-pulse"></span>
          {{feedLive?pick('SIMULATED AIS / LRIT FEED','تغذية AIS / LRIT تجريبية')
          :pick('FEED PAUSED','التغذية متوقفة')}}
        </span>
        <span class="maritime-clock">{{clock}}</span>
      </div>
      <ng-template #siContext>
        <div class="maritime-status">
          <span class="maritime-context">{{pick('SMART INSPECTION · POC','المعاينة الذكية · نموذج تجريبي')}}</span>
          <small>{{pick('Same platform · Same business identity','منصة واحدة · هوية مؤسسية موحدة')}}</small>
        </div>
      </ng-template>
      <div class="maritime-actions">
        <button type="button" class="maritime-language" (click)="changeLanguage()"
            [attr.aria-label]="pick('Switch to Arabic','Switch to English')"
            [attr.title]="pick('Switch to Arabic','Switch to English')">
          <span aria-hidden="true">🌐</span> {{lang.isArabic?'English':'العربية'}}
        </button>
        <a routerLink="/moei/nmc/alerts" class="maritime-alerts"
           [attr.aria-label]="pick('Alerts & Notifications','التنبيهات والإشعارات')"
           [attr.title]="pick('Alerts & Notifications','التنبيهات والإشعارات')">
          <span aria-hidden="true">♢</span><b *ngIf="unreadAlerts>0">{{unreadAlerts}}</b>
        </a>
        <div class="maritime-officer">
          <span class="maritime-avatar" aria-hidden="true">NO</span>
          <span><strong>{{pick('NMC Officer','ضابط المركز البحري الوطني')}}</strong>
          <small>{{pick('Duty Operations','العمليات المناوبة')}}</small></span>
        </div>
      </div>
    </header>
  `,
  styleUrl:'./nmc-platform-chrome.component.css'
})
export class NmcPlatformHeaderComponent{
  @Input() area:'nmc'|'smart-inspection'='smart-inspection';
  @Input() feedLive=true;
  @Input() clock='';
  @Input() unreadAlerts=0;
  @Output() languageChanged=new EventEmitter<void>();
  changeLanguage():void{this.lang.toggle();this.languageChanged.emit();}
  constructor(public readonly lang:LanguageService){}
  pick(en:string,ar:string):string{return this.lang.pick(en,ar);}
}

@Component({
  selector:'app-nmc-platform-footer',
  standalone:true,
  imports:[CommonModule,RouterLink],
  template:`
    <footer class="maritime-platform-footer" [attr.dir]="lang.dir">
      <span><strong>{{pick('MOEI Maritime Unified Platform','المنصة البحرية الموحدة لوزارة الطاقة والبنية التحتية')}}</strong>
        · {{pick('Unified Maritime Digital Services Platform','المنصة الموحدة للخدمات البحرية الرقمية')}}</span>
      <span class="maritime-platform-disclaimer">
        {{pick('Smart Inspection & NMC · POC / simulated data — not official operational evidence',
        'المعاينة الذكية والمركز البحري · بيانات تجريبية وليست أدلة تشغيلية رسمية')}}
      </span>
      <a routerLink="/moei/nmc">{{pick('NMC Home','الرئيسية')}}</a>
    </footer>
  `,
  styleUrl:'./nmc-platform-chrome.component.css'
})
export class NmcPlatformFooterComponent{
  constructor(public readonly lang:LanguageService){}
  pick(en:string,ar:string):string{return this.lang.pick(en,ar);}
}
