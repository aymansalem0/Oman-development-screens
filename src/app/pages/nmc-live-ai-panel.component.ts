import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { NmcVesselProfile } from '../data/nmc-vessel-catalog';
import { NmcAiIntegrationService, NmcAiriaAgent } from '../services/nmc-ai-integration.service';
import { NmcRiskEngineService, RiskEvaluation, RiskFactorKey } from '../services/nmc-risk-engine.service';

interface AiSignal {
  factor: RiskFactorKey;
  severity: number;
  confidence: number;
  sourceAgent: 'A01' | 'A02';
  evidenceIds: string[];
  reason: string;
}

type AgentStatus = 'idle' | 'running' | 'ok' | 'error';

const FACTORS: RiskFactorKey[] = ['movement', 'inspection', 'certificate', 'dataQuality', 'history'];
const A01_FACTORS: RiskFactorKey[] = ['movement', 'history'];
const A02_FACTORS: RiskFactorKey[] = ['inspection', 'certificate', 'dataQuality'];

@Component({
  standalone: true,
  selector: 'app-nmc-live-ai-panel',
  imports: [CommonModule],
  template: `
    <section class="live-panel" aria-label="Live Airia integration">
      <div class="live-title">
        <div>
          <div class="live-eyebrow">{{ copy('LIVE AI INTEGRATION · DOCKER POC', 'تكامل الذكاء الاصطناعي المباشر · نسخة Docker') }}</div>
          <h3>{{ copy('A01 Maritime Intelligence + A02 Vessel Compliance', 'A01 الاستخبارات البحرية + A02 امتثال السفن') }}</h3>
          <p>{{ copy('Runs only for the selected vessel. Current assessment below stays in synthetic mode until the AI evidence contract is verified.',
                      'يشغّل التحليل للسفينة المختارة فقط. يظل التقييم المعروض أدناه تجريبيًا حتى يتم التحقق من الأدلة ومخرجات الوكلاء.') }}</p>
        </div>
        <button type="button" class="run-btn" (click)="run()" [disabled]="running">
          {{ running ? copy('Running AI agents…', 'جارٍ تشغيل الوكلاء…') : copy('▶ Run Live A01 + A02', '▶ تشغيل A01 وA02 مباشرة') }}
        </button>
      </div>

      <div class="agent-states">
        <span [class.success]="a01Status === 'ok'" [class.failure]="a01Status === 'error'">
          A01: {{ stateLabel(a01Status) }}
        </span>
        <span [class.success]="a02Status === 'ok'" [class.failure]="a02Status === 'error'">
          A02: {{ stateLabel(a02Status) }}
        </span>
        <span class="context-note">IMO {{ vessel.imo }} · {{ copy('SYNTHETIC / INLINE context', 'بيانات تجريبية / مباشرة') }}</span>
      </div>

      <p class="status-message" *ngIf="message">{{ message }}</p>
      <div class="signal-issues" *ngIf="issues.length">
        <div class="signal-issue" *ngFor="let issue of issues">
          <strong>{{ issue.agent }} · {{ issue.factor }} — {{ issue.status }}</strong>
          <span>{{ issue.details }}</span>
        </div>
      </div>

      <div *ngIf="signals.length" class="signal-table-wrap">
        <table class="signal-table">
          <thead><tr>
            <th>{{ copy('Factor', 'عامل المخاطر') }}</th>
            <th>{{ copy('Severity', 'الحدة') }}</th>
            <th>{{ copy('Confidence', 'الثقة') }}</th>
            <th>{{ copy('Agent', 'الوكيل') }}</th>
            <th>{{ copy('Evidence IDs', 'معرّفات الأدلة') }}</th>
            <th>{{ copy('Reason', 'السبب') }}</th>
          </tr></thead>
          <tbody>
            <tr *ngFor="let signal of signals">
              <td>{{ signal.factor }}</td>
              <td>{{ signal.severity }} / 100</td>
              <td>{{ signal.confidence * 100 | number:'1.0-0' }}%</td>
              <td>{{ signal.sourceAgent }}</td>
              <td>{{ signal.evidenceIds.join(', ') }}</td>
              <td>{{ signal.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="live-risk" *ngIf="risk">
        <div>
          <small>{{ copy('Deterministic POC calculation · not adopted into operational view', 'حساب تجريبي حتمي · لم يعتمد بعد في العرض التشغيلي') }}</small>
          <strong>{{ risk.score }} / 100 · {{ risk.level }}</strong>
        </div>
        <p>{{ copy('Computed by the configured Risk Engine from five validated AI severities; not by an LLM.',
                    'محسوب بمحرك المخاطر المهيأ من خمسة عوامل AI تم التحقق منها، وليس بواسطة نموذج لغوي.') }}</p>
      </div>

      <details *ngIf="a01Raw || a02Raw" class="diagnostic">
        <summary>{{ copy('Inspect raw Airia responses (diagnostic only)', 'عرض استجابات Airia الأصلية (للتشخيص فقط)') }}</summary>
        <div *ngIf="a01Raw"><strong>A01</strong><pre>{{ a01Raw }}</pre></div>
        <div *ngIf="a02Raw"><strong>A02</strong><pre>{{ a02Raw }}</pre></div>
      </details>
    </section>
  `,
  styles: [`
    :host { display:block; margin-top:12px; color:#24435b; font-family:Inter,"Segoe UI",Arial,sans-serif; }
    .live-panel { border:1px solid #b9ded5; border-radius:14px; padding:16px; background:linear-gradient(120deg,#f0faf7,#fff); box-shadow:0 6px 16px rgba(23,50,77,.035); }
    .live-title { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .live-title h3 { margin:4px 0; font-size:14px; font-weight:800; }
    .live-title p { margin:4px 0 0; color:#638080; line-height:1.6; font-size:11px; max-width:760px; }
    .live-eyebrow { color:#0f766e; font-weight:900; font-size:9px; letter-spacing:.8px; }
    .run-btn { flex-shrink:0; background:#0f766e; color:white; border:none; border-radius:10px; padding:12px 16px; font-size:11px; font-weight:800; cursor:pointer; }
    .run-btn:disabled { opacity:.55; cursor:wait; }
    .agent-states { display:flex; align-items:center; flex-wrap:wrap; gap:9px; margin-top:13px; }
    .agent-states span { padding:6px 9px; border-radius:7px; background:#eef2f4; color:#597283; font-size:10px; font-weight:700; }
    .agent-states .success { background:#dff6eb; color:#106c49; }
    .agent-states .failure { background:#fff0f0; color:#c43838; }
    .agent-states .context-note { background:#e7f5f5; color:#0d7878; }
    .status-message { margin:12px 0 0; padding:9px 11px; border-radius:8px; background:#fff7eb; color:#915b14; font-size:11px; line-height:1.6; }
    .signal-issues { display:grid; gap:6px; margin-top:8px; }
    .signal-issue { border:1px solid #f0d6a9; background:#fffaf1; padding:9px 11px; border-radius:8px; font-size:10px; line-height:1.5; }
    .signal-issue strong { display:block; color:#93631a; margin-bottom:3px; }
    .signal-issue span { color:#755e40; overflow-wrap:anywhere; }
    .signal-table-wrap { overflow-x:auto; margin-top:12px; }
    .signal-table { width:100%; border-collapse:collapse; text-align:start; font-size:10px; }
    .signal-table th,.signal-table td { padding:9px 8px; vertical-align:top; border-bottom:1px solid #e2ebe8; }
    .signal-table th { color:#607f7a; background:#eff8f5; font-size:9px; }
    .signal-table td { max-width:280px; word-break:break-word; }
    .live-risk { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-top:10px; background:#e8f7f0; border:1px solid #bee6d5; border-radius:10px; padding:12px; }
    .live-risk small { display:block; font-size:9px; color:#517a69; margin-bottom:3px; }
    .live-risk strong { color:#0d6744; font-size:20px; }
    .live-risk p { max-width:430px; font-size:10px; color:#527767; line-height:1.5; }
    .diagnostic { margin-top:12px; font-size:11px; color:#4d6974; }
    .diagnostic summary { cursor:pointer; font-weight:700; }
    .diagnostic strong { display:block; margin:8px 0 4px; }
    .diagnostic pre { white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; background:#132835; color:#dbf5f1; padding:12px; font-size:10px; border-radius:8px; }
    @media(max-width:720px){ .live-title,.live-risk {flex-direction:column;align-items:stretch;} .run-btn {width:100%;} }
  `]
})
export class NmcLiveAiPanelComponent {
  @Input({ required: true }) vessel!: NmcVesselProfile;
  @Input() isArabic = false;

