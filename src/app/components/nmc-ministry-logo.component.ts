import {ChangeDetectionStrategy,Component} from '@angular/core';
import {LanguageService} from '../services/language.service';

/**
 * One authoritative bilingual ministry wordmark used by NMC / Smart Inspection
 * headers. The transparent gold logo needs a dark plate for readable contrast.
 * Keep the supplied artwork's aspect ratio; NEVER mirror the UAE emblem in RTL.
 */
@Component({
  selector:'app-nmc-ministry-logo',
  standalone:true,
  template:`
    <span class="ministry-logo-plate" [attr.dir]="'ltr'">
      <img [src]="lang.isArabic?'/branding/uae-moei-ar.png':'/branding/uae-moei-en.png'"
           [alt]="lang.isArabic?
             'الإمارات العربية المتحدة – وزارة الطاقة والبنية التحتية':
             'United Arab Emirates – Ministry of Energy & Infrastructure'"
           width="368" height="80" decoding="async" fetchpriority="high"/>
    </span>
  `,
  styles:[`
    :host{display:inline-flex;flex:0 0 auto;width:260px;max-width:100%;height:60px}
    .ministry-logo-plate{display:flex;justify-content:center;align-items:center;
      width:100%;height:100%;padding:5px 8px;background:#133947;
      border:1px solid #244d57;border-radius:11px;overflow:hidden;
      box-shadow:0 2px 7px rgba(21,47,60,.13)}
    img{display:block;object-fit:contain;object-position:center;
      width:100%;height:100%;max-width:100%;max-height:100%}
    @media (max-width:1220px){:host{width:218px;height:54px}}
    @media (max-width:700px){:host{width:157px;height:46px}
      .ministry-logo-plate{padding:3px 4px;border-radius:8px}}
    @media (max-width:430px){:host{width:124px;height:44px}}
  `],
  changeDetection:ChangeDetectionStrategy.OnPush
})
export class NmcMinistryLogoComponent{
  constructor(public readonly lang:LanguageService){}
}
