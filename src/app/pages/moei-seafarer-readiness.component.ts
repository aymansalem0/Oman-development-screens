import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { Subscription, interval, switchMap } from "rxjs";
import { NmcNavigationComponent } from "../components/nmc-navigation.component";
import { NmcPlatformHeaderComponent } from "../components/nmc-platform-chrome.component";
import { LanguageService } from "../services/language.service";
import {
  SeafarerWorkspaceService,
  SdbDashboard,
  SdbProfile,
  SdbApplication,
  SdbRecipient,
  SdbNotification,
} from "../services/seafarer-workspace.service";

type View =
  | "readiness"
  | "services"
  | "company"
  | "notifications"
  | "fulfilment";
@Component({
  selector: "app-moei-seafarer-readiness",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NmcNavigationComponent,
    NmcPlatformHeaderComponent,
  ],
  templateUrl: "./moei-seafarer-readiness.component.html",
  styleUrl: "./moei-seafarer-readiness.component.css",
})
export class MoeiSeafarerReadinessComponent implements OnInit, OnDestroy {
  view: View = "readiness";
  data: SdbDashboard | null = null;
  selectedId = "";
  search = "";
  statusFilter = "ALL";
  loading = true;
  busy = false;
  error = "";
  notice = "";
  previewId = "";
  // One-shot intent from an explicitly chosen READY POC scenario.
  // No payment or issuance is triggered by selecting a scenario.
  autoStartReady = false;
  autoStartAttempted = false;
  canPreview = false;
  demoDirectory: SdbProfile[] = [];
  step = 0;
  app: SdbApplication | null = null;
  format: "ELECTRONIC" | "ELECTRONIC_PRINT" = "ELECTRONIC";
  delivery: "POST" | "PICKUP" = "POST";
  recipient: SdbRecipient = {
    recipient: "",
    email: "",
    phone: "",
    address: "",
  };
  declaration = false;
  paymentResult = "SUCCESS";
  paymentKey = "";
  companyStatus = "HOLD";
  holdReason = "";
  caseReference = "";
  fulfilApp: SdbApplication | null = null;
  trackingNumber = "";
  carrier = "";
  pickupAt = "";
  private subscriptions = new Subscription();
  readonly steps = [
    ["Readiness", "الجاهزية"],
    ["SDB format", "نوع السجل"],
    ["Delivery details", "بيانات الاستلام"],
    ["Invoice", "الفاتورة"],
    ["Payment", "السداد"],
    ["Electronic SDB", "السجل الإلكتروني"],
  ];
  constructor(
    private api: SeafarerWorkspaceService,
    public lang: LanguageService,
    private route: ActivatedRoute,
  ) {}
  ngOnInit() {
    this.view = this.route.snapshot.data["view"] || "readiness";
    this.selectedId = this.route.snapshot.paramMap.get("profileId") || "";
    this.autoStartReady = this.view === "services" &&
      this.route.snapshot.queryParamMap.get("startReady") === "1" &&
      !!this.selectedId;
    this.load();
    this.subscriptions.add(
      interval(30000).subscribe(() => {
        if (!this.busy) this.load(false);
      }),
    );
  }
  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }
  t(en: string, ar: string) {
    return this.lang.pick(en, ar);
  }
  get title() {
    return this.view === "services"
      ? this.t("Seafarer Services", "خدمات البحارة")
      : this.view === "company"
        ? this.t("Company No Objection", "عدم ممانعة الشركات")
        : this.view === "notifications"
          ? this.t("Notifications & Updates", "الإشعارات والتحديثات")
          : this.view === "fulfilment"
            ? this.t("Printing & Delivery", "الطباعة والتسليم")
            : this.t("Pre Application Readiness", "جاهزية ما قبل تقديم الطلب");
  }
  get scope() {
    return this.previewId
      ? "?preview=" +
          encodeURIComponent(this.previewId) +
          (this.view === "company" ? "&as=COMPANY" : "")
      : "";
  }
  get selected() {
    return this.data?.profiles.find((p) => p.id === this.selectedId) || null;
  }
  get rows() {
    const q = this.search.trim().toLowerCase();
    return (this.data?.profiles || []).filter(
      (p) =>
        (this.statusFilter === "ALL" ||
          p.readiness.status === this.statusFilter) &&
        (!q ||
          [p.name, p.id, p.nationalId, p.existingSdb?.sid || ""].some((s) =>
            s.toLowerCase().includes(q),
          )),
    );
  }
  get notices() {
    return this.data?.notifications || [];
  }
  get unread() {
    return this.notices.filter((n) => !n.read).length;
  }
  get profileNotices() {
    return this.notices
      .filter((n) => n.profileId === this.selectedId)
      .slice(0, 6);
  }
  get printApplications() {
    return (this.data?.profiles || []).flatMap((p) =>
      p.applications
        .filter((a) => a.format === "ELECTRONIC_PRINT" && a.status === "ISSUED")
        .map((a) => ({ profile: p, app: a })),
    );
  }
  label(s: string) {
    const labels: Record<string, [string, string]> = {
      READY: ["Ready to apply", "جاهز للتقديم"],
      INCOMPLETE: ["Requirements missing", "متطلبات ناقصة"],
      ON_HOLD: ["On hold", "موقوف مؤقتًا"],
      PENDING_VERIFICATION: ["Pending verification", "بانتظار التحقق"],
      PASS: ["Verified", "مستوفى"],
      FAIL: ["Action required", "إجراء مطلوب"],
      PENDING: ["Pending", "قيد التحقق"],
      HOLD: ["Hold", "إيقاف"],
      NO_OBJECTION: ["No objection", "لا مانع"],
      FIRST_ISSUE: ["First issuance", "إصدار أول"],
      RENEWAL: ["Renewal", "تجديد"],
      VALID: ["Valid", "سارية"],
      FIT: ["Medically fit", "لائق طبيًا"],
      UNFIT: ["Not medically fit", "غير لائق طبيًا"],
      REVOKED: ["Revoked", "ملغاة"],
      DRAFT: ["Draft", "مسودة"],
      AWAITING_PAYMENT: ["Awaiting payment", "بانتظار السداد"],
      ISSUED: ["Issued · sandbox", "صدر · تجريبي"],
      PRINT_QUEUED: ["Print queued", "بانتظار الطباعة"],
      PRINTED: ["Printed", "تمت الطباعة"],
      DISPATCHED: ["Dispatched", "تم الشحن"],
      DELIVERED: ["Delivered", "تم التسليم"],
      READY_FOR_PICKUP: ["Ready for collection", "جاهز للاستلام"],
      COLLECTED: ["Collected", "تم الاستلام"],
      NOT_REQUIRED: ["Electronic only", "إلكتروني فقط"],
      ELECTRONIC: ["Electronic SDB", "سجل إلكتروني"],
      ELECTRONIC_PRINT: [
        "Electronic + printed booklet",
        "إلكتروني + نسخة مطبوعة",
      ],
      POST: ["Postal delivery", "إرسال بالبريد"],
      PICKUP: ["Service centre collection", "استلام من المقر"],
      NONE: ["No physical delivery", "لا يوجد تسليم ورقي"],
    };
    const v = labels[s];
    return v ? this.t(v[0], v[1]) : s;
  }
  certificateState(status: string, expiry: string, evaluated: string) {
    return status === "VALID" && expiry >= evaluated.slice(0, 10)
      ? "PASS"
      : "FAIL";
  }
  certificateLabel(status: string, expiry: string, evaluated: string) {
    return status === "VALID" && expiry < evaluated.slice(0, 10)
      ? this.t("Expired", "منتهية")
      : this.label(status);
  }
  sourceName(s: string) {
    return (
      (
        {
          ACADEMY: this.t("Maritime Academy", "الأكاديمية البحرية"),
          MARASI: this.t("MARASI · Medical", "مراسي · الكشف الطبي"),
          MOI_ICP: this.t(
            "MOI / ICP · Identity",
            "الداخلية / الهوية · الجواز والصورة",
          ),
          COMPANY: this.t("Employer company", "الشركة المشغلة"),
          REGISTRY: this.t("Certificate registry", "سجل الشهادات"),
        } as Record<string, string>
      )[s] || s
    );
  }
  companyName(id: string | null) {
    return (
      this.data?.companies.find((c) => c.id === id)?.name ||
      this.t("Academy cadet", "متدرب بالأكاديمية")
    );
  }
  initials(name: string) {
    return name
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("");
  }
  load(showLoading = true) {
    if (showLoading) {
      this.loading = true;
      this.error = "";
    }
    this.subscriptions.add(
      this.api.dashboard(this.scope).subscribe({
        next: (d) => {
          if (!this.previewId && d.actor.operations) {
            this.canPreview = true;
            this.demoDirectory = d.profiles;
            if (this.view === "services" || this.view === "company") {
              this.previewId =
                this.selectedId ||
                (this.view === "company" ? "SF-003" : "SF-002");
              this.selectedId = this.previewId;
              this.load(showLoading);
              return;
            }
          }
          this.data = d;
          this.loading = false;
          if (!d.profiles.some((p) => p.id === this.selectedId))
            this.selectedId = d.profiles[0]?.id || "";
          const p = this.selected;
          if (p && this.app) {
            const a = p.applications.find((a) => a.id === this.app?.id);
            if (a) this.app = a;
          }
          if (this.view === "services" && !this.app && p) {
            const a = p.applications[p.applications.length - 1];
            if (a) this.restore(a);
          }
          // A READY scenario selected by an operator goes straight into the
          // existing SDB draft wizard, not a second readiness dead-end.
          // Re-check genuine profile readiness; non-READY profiles cannot
          // bypass source/medical/academy/company holds.
          if (this.autoStartReady && !this.autoStartAttempted && p) {
            this.autoStartAttempted = true;
            if (p.readiness.status === "READY" && !this.app) {
              this.begin(); // backend also revalidates source readiness
            } else if (p.readiness.status !== "READY") {
              this.error = this.t(
                "Source readiness changed. Resolve the requirements before applying.",
                "تغيرت جاهزية البحار لدى المصدر. يجب استكمال المتطلبات قبل التقديم."
              );
            }
          }
        },
        error: (e) => {
          this.loading = false;
          this.setError(e);
        },
      }),
    );
  }
  select(p: SdbProfile) {
    this.selectedId = p.id;
    this.app = null;
    this.step = 0;
    this.notice = "";
    this.holdReason = "";
    this.caseReference = "";
    if (this.view === "services" && p.applications.length)
      this.restore(p.applications[p.applications.length - 1]);
  }
  changePreview() {
    this.selectedId = this.previewId;
    this.app = null;
    this.step = 0;
    this.data = null;
    this.load();
  }
  restore(a: SdbApplication) {
    this.app = a;
    this.format = a.format;
    this.delivery = a.delivery === "PICKUP" ? "PICKUP" : "POST";
    this.recipient = { ...a.recipient };
    this.declaration = a.declaration;
    this.step =
      a.status === "ISSUED" ? 5 : a.status === "AWAITING_PAYMENT" ? 3 : 1;
  }
  begin() {
    const p = this.selected;
    if (!p || this.busy || p.readiness.status !== "READY") return;
    this.busy = true;
    this.error = "";
    this.subscriptions.add(
      this.api.start(p.id, this.scope).subscribe({
        next: (a) => {
          this.busy = false;
          this.restore(a);
        },
        error: (e) => this.actionError(e),
      }),
    );
  }
  nextFormat() {
    this.step = 2;
    if (this.app) this.recipient = { ...this.app.recipient };
  }
  confirmOptions() {
    if (!this.app || this.busy) return;
    this.busy = true;
    this.error = "";
    const a = this.app;
    this.subscriptions.add(
      this.api
        .options(
          a,
          {
            version: a.version,
            format: this.format,
            delivery: this.format === "ELECTRONIC" ? "NONE" : this.delivery,
            recipient: this.recipient,
            declaration: this.declaration,
          },
          this.scope,
        )
        .pipe(switchMap((saved) => this.api.invoice(saved, this.scope)))
        .subscribe({
          next: (saved) => {
            this.app = saved;
            this.busy = false;
            this.step = 3;
            this.load(false);
          },
          error: (e) => this.actionError(e),
        }),
    );
  }
  pay() {
    if (!this.app || this.busy || this.selected?.readiness.status !== "READY")
      return;
    this.busy = true;
    this.error = "";
    if (!this.paymentKey) this.paymentKey = crypto.randomUUID();
    this.subscriptions.add(
      this.api
        .pay(this.app, this.paymentResult, this.paymentKey, this.scope)
        .subscribe({
          next: (a) => {
            this.app = a;
            this.busy = false;
            if (a.status === "ISSUED") {
              this.step = 5;
              this.notice = this.t(
                "Electronic SDB is available. Delivery updates will appear in your notifications.",
                "السجل الإلكتروني متاح. ستصلك تحديثات الاستلام في الإشعارات.",
              );
            } else {
              this.notice = this.t(
                "Payment was not completed. You can retry the same invoice.",
                "لم يكتمل السداد. يمكنك إعادة المحاولة لنفس الفاتورة.",
              );
              this.paymentKey = "";
            }
            this.load(false);
          },
          error: (e) => this.actionError(e),
        }),
    );
  }
  simulate(action: string) {
    const p = this.selected;
    if (!p || this.busy) return;
    this.busy = true;
    this.subscriptions.add(
      this.api.simulate(p.id, action).subscribe({
        next: () => {
          this.busy = false;
          this.notice = this.t(
            "Source event processed. Readiness and notifications updated.",
            "تمت معالجة حدث المصدر وتحديث الجاهزية والإشعارات.",
          );
          this.load(false);
        },
        error: (e) => this.actionError(e),
      }),
    );
  }
  decision() {
    const p = this.selected;
    if (!p || this.busy) return;
    this.busy = true;
    this.error = "";
    this.subscriptions.add(
      this.api
        .decision(
          p.id,
          {
            status: this.companyStatus,
            reason: this.companyStatus === "HOLD" ? this.holdReason : "",
            reference: this.caseReference,
          },
          this.scope,
        )
        .subscribe({
          next: () => {
            this.busy = false;
            this.notice = this.t(
              "Company decision saved. Seafarer notification created.",
              "تم حفظ قرار الشركة وإشعار البحار.",
            );
            this.load(false);
          },
          error: (e) => this.actionError(e),
        }),
    );
  }
  read(n: SdbNotification) {
    this.subscriptions.add(
      this.api.readNotice(n.id, this.scope).subscribe({
        next: () => {
          n.read = true;
        },
        error: (e) => this.setError(e),
      }),
    );
  }
  nextFulfil(a: SdbApplication) {
    return (
      (
        {
          PRINT_QUEUED: "PRINTED",
          PRINTED: a.delivery === "POST" ? "DISPATCHED" : "READY_FOR_PICKUP",
          DISPATCHED: "DELIVERED",
          READY_FOR_PICKUP: "COLLECTED",
        } as Record<string, string>
      )[a.fulfilment?.status || ""] || ""
    );
  }
  fulfil() {
    const a = this.fulfilApp;
    if (!a || this.busy) return;
    this.busy = true;
    const pickupAt = this.pickupAt ? new Date(this.pickupAt).toISOString() : "";
    this.subscriptions.add(
      this.api
        .fulfil(a.id, {
          status: this.nextFulfil(a),
          trackingNumber: this.trackingNumber,
          carrier: this.carrier,
          pickupAt,
        })
        .subscribe({
          next: (s) => {
            this.fulfilApp = s;
            this.busy = false;
            this.notice = this.t(
              "Fulfilment updated and seafarer notified.",
              "تم تحديث التسليم وإشعار البحار.",
            );
            this.load(false);
          },
          error: (e) => this.actionError(e),
        }),
    );
  }
  download() {
    if (!this.app?.digital) return;
    const content = {
      sandbox: true,
      officialDocument: false,
      application: this.app.id,
      ...this.app.digital,
    };
    const blob = new Blob([JSON.stringify(content, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.app.digital.number + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  actionError(e: unknown) {
    this.busy = false;
    this.setError(e);
    this.load(false);
  }
  setError(e: unknown) {
    const code =
      (e as { error?: { error?: string } })?.error?.error ||
      "SDB_SERVICE_UNAVAILABLE";
    const messages: Record<string, [string, string]> = {
      SDB_READINESS_CHANGED: [
        "Your readiness has changed. Resolve the requirements and try again.",
        "تغيّرت حالة الجاهزية. استكمل المتطلبات ثم حاول مجددًا.",
      ],
      SDB_APPLICANT_BINDING_REQUIRED: [
        "Your SSO account needs an authorised seafarer or company association.",
        "يحتاج حساب الدخول إلى ربط معتمد بالبحار أو الشركة.",
      ],
      SDB_VERSION_CONFLICT: [
        "The request changed in another session. Refresh before continuing.",
        "تم تعديل الطلب في جلسة أخرى. حدّث البيانات قبل المتابعة.",
      ],
      SDB_INVALID_FIELD: [
        "Complete all required fields.",
        "استكمل جميع الحقول المطلوبة.",
      ],
      SDB_DECLARATION_REQUIRED: [
        "Confirm your declaration to continue.",
        "يجب تأكيد الإقرار للمتابعة.",
      ],
      SDB_PICKUP_APPOINTMENT_REQUIRED: [
        "Enter a future collection appointment.",
        "أدخل موعد استلام في المستقبل.",
      ],
    };
    const m = messages[code];
    this.error = m
      ? this.t(m[0], m[1])
      : this.t("The request could not be completed.", "تعذّر إتمام الطلب.") +
        " (" +
        code +
        ")";
  }
}
