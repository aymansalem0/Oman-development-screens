import { NmcNavigationComponent } from '../components/nmc-navigation.component';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NMC_OPERATIONAL_VESSELS } from '../data/nmc-expanded-vessel-catalog';
import { NmcFleetAiService, FleetAiAssessment } from '../services/nmc-fleet-ai.service';
import { NmcVesselProfile, RiskLevel } from '../data/nmc-vessel-catalog';
import { LanguageService } from '../services/language.service';
import {
  NmcRiskEngineService,
  CentralPolicyVersion,
  CentralRiskDraft,
  RiskCalculationMode,
  RiskEngineConfig,
  RiskFactorKey,
  RiskPopulationStats
} from '../services/nmc-risk-engine.service';

interface ImpactRow {
  vessel: NmcVesselProfile;
  currentScore: number;
  currentLevel: RiskLevel;
  projectedScore: number;
  projectedLevel: RiskLevel;
  delta: number;
  changedLevel: boolean;
}

@Component({
  selector: 'app-nmc-risk-configuration-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NmcNavigationComponent],
  templateUrl: './nmc-risk-configuration-admin.component.html',
  styleUrl: './nmc-risk-configuration-admin.component.css'
})
export class NmcRiskConfigurationAdminComponent implements OnInit, OnDestroy {
  readonly subscriptions=new Subscription();
  // Only real stored A01/A02 assessments enter the impact projection.
  // Never present browser fixture calibrations as verified/assessed vessels.
  savedInputs:Array<{vessel:NmcVesselProfile;assessment:FleetAiAssessment}>=[];
  savedLoading=true;
  savedError='';
  originalAssessed=0;
  get pendingAssessments():number{return 420-this.originalAssessed;}

  draft!: RiskEngineConfig;
  published!: RiskEngineConfig;
  currentStats!: RiskPopulationStats;
  projectedStats!: RiskPopulationStats;
  impactRows: ImpactRow[] = [];
  validationErrors: string[] = [];
  publishedMessage = '';
  publicationError='';
  publishing=false;
  policyHistory:CentralPolicyVersion[]=[];
  historyLoading=false;
  historyVisible=false;
  savedDraft:CentralRiskDraft|null=null;
  draftReady=false;
  draftSaving=false;
  draftSaveMessage='';
  draftActorName='';
  draftError='';
  private editorAccessKey='';
  private draftRequested=false;
  get canSaveDraft():boolean{
    return this.policyReady&&!this.draftSaving&&!!this.draft?.name?.trim();
  }
  get draftStale():boolean{
    return !!this.savedDraft&&this.savedDraft.baseRevision!==this.activeRevision;
  }
  private publisherAccessKey='';
  private dirtyDraft=false;
  get policyReady():boolean{return this.riskEngine.centralReady&&!!this.riskEngine.activeVersion;}
  get activeRevision():number{return this.riskEngine.activeVersion?.revision||0;}
  get priorBrowserDraft():boolean{return !!this.riskEngine.legacyBrowserDraft;}


  readonly factorKeys: RiskFactorKey[] = [
    'movement',
    'inspection',
    'certificate',
    'dataQuality',
    'history'
  ];

  readonly modes: Array<{value: RiskCalculationMode; en: string; ar: string; descriptionEn: string; descriptionAr: string}> = [
    {
      value: 'weighted',
      en: 'Weighted Evidence Model',
      ar: 'نموذج الأدلة الموزونة',
      descriptionEn: 'Calculates the vessel score from weighted evidence factors.',
      descriptionAr: 'يحسب درجة مخاطر السفينة من عوامل الأدلة الموزونة.'
    },
    {
      value: 'conservative',
      en: 'Conservative Risk Model',
      ar: 'نموذج المخاطر التحفظي',
      descriptionEn: 'Adds extra influence when one factor is materially higher than the combined score.',
      descriptionAr: 'يزيد التأثير عندما يكون أحد عوامل الخطر أعلى بشكل جوهري من الدرجة المجمعة.'
    },
    {
      value: 'max-signal',
      en: 'Highest Signal Blend',
      ar: 'دمج أعلى مؤشر خطر',
      descriptionEn: 'Blends the weighted score with the highest active risk signal.',
      descriptionAr: 'يمزج الدرجة الموزونة مع أعلى مؤشر خطر نشط.'
    }
  ];