  running = false;
  a01Status: AgentStatus = 'idle';
  a02Status: AgentStatus = 'idle';
  a01Raw = '';
  a02Raw = '';
  signals: AiSignal[] = [];
  risk: RiskEvaluation | null = null;
  message = '';
  issues: Array<{ agent: string; factor: string; status: string; details: string }> = [];

  constructor(
    private readonly ai: NmcAiIntegrationService,
    private readonly engine: NmcRiskEngineService
  ) {}

  copy(en: string, ar: string): string { return this.isArabic ? ar : en; }

  stateLabel(value: AgentStatus): string {
    const labels = {
      idle: this.copy('Not called', 'لم يُستدعَ'),
      running: this.copy('Running', 'جارٍ التشغيل'),
      ok: this.copy('Responded', 'تم الرد'),
      error: this.copy('Failed', 'فشل')
    };
    return labels[value];
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.risk = null;
    this.signals = [];
    this.a01Raw = '';
    this.a02Raw = '';
    this.message = '';
    this.issues = [];
    this.a01Status = 'running';
    this.a02Status = 'running';

    const correlationId = `NMC-${this.vessel.imo}-${Date.now()}`;
    const knownEvidence = this.evidenceIds();
    const base = {
      requestMeta: { correlationId, language: this.isArabic ? 'ar' : 'en' },
      subject: { type: 'VESSEL', imo: this.vessel.imo },
      bundleRef: `VBL-${this.vessel.imo}`,
      contextMode: 'INLINE',
      officialScoringRequested: false,
      inlineContext: {
        vessel: {
          imo: this.vessel.imo,
          name: this.vessel.name,
          mmsi: this.vessel.mmsi,
          callSign: this.vessel.callSign,
          flag: this.vessel.flag,
          vesselType: this.vessel.type,
          owner: this.vessel.owner,
          operator: this.vessel.operator,
          classSociety: this.vessel.classSociety,
          built: this.vessel.built
        },
        tracking: {
          speed: this.vessel.speed,
          course: this.vessel.course,
          destination: this.vessel.destination,
          eta: this.vessel.eta,
          navStatus: this.vessel.navStatus,
          latitude: this.vessel.lat,
          longitude: this.vessel.lng,
          zone: this.vessel.zone,
          routeKey: this.vessel.routeKey,
          lastUpdateMinutes: this.vessel.lastUpdate
        },
        dataConfidence: this.vessel.dataConfidence / 100,
        riskConfidence: this.vessel.riskConfidence / 100,
        provenance: {
          environment: 'SYNTHETIC_POC',
          source: 'NMC_OPERATIONAL_VESSELS',
          notice: 'Catalog and evidence IDs are synthetic. No live AIS, certificate registry, inspection record or PDF is connected in this request.',
          evidenceIds: knownEvidence
        }
      }
    };

    const a01 = { ...base, requestedSignals: A01_FACTORS };
    const a02 = { ...base, requestedSignals: A02_FACTORS };
    const results = await Promise.allSettled([
      firstValueFrom(this.ai.execute('a01', a01)),
      firstValueFrom(this.ai.execute('a02', a02))
    ]);

    const collected: AiSignal[] = [];
    const diagnostic: string[] = [];
    const agents: Array<{ key: NmcAiriaAgent; expected: RiskFactorKey[] }> = [
      { key: 'a01', expected: A01_FACTORS }, { key: 'a02', expected: A02_FACTORS }
    ];
    results.forEach((outcome, i) => {
      const { key, expected } = agents[i];
      if (outcome.status === 'rejected') {
        if (key === 'a01') this.a01Status = 'error'; else this.a02Status = 'error';
        diagnostic.push(`${key.toUpperCase()}: ${this.safeError(outcome.reason)}`);
        return;
      }
      if (key === 'a01') {
        this.a01Status = 'ok';
        this.a01Raw = this.toDiagnostic(outcome.value.result);
      } else {
        this.a02Status = 'ok';
        this.a02Raw = this.toDiagnostic(outcome.value.result);
      }

      const output = this.unpack(outcome.value.result);
      if (!output || !Array.isArray(output.signals)) {
        diagnostic.push(`${key.toUpperCase()}: No JSON signals[] found in the response; inspect raw output.`);
        return;
      }
      const valid: AiSignal[] = [];
      for (const candidate of output.signals) {
        if (!candidate || typeof candidate !== 'object') continue;
        const s = candidate as Record<string, unknown>;
        if (!expected.includes(s['factor'] as RiskFactorKey)) continue;
        const ids = s['evidenceIds'];
        const evidenceIds = Array.isArray(ids) ? ids : [];
        const unknownIds = evidenceIds.filter(id => typeof id !== 'string' || !knownEvidence.includes(id));
        const reasons: string[] = [];
        const agentStatus = String(s['status'] || '').toUpperCase();
        const unavailable = agentStatus === 'UNKNOWN' || agentStatus === 'INSUFFICIENT_EVIDENCE' ||
          s['severity'] === null || s['severity'] === undefined;
        if (unavailable) reasons.push('UNKNOWN / INSUFFICIENT_EVIDENCE — do not invent a severity');
        if (typeof s['severity'] !== 'number' || !Number.isFinite(s['severity']) ||
            s['severity'] < 0 || s['severity'] > 100) reasons.push('Severity must be a number from 0 to 100');
        if (typeof s['confidence'] !== 'number' || !Number.isFinite(s['confidence']) ||
            s['confidence'] < 0 || s['confidence'] > 1) reasons.push('Confidence must be a number from 0 to 1');
        if (s['sourceAgent'] !== key.toUpperCase()) reasons.push('sourceAgent must equal ' + key.toUpperCase());
        if (!evidenceIds.length) reasons.push('No evidenceIds returned');
        if (unknownIds.length) reasons.push('IDs not present in supplied synthetic manifest: ' + unknownIds.map(String).join(', '));
        if (reasons.length) {
          const detail = typeof s['reason'] === 'string' ? s['reason'].slice(0, 400) : '';
          const missing = Array.isArray(s['missingEvidence']) ? s['missingEvidence'].map(String).join(', ') : '';
          this.issues.push({
            agent: key.toUpperCase(),
            factor: String(s['factor']),
            status: unavailable ? 'INSUFFICIENT EVIDENCE' : 'CONTRACT VALIDATION FAILED',
            details: [reasons.join('; '), detail, missing ? 'Missing: ' + missing : ''].filter(Boolean).join(' | ')
          });
          diagnostic.push(`${key.toUpperCase()}: ${String(s['factor'])} not scored; inspect validation details.`);
          continue;
        }
        valid.push({
          factor: s['factor'] as RiskFactorKey,
          severity: s['severity'],
          confidence: s['confidence'],
          sourceAgent: s['sourceAgent'] as 'A01' | 'A02',
          evidenceIds: ids as string[],
          reason: typeof s['reason'] === 'string' ? s['reason'] : ''
        });
      }
      collected.push(...valid);
    });

    // Only score complete, unambiguous and evidence-grounded factor sets.
    const grouped = new Map<RiskFactorKey, AiSignal[]>();
    collected.forEach(signal => grouped.set(signal.factor, [...(grouped.get(signal.factor) || []), signal]));
    this.signals = FACTORS.flatMap(factor => grouped.get(factor) || []);
    const complete = FACTORS.every(factor => grouped.get(factor)?.length === 1);
    if (complete) {
      const severities = Object.fromEntries(
        FACTORS.map(factor => [factor, grouped.get(factor)![0].severity])
      ) as Record<RiskFactorKey, number>;
      this.risk = this.engine.evaluateFromAiSignals(this.vessel, severities);
      this.message = this.copy(
        'All five signals validated. Calculated risk is provisional and does not replace the existing synthetic assessment until reviewed.',
        'تم التحقق من العوامل الخمسة. حساب المخاطر مبدئي ولا يحل محل التقييم التجريبي المعروض إلا بعد المراجعة.'
      );
    } else {
      diagnostic.push('Incomplete five-factor evidence bundle: no risk recalculation or automatic case action.');
      this.message = diagnostic.join(' | ');
    }
    if (complete && diagnostic.length) this.message += ' ' + diagnostic.join(' | ');
    this.running = false;
  }

