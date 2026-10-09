import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NmcVesselProfile } from '../data/nmc-vessel-catalog';
import {
  NMC_OPERATIONAL_VESSELS,
  getOperationalVesselByImo
} from '../data/nmc-expanded-vessel-catalog';
import { LanguageService } from '../services/language.service';
import { NmcRiskEngineService } from '../services/nmc-risk-engine.service';
import {
  NmcCaseStateService,
  NmcInspectionOutcome
} from '../services/nmc-case-state.service';
import {NmcCasesService,NmcCentralCase} from '../services/nmc-cases.service';

type CheckStatus = 'Pending' | 'Pass' | 'Deficiency' | 'N/A';
type Severity = 'Minor' | 'Major' | 'Critical';

interface InspectionCheck {
  id: string;
  category: string;
  title: string;
  focusReason: string;
  sourceEvidence: string;
  status: CheckStatus;
  severity: Severity;
  note: string;
  aiSuggested: boolean;
}

@Component({
  selector: 'app-nmc-smart-inspection',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NmcNavigationComponent],
  templateUrl: './nmc-smart-inspection.component.html',
  styleUrl: './nmc-smart-inspection.component.css'
})
export class NmcSmartInspectionComponent implements OnInit {
  vessel!: NmcVesselProfile;
  checks: InspectionCheck[] = [];
  inspectorName = 'A. Al Mansoori';
  generalNote = '';
  submitted = false;
  existingOutcome?: NmcInspectionOutcome;
  centralCase:NmcCentralCase|null=null;
  centralLoading=true;
  centralBusy=false;
  centralError='';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    public lang: LanguageService,
    private caseState: NmcCaseStateService,
    private riskEngine: NmcRiskEngineService,
    private readonly cases:NmcCasesService
  ) {}

  ngOnInit(): void {
    const imo = this.route.snapshot.paramMap.get('imo') || NMC_OPERATIONAL_VESSELS[0].imo;
    const profile = getOperationalVesselByImo(imo) || NMC_OPERATIONAL_VESSELS[0];
    this.vessel = this.riskEngine.applyToVessel(profile);
    this.existingOutcome = this.caseState.getInspectionOutcome(this.vessel.imo);
    this.buildChecklist();
    this.cases.byImo(this.vessel.imo).subscribe({
      next:result=>{
        this.centralLoading=false;
        this.centralCase=result.case?.status==='RESOLVED'?null:result.case;
        // Rebuild after loading the central source assessment so severity isn't
        // inferred from the unrelated 87-point catalog fixture.
        this.buildChecklist();
        if(this.centralCase?.inspectionOutcome){
          const o=this.centralCase.inspectionOutcome;
          this.existingOutcome={...o,riskReduction:0,inspector:'Smart Inspection',
            result:o.result as NmcInspectionOutcome['result']};
          this.submitted=true;
        } else {
          // Central case is the source of truth; ignore old browser-only data.
          this.existingOutcome=undefined;
          this.submitted=false;
        }
      },
      error:error=>{
        this.centralLoading=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
      }
    });
  }

  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
    const snapshot = new Map(
      this.checks.map(item => [item.id, {
        status: item.status,
        severity: item.severity,
        note: item.note
      }])
    );
    this.buildChecklist();
    this.checks.forEach(item => {
      const previous = snapshot.get(item.id);
      if (previous) Object.assign(item, previous);
    });
  }

  get caseId(): string {
    return this.centralCase?'NMC-'+this.centralCase.id.slice(0,8).toUpperCase():'—';
  }

  get inspectionId(): string {
    return `NMC-INS-2026-${this.vessel.imo.slice(-4)}`;
  }

  // Case-originated inspection must use the saved AI assessment at case creation,
  // not the unrelated synthetic vessel-catalog risk (e.g. 87 vs saved 60).
  get incomingRisk(): number {
    return this.centralCase?.sourceScore ?? this.vessel.risk;
  }

  get riskLabel(): string {
    const level = this.riskEngine.levelForScore(this.incomingRisk);
    const map: Record<string,string> = {
      Critical: this.copy('Critical', 'حرج'),
      High: this.copy('High', 'مرتفع'),
      Watch: this.copy('Watch', 'مراقبة'),
      Normal: this.copy('Normal', 'طبيعي')
    };
    return map[level] || level;
  }

  get riskClass(): string {
    return this.riskEngine.levelForScore(this.incomingRisk).toLowerCase();
  }

  get completedChecks(): number {
    return this.checks.filter(item => item.status !== 'Pending').length;
  }

  get progress(): number {
    return Math.round((this.completedChecks / this.checks.length) * 100);
  }

  get findings(): InspectionCheck[] {
    return this.checks.filter(item => item.status === 'Deficiency');
  }

  get criticalFindings(): number {
    return this.findings.filter(item => item.severity === 'Critical').length;
  }

  get majorFindings(): number {
    return this.findings.filter(item => item.severity === 'Major').length;
  }

  get canSubmit(): boolean {
    return this.completedChecks === this.checks.length && !!this.inspectorName.trim();
  }

  get resultLabel(): string {
    if (this.criticalFindings > 0) return this.copy('Follow-up Required', 'تتطلب متابعة');
    if (this.findings.length > 0) return this.copy('Completed with Findings', 'مكتملة مع ملاحظات');
    return this.copy('Cleared', 'مستوفاة');
  }

  // Inspection Pass/Fail alone is not a new five-factor A01/A02 risk assessment.
  // Until evidence refresh + deterministic recalculation completes, risk impact is UNKNOWN.

  setStatus(item: InspectionCheck, status: CheckStatus): void {
    item.status = status;
    if (status !== 'Deficiency') {
      item.note = '';
    }
  }

  setSeverity(item: InspectionCheck, severity: Severity): void {
    item.severity = severity;
  }

  submitInspection(): void {
    if (!this.canSubmit) return;

    const result: NmcInspectionOutcome['result'] =
      this.criticalFindings > 0
        ? 'Follow-up Required'
        : this.findings.length > 0
          ? 'Completed with Findings'
          : 'Cleared';

    const summary = this.findings.length
      ? this.copy(
          `${this.findings.length} finding(s) recorded. ${this.majorFindings} major and ${this.criticalFindings} critical.`,
          `تم تسجيل ${this.findings.length} ملاحظات؛ منها ${this.majorFindings} كبيرة و${this.criticalFindings} حرجة.`
        )
      : this.copy(
          'Priority inspection completed without an outstanding deficiency requiring additional NMC action.',
          'اكتملت المعاينة ذات الأولوية دون وجود ملاحظة معلقة تتطلب إجراءً إضافياً من المركز البحري الوطني.'
        );

    const outcome: NmcInspectionOutcome = {
      inspectionId: this.inspectionId,
      completedAt: '23:35',
      result,
      findingsCount: this.findings.length,
      criticalFindings: this.criticalFindings,
      riskReduction: 0, // compatibility-only local DTO; never treated as verified risk impact
      summary: this.generalNote.trim() || summary,
      inspector: this.inspectorName.trim()
    };

    if(this.centralLoading||this.centralBusy||this.centralError)return;
    if(!this.centralCase){
      this.centralError=this.copy(
        'Open an acknowledged alert as a central maritime case before submitting this inspection.',
        'افتح حالة مركزية من تنبيه مستلم قبل تسجيل نتيجة المعاينة.');
      return;
    }
    this.centralBusy=true;
    this.cases.inspection(this.centralCase,{
      inspectionId:outcome.inspectionId,result:outcome.result,
      findingsCount:outcome.findingsCount,criticalFindings:outcome.criticalFindings,
      summary:outcome.summary
    }).subscribe({
      next:response=>{
        this.centralBusy=false;
        this.centralCase=response.case;
        // Existing preview consumers remain compatible; Oracle is authoritative.
        this.caseState.setInspectionOutcome(this.vessel.imo,outcome);
        this.existingOutcome=outcome;
        this.submitted=true;
      },
      error:error=>{
        this.centralBusy=false;
        this.centralError=this.cases.readableError(error,this.lang.isArabic);
      }
    });
  }

  returnToCase(): void {
    this.router.navigate(['/moei/nmc/vessel', this.vessel.imo, 'case'], {
      queryParams: this.submitted || this.existingOutcome ? { inspection: 'completed' } : undefined
    });
  }

  private buildChecklist(): void {
    const level = this.riskEngine.levelForScore(this.incomingRisk);
    const critical = level === 'Critical';
    const high = level === 'Critical' || level === 'High';

    this.checks = [
      {
        id: 'fire-safety',
        category: this.copy('Safety', 'السلامة'),
        title: this.copy('Fire safety systems & previous deficiency', 'أنظمة السلامة من الحريق والملاحظة السابقة'),
        focusReason: this.copy(
          'Carry forward the unresolved inspection evidence linked to the NMC case.',
          'نقل أدلة ملاحظة المعاينة غير المغلقة المرتبطة بحالة المركز البحري.'
        ),
        sourceEvidence: `INS-2026-${String(1300 + this.vessel.id).padStart(5,'0')}`,
        status: 'Pending',
        severity: critical ? 'Critical' : 'Major',
        note: '',
        aiSuggested: true
      },
      {
        id: 'certificates',
        category: this.copy('Certificates', 'الشهادات'),
        title: this.copy('Verify onboard statutory certificates', 'التحقق من الشهادات النظامية على متن السفينة'),
        focusReason: this.copy(
          'Certificate condition/conflict contributes to the current vessel risk picture.',
          'تسهم حالة/تعارض الشهادة في صورة المخاطر الحالية للسفينة.'
        ),
        sourceEvidence: `CERT-SC-${this.vessel.imo}`,
        status: 'Pending',
        severity: 'Major',
        note: '',
        aiSuggested: true
      },
      {
        id: 'navigation',
        category: this.copy('Navigation', 'الملاحة'),
        title: this.copy('Bridge equipment & navigation readiness', 'معدات الجسر وجاهزية الملاحة'),
        focusReason: this.copy(
          'Movement behavior was flagged for operational review.',
          'تمت الإشارة إلى سلوك الحركة للمراجعة التشغيلية.'
        ),
        sourceEvidence: `AIS-${this.vessel.mmsi}`,
        status: 'Pending',
        severity: high ? 'Major' : 'Minor',
        note: '',
        aiSuggested: true
      },
      {
        id: 'lifesaving',
        category: this.copy('Safety', 'السلامة'),
        title: this.copy('Life-saving appliances', 'وسائل ومعدات الإنقاذ'),
        focusReason: this.copy(
          'Priority safety verification as part of the focused inspection.',
          'تحقق ذو أولوية من متطلبات السلامة ضمن المعاينة المركزة.'
        ),
        sourceEvidence: this.caseId,
        status: 'Pending',
        severity: 'Major',
        note: '',
        aiSuggested: false
      },
      {
        id: 'pollution',
        category: this.copy('Environment', 'البيئة'),
        title: this.copy('Pollution-prevention equipment & records', 'معدات وسجلات منع التلوث'),
        focusReason: this.copy(
          'Confirm no additional compliance issue is present before case resolution.',
          'التأكد من عدم وجود مشكلة امتثال إضافية قبل إغلاق الحالة.'
        ),
        sourceEvidence: this.caseId,
        status: 'Pending',
        severity: 'Major',
        note: '',
        aiSuggested: false
      },
      {
        id: 'manning',
        category: this.copy('Crew', 'الطاقم'),
        title: this.copy('Minimum safe manning & crew certificates', 'الحد الأدنى للتشغيل الآمن وشهادات الطاقم'),
        focusReason: this.copy(
          'Verify operational readiness and compliance during the priority visit.',
          'التحقق من الجاهزية التشغيلية والامتثال أثناء الزيارة ذات الأولوية.'
        ),
        sourceEvidence: `IMO-${this.vessel.imo}`,
        status: 'Pending',
        severity: 'Major',
        note: '',
        aiSuggested: false
      },
      {
        id: 'hull-machinery',
        category: this.copy('Technical', 'فني'),
        title: this.copy('Hull, machinery & visible condition', 'البدن والآلات والحالة الظاهرة'),
        focusReason: this.copy(
          'Focused technical verification for a vessel under elevated NMC attention.',
          'تحقق فني مركز لسفينة تحت مستوى انتباه مرتفع من المركز البحري.'
        ),
        sourceEvidence: this.caseId,
        status: 'Pending',
        severity: 'Major',
        note: '',
        aiSuggested: false
      },
      {
        id: 'security',
        category: this.copy('Security', 'الأمن'),
        title: this.copy('Ship security & access controls', 'أمن السفينة وضوابط الدخول'),
        focusReason: this.copy(
          'Complete the focused operational inspection picture before returning the result to NMC.',
          'استكمال صورة المعاينة التشغيلية المركزة قبل إعادة النتيجة إلى المركز البحري.'
        ),
        sourceEvidence: this.caseId,
        status: 'Pending',
        severity: 'Minor',
        note: '',
        aiSuggested: false
      }
    ];
  }
}