  constructor(
    public lang: LanguageService,
    public riskEngine: NmcRiskEngineService,
    private fleetAi:NmcFleetAiService
  ) {}

  ngOnInit(): void {
    this.loadPublished();
    this.subscriptions.add(this.riskEngine.config$.subscribe(()=>{
      if(!this.riskEngine.centralReady)return;
      const next=this.riskEngine.config;
      if(this.published?.version===next.version)return;
      this.published=next;
      if(!this.dirtyDraft)this.draft=this.riskEngine.cloneConfig(next);
      this.validationErrors=this.riskEngine.validate(this.draft);
      this.rebuildPreview();
      this.loadVersionHistory();
      if(!this.draftRequested){
        this.draftRequested=true;this.loadCentralDraft();
      }
    }));
    this.loadVersionHistory();
    this.loadSavedAssessments();
  }
  loadVersionHistory():void{
    this.historyLoading=true;
    this.subscriptions.add(this.riskEngine.history().subscribe({
      next:list=>{this.policyHistory=list;this.historyLoading=false;},
      error:()=>{this.historyLoading=false;}
    }));
  }
  loadCentralDraft():void{
    this.subscriptions.add(this.riskEngine.savedDraft().subscribe({
      next:draft=>{
        this.savedDraft=draft;this.draftReady=true;
        this.draftActorName=draft?.updatedBy||this.draftActorName;
        if(draft&&draft.baseRevision===this.activeRevision&&!this.dirtyDraft){
          this.draft=this.riskEngine.cloneConfig(draft.config);
          this.validationErrors=this.riskEngine.validate(this.draft);
          this.rebuildPreview();
        }
      },
      error:e=>{
        this.draftReady=false;
        this.draftError=this.copy('Central draft unavailable: '+(e?.error?.error||'API_ERROR'),
          'تعذر تحميل المسودة المركزية: '+(e?.error?.error||'API_ERROR'));
      }
    }));
  }
  saveDraft():void{
    if(!this.canSaveDraft)return;
    if(!this.editorAccessKey)this.editorAccessKey=window.prompt(
      'Risk Draft editor key (this browser tab only)')?.trim()||'';
    if(!this.editorAccessKey)return;
    if(!this.draftActorName.trim())
      this.draftActorName=window.prompt('Name of the Risk Editor saving this draft')?.trim()||'';
    if(this.draftActorName.trim().length<3)return;
    this.draftSaving=true;this.draftError='';this.draftSaveMessage='';
    this.subscriptions.add(this.riskEngine.saveCentralDraft(
      this.draft,this.activeRevision,this.savedDraft?.draftRevision||0,
      this.draftActorName,this.editorAccessKey).subscribe({
      next:draft=>{
        this.savedDraft=draft;this.draftReady=true;this.draftSaving=false;
        this.dirtyDraft=false;
        this.draftSaveMessage=this.copy(
          'Draft #'+draft.draftRevision+' saved centrally. It is NOT active until Publish.',
          'تم حفظ المسودة المركزية رقم '+draft.draftRevision+'. لن تصبح نشطة قبل النشر.');
      },
      error:e=>{
        this.draftSaving=false;
        if(e?.status===403)this.editorAccessKey='';
        this.draftError=this.copy('Draft save failed: '+(e?.error?.error||'API_ERROR'),
          'تعذر حفظ المسودة: '+(e?.error?.error||'API_ERROR'));
      }
    }));
  }
  toggleHistory():void{
    this.historyVisible=!this.historyVisible;
    if(this.historyVisible)this.loadVersionHistory();
  }
  previousConfig(entry:CentralPolicyVersion):RiskEngineConfig|null{
    return this.policyHistory.find(x=>x.revision===entry.previousRevision)?.config||null;
  }
  describeVersionDiff(entry:CentralPolicyVersion):string{
    const previous=this.policyHistory.find(x=>x.revision===entry.previousRevision);
    if(!previous)return this.copy('Initial central baseline','النسخة المركزية الأساسية');
    const changes:string[]=[];
    if(entry.config.mode!==previous.config.mode)changes.push('Mode: '+previous.config.mode+' → '+entry.config.mode);
    const a=previous.config.thresholds,b=entry.config.thresholds;
    if(a.watch!==b.watch||a.high!==b.high||a.critical!==b.critical)
      changes.push('Thresholds: '+[a.watch,a.high,a.critical].join('/')+' → '+
        [b.watch,b.high,b.critical].join('/'));
    for(const k of this.factorKeys)if(entry.config.weights[k]!==previous.config.weights[k])
      changes.push(k+': '+previous.config.weights[k]+'% → '+entry.config.weights[k]+'%');
    if(entry.config.name!==previous.config.name)changes.push('Model name updated');
    return changes.join(' · ')||this.copy('Metadata-only update','تعديل البيانات الوصفية فقط');
  }
  importBrowserDraft():void{
    const previous=this.riskEngine.legacyBrowserDraft;
    if(!previous)return;
    if(!window.confirm(this.copy(
      'Import previous browser Risk Settings as an UNPUBLISHED draft? The central active policy remains unchanged until supervisor approval.',
      'استيراد إعدادات المخاطر القديمة بالمتصفح كمسودة غير منشورة؟ ستبقى القواعد المركزية دون تغيير حتى اعتماد المشرف.')))return;
    this.draft=this.riskEngine.cloneConfig(previous);
    this.dirtyDraft=true;this.updateDraft();
  }
  ngOnDestroy():void{this.subscriptions.unsubscribe();}
  reloadSaved():void{this.loadSavedAssessments();}
  private loadSavedAssessments():void{
    this.savedLoading=true;this.savedError='';
    this.subscriptions.add(this.fleetAi.snapshot().subscribe({
      next:snapshot=>{
        const validImos=Object.values(snapshot.results)
          .filter(r=>r.status==='COMPLETED'&&r.assessmentId)
          .map(r=>r.imo);
        const lookup=new Map(NMC_OPERATIONAL_VESSELS.map(v=>[v.imo,v]));
        this.originalAssessed=validImos.length;
        if(!validImos.length){
          this.savedInputs=[];this.savedLoading=false;this.rebuildPreview();
          return;
        }
        this.subscriptions.add(forkJoin(validImos.map(imo=>
          this.fleetAi.assessment(imo).pipe(catchError(()=>of(null)))
        )).subscribe({
          next:all=>{
            this.savedInputs=all.flatMap((assessment,i)=>{
              const vessel=lookup.get(validImos[i]);
              if(!vessel||!assessment||assessment.status!=='COMPLETED'||
                 assessment.authoritative!==false||!Number.isFinite(assessment.score)||
                 !assessment.assessmentId||!Array.isArray(assessment.signals)||
                 !this.factorKeys.every(key=>assessment.signals.filter(x=>
                   x.factor===key&&Number.isFinite(x.severity)).length===1))return [];
              return [{vessel,assessment}];
            });
            this.savedLoading=false;
            this.rebuildPreview();
          },
          error:()=>{
            this.savedInputs=[];this.savedLoading=false;
            this.savedError=this.copy('Could not read the saved AI evidence. No fixture-risk impact will be substituted.',
              'تعذر تحميل أدلة AI المحفوظة، ولن نستخدم حسابات مخاطر افتراضية كبديل.');
            this.rebuildPreview();
          }
        }));
      },
      error:()=>{
        this.savedInputs=[];this.originalAssessed=0;this.savedLoading=false;
        this.savedError=this.copy('Oracle fleet assessment results are unavailable. No preview can be trusted.',
          'نتائج التقييمات المحفوظة في Oracle غير متاحة. لا يمكن الوثوق بالمعاينة.');
        this.rebuildPreview();
      }
    }));
  }


