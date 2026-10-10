import {CommonModule} from '@angular/common';
import {Component,Input,OnChanges,OnDestroy} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {LanguageService} from '../services/language.service';
import {NmcDocumentsService,VesselDriveListing,VesselDriveDoc} from '../services/nmc-documents.service';

@Component({
  selector:'app-nmc-vessel-documents',
  standalone:true,
  imports:[CommonModule,FormsModule],
  template:`
  <section class="docs-shell" aria-label="Vessel documents and A03">
    <div class="docs-heading">
      <div>
        <small class="kicker">A03 · GOOGLE DRIVE DOCUMENT INTELLIGENCE</small>
        <h3>{{tr('Vessel Documents & AI Analysis','مستندات السفينة والتحليل الذكي')}}</h3>
        <p>{{tr('Google Drive documents by exact IMO. AI extracts are provisional until you review them; they are not proof of certificate authenticity.',
                 'مستندات Google Drive المرتبطة برقم IMO. استخراج AI مبدئي ولا يُعد إثباتًا لأصالة الشهادات قبل مراجعتها من المختص.')}}</p>
      </div>
      <button class="doc-secondary" type="button" [disabled]="busy" (click)="refresh()">
        ↻ {{tr('Refresh documents','تحديث المستندات')}}</button>
    </div>
    <div class="doc-notice" *ngIf="listing?.status==='not_configured'">
      {{tr('Google Drive folder is not configured yet. Specify the authorized root folder and service account in the backend.',
            'لم يتم ضبط مجلد Google Drive. يلزم تحديد المجلد المسموح به وحساب الخدمة على الخادم.')}}
    </div>
    <div class="doc-error" role="alert" *ngIf="error">{{error}}</div>
    <div class="doc-success" role="status" *ngIf="message">✓ {{message}}</div>
    <p *ngIf="loading">{{tr('Loading Drive file metadata…','جارٍ تحميل بيانات المستندات من Drive…')}}</p>
    <div class="doc-editor" *ngIf="listing?.driveConnected">
      <label>{{tr('Reviewer / operator name','اسم المراجع أو الموظف')}}
        <input [(ngModel)]="actor" maxlength="100" [placeholder]="tr('Enter name','أدخل الاسم')">
      </label>
      <span>{{tr('Paid A03 requests run only after explicit confirmation. You may analyze one document at a time.',
                'تشغيل A03 المدفوع يتطلب تأكيدًا صريحًا، مع تحليل مستند واحد في كل مرة.')}}</span>
    </div>
    <div *ngIf="listing?.status==='ok'&&!listing?.documents?.length&&!loading" class="doc-notice">
      {{tr('No eligible PDF, Google Doc or text file found inside the exact IMO folder or with an IMO filename under the permitted root.',
            'لا توجد ملفات PDF أو Google Docs أو نصوص مناسبة داخل مجلد IMO أو بأسماء مرتبطة به في المجلد المسموح.')}}
    </div>
    <div class="doc-rows" *ngIf="listing?.documents?.length">
      <article class="doc-card" *ngFor="let doc of listing?.documents" [class.doc-approved]="doc.savedStatus==='APPROVED'">
        <div class="doc-top">
          <div class="doc-icon">▤</div>
          <div class="doc-name">
            <strong>{{doc.name}}</strong>
            <small>{{doc.mimeType}} · {{doc.modifiedTime|date:'mediumDate'}}</small>
          </div>
          <span class="doc-badge" [attr.data-status]="doc.savedStatus">{{state(doc.savedStatus)}}</span>
        </div>
        <div class="doc-buttons">
          <a class="doc-secondary" *ngIf="doc.viewUrl" [href]="doc.viewUrl" target="_blank" rel="noopener noreferrer">
            {{tr('View on Google Drive','عرض على Google Drive')}} ↗
          </a>
          <button type="button" class="doc-primary"
            [disabled]="busy||!actor.trim()||doc.savedStatus==='APPROVED'"
            (click)="analyze(doc)">✦ {{tr('Analyze with A03','تحليل باستخدام A03')}}</button>
        </div>
        <ng-container *ngIf="doc.analysis as a">
          <div class="doc-output" *ngIf="doc.savedStatus!=='SOURCE_CHANGED'&&a.extracted as e">
            <div class="doc-heading-small">
              <b>{{tr('Extracted fields — AI draft','الحقول المستخرجة — مسودة AI')}}</b>
              <span>{{tr('AI confidence (not authenticity)','ثقة AI (وليست توثيقًا للأصالة)')}}:
                {{a.confidence===null?'—':(a.confidence*100|number:'1.0-0')+'%'}}</span>
            </div>
            <div class="doc-fields">
              <span><small>IMO</small><b [class.mismatch]="!!e.imo&&e.imo!==imo">{{e.imo||'—'}}</b></span>
              <span><small>{{tr('Document type','نوع المستند')}}</small><b>{{e.documentType||'—'}}</b></span>
              <span><small>{{tr('Certificate number','رقم الشهادة')}}</small><b>{{e.certificateNumber||'—'}}</b></span>
              <span><small>{{tr('Issuer','جهة الإصدار')}}</small><b>{{e.issuingAuthority||'—'}}</b></span>
              <span><small>{{tr('Issue date','تاريخ الإصدار')}}</small><b>{{e.issueDate||'—'}}</b></span>
              <span><small>{{tr('Expiry date','تاريخ الانتهاء')}}</small><b>{{e.expiryDate||'—'}}</b></span>
            </div>
            <div *ngIf="a.documentEntries?.length" class="doc-sections">
              <h4>{{tr('Sections inside vessel document pack','الأقسام المستخرجة من حزمة مستندات السفينة')}}
                ({{a.documentEntries?.length}})</h4>
              <table class="doc-section-table">
                <thead><tr>
                  <th>{{tr('Document / record','المستند / السجل')}}</th>
                  <th>{{tr('Reference','المرجع')}}</th>
                  <th>{{tr('Status','الحالة')}}</th>
                  <th>{{tr('Expiry','الانتهاء')}}</th>
                </tr></thead>
                <tbody><tr *ngFor="let section of a.documentEntries">
                  <td>{{section.documentType}}</td>
                  <td>{{section.certificateNumber||'—'}}</td>
                  <td>{{section.status||'—'}}</td>
                  <td>{{section.expiryDate||'—'}}</td>
                </tr></tbody>
              </table>
              <p>{{tr('Each section is inferred from the PDF text; citations are retained in the reviewed evidence record.',
                      'كل قسم مستخرج من نص PDF، وتُحفظ النصوص الداعمة داخل سجل الأدلة الذي تمت مراجعته.')}}</p>
            </div>
            <p class="doc-warning" *ngIf="a.conflicts?.length">
              ⚠ {{tr('Review these discrepancies','راجع هذه التعارضات')}}:
              <span *ngFor="let issue of a.conflicts">{{issue.reason}} ({{issue.documentValue}}) · </span>
            </p>
            <details *ngIf="a.evidenceQuotes?.length">
              <summary>{{tr('Source quotations from the document','النصوص المستشهد بها من المستند')}}</summary>
              <blockquote *ngFor="let quote of a.evidenceQuotes">{{quote}}</blockquote>
            </details>
            <div *ngIf="a.status==='DRAFT_REVIEW'" class="doc-review">
              <label>{{tr('Review reason (mandatory)','سبب المراجعة (إجباري)')}}
                <input [(ngModel)]="reason" maxlength="500" [placeholder]="tr('At least 8 characters','8 أحرف على الأقل')"></label>
              <button type="button" class="doc-primary" [disabled]="busy||!actor.trim()||reason.trim().length<8||e.imo!==imo"
                (click)="review(doc,'APPROVE')">✓ {{tr('Approve extract','اعتماد البيانات المستخرجة')}}</button>
              <button type="button" class="doc-secondary" [disabled]="busy||!actor.trim()||reason.trim().length<8"
                (click)="review(doc,'REJECT')">{{tr('Reject','رفض')}}</button>
              <small>{{tr('Approval exposes only reviewed values to the next explicit A02 run and future A04 dossier. No risk or registry record is changed here.',
                         'الاعتماد يتيح القيم التي تمت مراجعتها لتشغيل A02 لاحقًا ولملف A04؛ لا يتم تعديل المخاطر أو السجل هنا.')}}</small>
            </div>
            <p class="doc-approved-text" *ngIf="a.status==='APPROVED'">✓
              {{tr('Reviewed by','تمت المراجعة بواسطة')}} {{a.reviewedBy}} · {{a.reviewedAt|date:'medium'}}
            </p>
          </div>
          <p class="doc-warning" *ngIf="a.status==='FAILED'">
            {{tr('Analysis failed; no fields were approved.','فشل التحليل ولم يتم اعتماد أي بيانات.')}} {{a.failureCode}}</p>
          <p class="doc-warning" *ngIf="doc.savedStatus==='SOURCE_CHANGED'">
            {{tr('The Drive file changed since analysis. Analyze this version again.',
                  'تم تعديل الملف على Google Drive منذ آخر تحليل؛ يلزم إعادة التحليل.')}}</p>
        </ng-container>
      </article>
    </div>
  </section>
  `,
  styles:[`
    .docs-shell{background:#fff;border:1px solid #e3ebed;border-radius:17px;padding:23px;color:#28526a}
    .docs-heading{display:flex;justify-content:space-between;align-items:start;gap:18px;margin-bottom:20px}
    .docs-heading h3{font-size:19px;margin:8px 0;color:#143f58}
    .docs-heading p{font-size:12px;line-height:1.7;color:#658195;max-width:760px}
    .kicker{font-size:10px;color:#00897f;font-weight:800;letter-spacing:1px}
    .doc-editor{display:flex;align-items:end;gap:17px;flex-wrap:wrap;padding:15px;background:#eff9f7;border-radius:10px;font-size:11px;color:#537381;margin-bottom:16px}
    .doc-editor label,.doc-review label{display:flex;flex-direction:column;gap:7px;min-width:200px;font-weight:700}
    input{border:1px solid #cbdde2;border-radius:8px;padding:10px;font-size:12px}
    .doc-card{border:1px solid #dce9ed;border-radius:12px;margin:13px 0;padding:16px;background:#fff}
    .doc-card.doc-approved{border-color:#a8d8bf;background:#fbfffc}
    .doc-top{display:flex;align-items:center;gap:12px}
    .doc-icon{background:#eaf7f9;color:#087d8a;padding:10px;border-radius:9px;font-size:20px}
    .doc-name{flex:1;min-width:0}.doc-name strong{display:block;overflow-wrap:anywhere;font-size:13px}
    .doc-name small{display:block;color:#79909b;font-size:10px;margin-top:5px}
    .doc-badge{font-size:10px;font-weight:800;border-radius:30px;padding:6px 9px;background:#edf1f4;color:#68808b}
    .doc-badge[data-status="APPROVED"]{background:#e3f6ea;color:#198454}
    .doc-badge[data-status="DRAFT_REVIEW"]{background:#fff0d9;color:#996012}
    .doc-badge[data-status="SOURCE_CHANGED"]{background:#ffece8;color:#b95037}
    .doc-buttons{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}
    .doc-primary,.doc-secondary{border-radius:8px;font-size:11px;font-weight:750;padding:9px 12px;cursor:pointer;text-decoration:none;display:inline-block}
    .doc-primary{background:#068e84;color:white;border:1px solid #068e84}
    .doc-secondary{background:#fff;color:#196d74;border:1px solid #bddcdb}
    button:disabled{opacity:.45;cursor:not-allowed}
    .doc-output{margin-top:15px;border-top:1px solid #e8eeee;padding-top:13px}
    .doc-heading-small{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:11px}
    .doc-heading-small span{color:#758b95}
    .doc-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:13px}
    .doc-fields span{border:1px solid #e5edf0;border-radius:8px;padding:10px;overflow-wrap:anywhere}
    .doc-fields small{display:block;color:#78909c;font-size:10px}
    .doc-fields b{display:block;font-size:11px;margin-top:5px}
    .doc-fields b.mismatch{color:#c43b42}
    .doc-warning,.doc-error{margin-top:12px;padding:12px;background:#fff0e9;border:1px solid #f5d2c0;border-radius:8px;color:#a85437;font-size:12px;line-height:1.6}
    .doc-success{padding:10px;background:#eaf8f0;color:#13784e;border-radius:8px;margin:10px 0;font-size:11px}
    .doc-notice{padding:16px;background:#edf6fc;color:#416982;border-radius:10px;margin:14px 0;font-size:12px}
    .doc-review{display:flex;align-items:flex-end;flex-wrap:wrap;gap:10px;margin-top:16px;padding:14px;background:#f6faf9;border-radius:10px}
    .doc-review small{width:100%;color:#647f88;font-size:10px;line-height:1.6}
    .doc-approved-text{font-size:11px;color:#178457}
    .doc-sections{margin:15px 0;padding:12px;background:#f8fbfc;border:1px solid #e3eff0;border-radius:10px}
    .doc-sections h4{font-size:12px;margin:0 0 12px;color:#275771}
    .doc-sections p{font-size:10px;color:#698595}
    .doc-section-table{width:100%;border-collapse:collapse;font-size:11px}
    .doc-section-table th,.doc-section-table td{padding:9px;border-bottom:1px solid #dfecef;text-align:start}
    .doc-section-table th{background:#f0f7f8;color:#4d7382;font-weight:800}
    blockquote{font-size:11px;border-inline-start:3px solid #a6d8ca;margin:9px 0;padding:6px 10px;background:#f6fbfa;color:#526f7d}
    details summary{font-size:11px;cursor:pointer;margin-top:12px}
    @media(max-width:760px){.doc-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.docs-heading{flex-direction:column}.doc-top{flex-wrap:wrap}}
  `]
})
export class NmcVesselDocumentsComponent implements OnChanges,OnDestroy {
  @Input() imo='';
  listing:VesselDriveListing|null=null;
  busy=false;loading=false;error='';message='';actor='';reason='';
  private readonly subs=new Subscription();
  constructor(private readonly documents:NmcDocumentsService,public lang:LanguageService){}
  tr(en:string,ar:string){return this.lang.pick(en,ar);}
  state(s:string):string{
    const labels:Record<string,[string,string]>={
      NOT_ANALYZED:['Not analyzed','لم يُحلل'],
      SOURCE_CHANGED:['Source changed','تم تغيير المستند'],
      ANALYZING:['Analyzing','جارٍ التحليل'],
      DRAFT_REVIEW:['Awaiting review','بانتظار المراجعة'],
      APPROVED:['Human approved','معتمد بعد المراجعة'],
      REJECTED:['Rejected','مرفوض'],
      FAILED:['Analysis failed','فشل التحليل']
    };
    const x=labels[s];return x?this.tr(x[0],x[1]):s;
  }
  ngOnChanges():void{if(/^\d{7}$/.test(this.imo))this.refresh();}
  ngOnDestroy():void{this.subs.unsubscribe();}
  refresh():void{
    if(this.busy)return;
    this.loading=true;this.error='';
    this.subs.add(this.documents.list(this.imo).subscribe({
      next:data=>{this.listing=data;this.loading=false;},
      error:err=>{this.error=this.documents.error(err,this.lang.isArabic);this.loading=false;}
    }));
  }
  analyze(doc:VesselDriveDoc):void{
    if(this.busy||!this.actor.trim())return;
    this.busy=true;this.error='';this.message='';
    this.subs.add(this.documents.analyze(this.imo,doc.fileId,this.actor.trim()).subscribe({
      next:()=>{this.busy=false;this.reason='';
        this.message=this.tr('A03 draft saved. Review the extracted data before approval.',
          'تم حفظ مسودة A03. راجع البيانات المستخرجة قبل اعتمادها.');this.refresh();},
      error:err=>{this.busy=false;this.error=this.documents.error(err,this.lang.isArabic);this.refreshAfterError();}
    }));
  }
  review(doc:VesselDriveDoc,decision:'APPROVE'|'REJECT'):void{
    if(this.busy||!doc.analysis||this.reason.trim().length<8||!this.actor.trim())return;
    this.busy=true;this.error='';this.message='';
    this.subs.add(this.documents.review(this.imo,doc.fileId,
      this.actor.trim(),decision,this.reason.trim(),doc.analysis.version).subscribe({
      next:()=>{this.busy=false;this.reason='';
        this.message=this.tr('Review recorded. Historical evidence preserved.','تم تسجيل المراجعة مع الاحتفاظ بالتاريخ.');this.refresh();},
      error:err=>{this.busy=false;this.error=this.documents.error(err,this.lang.isArabic);this.refreshAfterError();}
    }));
  }
  private refreshAfterError():void{
    // Avoid losing the backend error message while loading the latest record.
    this.loading=true;
    this.subs.add(this.documents.list(this.imo).subscribe({
      next:data=>{this.listing=data;this.loading=false;},
      error:()=>{this.loading=false;}
    }));
  }
}