  private evidenceIds(): string[] {
    const imo = this.vessel.imo;
    const ins = `INS-2026-${String(1300 + this.vessel.id).padStart(5, '0')}`;
    return [
      `AIS-${this.vessel.mmsi}`, `ROUTE-${imo}`,
      ins, `DEF-${ins}-01`,
      `CERT-SC-${imo}`, `CLASS-${imo}`,
      `DQC-${imo}`, `HIST-${imo}`
    ];
  }

  private safeError(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { status?: number; error?: { error?: string; message?: string; reasonCode?: string } };
      return `HTTP ${e.status ?? 'error'} ${e.error?.error || ''} ${e.error?.reasonCode || ''} ${e.error?.message || ''}`.trim();
    }
    return 'Request failed';
  }

  private toDiagnostic(value: unknown): string {
    try {
      const output = JSON.stringify(value, null, 2) || String(value);
      return output.length > 16000 ? output.slice(0, 16000) + '\n[truncated]' : output;
    } catch {
      return '[Unserializable response]';
    }
  }

  private unpack(input: unknown, depth = 0): { signals?: unknown } | null {
    if (depth > 7 || input === null || input === undefined) return null;
    if (typeof input === 'string') {
      try { return this.unpack(JSON.parse(input.trim()), depth + 1); } catch { return null; }
    }
    if (Array.isArray(input)) {
      for (const item of input) {
        const unpacked = this.unpack(item, depth + 1);
        if (unpacked) return unpacked;
      }
      return null;
    }
    if (typeof input !== 'object') return null;
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj['signals'])) return obj;
    for (const key of ['result', 'response', 'output', 'data', 'finalOutput', 'outputText', 'content', 'text', 'value']) {
      if (key in obj) {
        const unpacked = this.unpack(obj[key], depth + 1);
        if (unpacked) return unpacked;
      }
    }
    return null;
  }
}