  copy(en: string, ar: string): string {
    return this.lang.pick(en, ar);
  }

  toggleLanguage(): void {
    this.lang.toggle();
  }

  get totalWeight(): number {
    return this.factorKeys.reduce((sum, key) => sum + Number(this.draft.weights[key] || 0), 0);
  }

  get changedVesselCount(): number {
    return this.impactRows.filter(row => row.currentScore !== row.projectedScore).length;
  }

  get changedLevelCount(): number {
    return this.impactRows.filter(row => row.changedLevel).length;
  }

  get averageAbsoluteDelta(): number {
    if (!this.impactRows.length) return 0;
    return Number((
      this.impactRows.reduce((sum, row) => sum + Math.abs(row.delta), 0) / this.impactRows.length
    ).toFixed(1));
  }

  get canPublish(): boolean {
    return this.policyReady&&!this.publishing&&
      this.validationErrors.length === 0 && this.totalWeight === 100 &&
      this.draft.changeReason.trim().length>=10 &&
      this.draft.publishedBy.trim().length>=3;
  }

  get currentModeLabel(): string {
    return this.modeLabel(this.published.mode);
  }

  factorLabel(key: RiskFactorKey): string {
    const labels: Record<RiskFactorKey, [string,string]> = {
      movement: ['Movement & route behavior', 'الحركة وسلوك المسار'],
      inspection: ['Inspection & deficiencies', 'المعاينات والملاحظات'],
      certificate: ['Certificates & regulatory status', 'الشهادات والحالة التنظيمية'],
      dataQuality: ['Data quality & source conflicts', 'جودة البيانات وتعارض المصادر'],
      history: ['Vessel / operator history', 'السجل التاريخي للسفينة / المشغل']
    };
    return this.copy(labels[key][0], labels[key][1]);
  }

  factorDescription(key: RiskFactorKey): string {
    const labels: Record<RiskFactorKey, [string,string]> = {
      movement: ['AIS/LRIT movement patterns, route deviation and operational behavior.', 'أنماط AIS/LRIT والانحراف عن المسار والسلوك التشغيلي.'],
      inspection: ['Open deficiencies, inspection outcomes and technical exposure.', 'الملاحظات المفتوحة ونتائج المعاينة والتعرض الفني.'],
      certificate: ['Certificate validity, conditions and regulatory compliance signals.', 'صلاحية الشهادات وشروطها ومؤشرات الامتثال التنظيمي.'],
      dataQuality: ['Source confidence, completeness and unresolved data conflicts.', 'الثقة في المصادر واكتمال البيانات والتعارضات غير المحلولة.'],
      history: ['Historical vessel, operator and recurring compliance patterns.', 'السجل التاريخي للسفينة والمشغل وأنماط الامتثال المتكررة.']
    };
    return this.copy(labels[key][0], labels[key][1]);
  }

  modeLabel(mode: RiskCalculationMode): string {
    const found = this.modes.find(item => item.value === mode);
    return found ? this.copy(found.en, found.ar) : mode;
  }

  modeDescription(mode: RiskCalculationMode): string {
    const found = this.modes.find(item => item.value === mode);
    return found ? this.copy(found.descriptionEn, found.descriptionAr) : '';
  }

  levelLabel(level: RiskLevel): string {
    const labels: Record<RiskLevel,[string,string]> = {
      Normal: ['Normal','طبيعي'],
      Watch: ['Watch','مراقبة'],
      High: ['High','مرتفع'],
      Critical: ['Critical','حرج']
    };
    return this.copy(labels[level][0], labels[level][1]);
  }

  updateDraft(): void {
    this.dirtyDraft=true;
    this.publishedMessage = '';
    this.draftSaveMessage='';
    this.validationErrors = this.riskEngine.validate(this.draft);
    this.rebuildPreview();
  }

  normalizeWeights(): void {
    const total = this.totalWeight;
    if (!total) return;

    let assigned = 0;
    this.factorKeys.forEach((key, index) => {
      if (index === this.factorKeys.length - 1) {
        this.draft.weights[key] = 100 - assigned;
      } else {
        const normalized = Math.round((this.draft.weights[key] / total) * 100);
        this.draft.weights[key] = normalized;
        assigned += normalized;
      }
    });

    this.updateDraft();
  }

  loadPublished(): void {
    this.published = this.riskEngine.config;
    this.draft = this.riskEngine.cloneConfig(this.published);
    this.dirtyDraft=false;
    this.validationErrors = this.riskEngine.validate(this.draft);
    this.rebuildPreview();
  }

  discardChanges(): void {
    this.draft = this.riskEngine.cloneConfig(this.published);
    this.publishedMessage = '';
    this.dirtyDraft=false;
    this.validationErrors=this.riskEngine.validate(this.draft);
    this.rebuildPreview();
  }

  resetDraftToDefaults(): void {
    const defaults = this.riskEngine.defaults;
    defaults.changeReason = this.copy('Restore default NMC risk model', 'استعادة نموذج مخاطر NMC الافتراضي');
    this.draft = defaults;
    this.publishedMessage = '';
    this.updateDraft();
  }

  publish(): void {
    this.validationErrors=this.riskEngine.validate(this.draft);
    if(!this.canPublish)return;
    const count=this.savedInputs.length;
    if(!window.confirm(this.copy(
      'Publish a NEW centrally active Oracle risk-policy version for all users? Recalculate '+count+
        ' saved AI assessments WITHOUT running agents; keep prior versions, audit and cases?',
      'نشر إصدار مخاطر جديد نشط مركزيًا في Oracle لكل المستخدمين وإعادة حساب '+count+
        ' تقييم AI محفوظ دون استدعاء الوكلاء، مع الاحتفاظ بتاريخ الإصدارات والحالات؟')))return;
    if(!this.publisherAccessKey)
      this.publisherAccessKey=window.prompt('Risk Policy supervisor publishing key (this browser tab only)')?.trim()||'';
    if(!this.publisherAccessKey)return;
    this.publishing=true;this.publicationError='';this.publishedMessage='';
    this.subscriptions.add(this.riskEngine.publishCentral(this.draft,this.activeRevision,
      this.publisherAccessKey).subscribe({
      next:response=>{
        this.publishing=false;this.dirtyDraft=false;
        this.published=this.riskEngine.cloneConfig(response.published.config);
        this.draft=this.riskEngine.cloneConfig(this.published);
        this.rebuildPreview();
        this.loadVersionHistory();
        this.savedDraft=null;
        this.loadCentralDraft(); // stale central draft is shown, never applied over the new policy.
        this.publishedMessage=this.copy(
          'Central version '+response.published.policyRef+' is ACTIVE. '+response.published.projectionCount+
          ' saved assessments were projected; previous versions remain in History. No AI calls.',
          'الإصدار المركزي '+response.published.policyRef+' أصبح نشطًا. تم حساب '+
          response.published.projectionCount+' تقييم محفوظ؛ الإصدارات السابقة في السجل. دون استدعاءات AI.'
        );
      },
      error:e=>{
        this.publishing=false;
        if(e?.status===403)this.publisherAccessKey='';
        const code=e?.error?.error||'RISK_POLICY_PUBLISH_FAILED';
        this.publicationError=this.copy(
          'Central publication failed: '+code+'. The draft was preserved. Refresh policy and retry after checking the migration and key.',
          'فشل النشر المركزي: '+code+'. تم الاحتفاظ بالمسودة. راجع الإصدار الحالي والهجرة ومفتاح المشرف.');
        this.riskEngine.refreshCentral();
      }
    }));
  }

  private evaluateSaved(vessel:NmcVesselProfile,assessment:FleetAiAssessment,config:RiskEngineConfig){
    const severities=Object.fromEntries(this.factorKeys.map(key=>
      [key,assessment.signals.find(signal=>signal.factor===key)!.severity])) as Record<RiskFactorKey,number>;
    return this.riskEngine.evaluateFromAiSignals(vessel,severities,config);
  }

  private calculateSavedStats(config:RiskEngineConfig):RiskPopulationStats{
    const stats:RiskPopulationStats={normal:0,watch:0,high:0,critical:0,attention:0,averageScore:0};
    let total=0;
    for(const {vessel,assessment} of this.savedInputs){
      const risk=this.evaluateSaved(vessel,assessment,config);
      stats[risk.level.toLowerCase() as 'normal'|'watch'|'high'|'critical']++;
      if(risk.level!=='Normal')stats.attention++;
      total+=risk.score;
    }
    stats.averageScore=this.savedInputs.length?
      Math.round(total/this.savedInputs.length*10)/10:0;
    return stats;
  }

  private rebuildPreview(): void {
    if(!this.published||!this.draft)return;
    this.currentStats=this.calculateSavedStats(this.published);
    this.projectedStats=this.calculateSavedStats(this.draft);
    this.impactRows=this.savedInputs.map(({vessel,assessment})=>{
      const current=this.evaluateSaved(vessel,assessment,this.published);
      const projected=this.evaluateSaved(vessel,assessment,this.draft);
      return {
        vessel,currentScore:current.score,currentLevel:current.level,
        projectedScore:projected.score,projectedLevel:projected.level,
        delta:projected.score-current.score,changedLevel:current.level!==projected.level
      };
    }).sort((a,b)=>Number(b.changedLevel)-Number(a.changedLevel)||
      Math.abs(b.delta)-Math.abs(a.delta)||b.projectedScore-a.projectedScore).slice(0,12);
  }
}
