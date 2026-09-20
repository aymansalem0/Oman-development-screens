import { Injectable } from '@angular/core';

export type AppLanguage = 'en' | 'ar';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly storageKey = 'oman-development-language';

  private readonly messages: Record<string, { en: string; ar: string }> = {
    employee: { en: 'AMENAS Employee', ar: 'موظف أمناس' },
    foreignVesselsGroup: { en: 'Foreign Vessels and Navigational Aids Services', ar: 'خدمات السفن الأجنبية والمساعدات الملاحية' },
    navigationAidsApproval: { en: 'Navigation Aids Installation Approval', ar: 'الموافقة على تركيب المساعدات الملاحية' },
    arabic: { en: 'العربية', ar: 'العربية' },
    english: { en: 'English', ar: 'English' },
    requests: { en: 'Requests', ar: 'الطلبات' },
    serviceTitle: { en: 'Request for Approval of Maritime Navigation Aids Installation', ar: 'طلب الموافقة على تركيب وسائل المساعدة الملاحية البحرية' },
    serviceSubtitle: { en: 'Follow up on the number of requests and achievement rates in real-time', ar: 'متابعة عدد الطلبات ونسب الإنجاز بشكل لحظي' },
    totalRequests: { en: 'Total Requests', ar: 'إجمالي الطلبات' },
    underProcessing: { en: 'Under Processing', ar: 'قيد المعالجة' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    send: { en: 'Send', ar: 'إرسال' },
    pending: { en: 'Pending', ar: 'قيد الانتظار' },
    accepted: { en: 'Accepted', ar: 'مقبول' },
    issued: { en: 'Issued', ar: 'تم الإصدار' },
    awaitingInstallationReview: { en: 'Awaiting Installation Company Review', ar: 'بانتظار مراجعة شركة التركيب' },
    searchRequest: { en: 'Search by request number or beneficiary', ar: 'البحث برقم الطلب أو اسم المستفيد' },
    status: { en: 'Status', ar: 'الحالة' },
    datePlaceholder: { en: 'Month/Day/Year', ar: 'شهر/يوم/سنة' },
    requestNumber: { en: 'Request Number', ar: 'رقم الطلب' },
    beneficiaryName: { en: 'Beneficiary Name', ar: 'اسم المستفيد' },
    lastUpdate: { en: 'Last Update', ar: 'آخر تحديث' },
    actions: { en: 'Actions', ar: 'الإجراءات' },
    followUp: { en: 'Follow Up', ar: 'متابعة' },
    applicantData: { en: 'Applicant Data', ar: 'بيانات مقدم الطلب' },
    applicantDataHint: { en: 'Applicant identity and contact information', ar: 'بيانات الهوية والتواصل الخاصة بمقدم الطلب' },
    originalOwnerData: { en: 'Original Owner Data', ar: 'بيانات المالك الأصلي' },
    originalOwnerDataHint: { en: 'Original project owner and authorized contact details', ar: 'بيانات المالك الأصلي للمشروع وبيانات التواصل مع المفوض' },
    applicantName: { en: 'Applicant Name', ar: 'اسم مقدم الطلب' },
    applicantId: { en: 'Civil / Commercial ID', ar: 'الرقم المدني / السجل التجاري' },
    originalOwnerName: { en: 'Original Owner Name', ar: 'اسم المالك الأصلي' },
    authorizedPersonName: { en: 'Authorized Person Name', ar: 'اسم الشخص المفوض' },
    authorizedPersonPhone: { en: 'Authorized Person Phone', ar: 'رقم هاتف الشخص المفوض' },
    email: { en: 'Email', ar: 'البريد الإلكتروني' },
    faxNumber: { en: 'Fax Number', ar: 'رقم الفاكس' },
    requestData: { en: 'Request Data', ar: 'بيانات الطلب' },
    enterSpecifications: { en: 'Enter Specifications', ar: 'إدخال المواصفات' },
    reject: { en: 'Reject', ar: 'رفض' },
    save: { en: 'Save', ar: 'حفظ' },
    cancel: { en: 'Cancel', ar: 'إلغاء' },
    awaitingStatusLong: { en: 'AWAITING INSTALLATION COMPANY REVIEW', ar: 'بانتظار مراجعة شركة التركيب' },

    aidType: { en: 'Aid Type', ar: 'نوع المساعدة' },
    navigationAidType: { en: 'Navigation Aid Type', ar: 'نوع المساعدة الملاحية البحرية' },
    serialNumbers: { en: 'Serial Numbers', ar: 'الأرقام التسلسلية' },
    structureType: { en: 'Structure Type', ar: 'نوع الهيكل' },
    lit: { en: 'Lit', ar: 'مضاء' },
    specificationPurpose: { en: 'Specification Purpose', ar: 'الغرض من المواصفة' },
    structureDetails: { en: 'Structure Details', ar: 'تفاصيل الهيكل' },
    focalHeight: { en: 'Focal Height', ar: 'الارتفاع البؤري' },
    colourOfLight: { en: 'Colour of Light', ar: 'لون الضوء' },
    colourOfStructure: { en: 'Colour of Structure', ar: 'لون الهيكل' },
    signalCharacter: { en: 'Signal Character', ar: 'نوع الوميض' },
    nominalRange: { en: 'Nominal Range', ar: 'مدى النور الملاحي' },
    proposedNationalNumbers: { en: 'Proposed National Numbers', ar: 'الأرقام الوطنية المقترحة' },
    topMark: { en: 'Top Mark', ar: 'العلامة العلوية' },
    visibleSector: { en: 'Visible Sector', ar: 'مدى زاوية الرؤية' },
    proposedManufacturer: { en: 'Proposed Manufacturer', ar: 'الشركة المصنعة المقترحة' },
    notes: { en: 'Notes', ar: 'ملاحظات' },
    technicalLocation: { en: 'Technical Location', ar: 'الموقع الفني' },
    location: { en: 'Location', ar: 'الموقع' },
    purpose: { en: 'Purpose', ar: 'الغرض' },
    installationCompany: { en: 'Installation Responsible Company', ar: 'الشركة المسؤولة عن التركيب' },

    enterTechnicalSpecifications: { en: 'Enter Technical Specifications', ar: 'إدخال المواصفات الفنية' },
    twoSpecificationsRequired: { en: 'Two complete specifications are required', ar: 'مطلوب إدخال مواصفتين كاملتين' },
    technicalSpecification: { en: 'Technical Specification', ar: 'المواصفة الفنية' },
    completeNavigationSpec: { en: 'Complete navigation-aid specification', ar: 'مواصفة كاملة للمساعدة الملاحية' },
    specification: { en: 'Specification', ar: 'المواصفة' },
    selectNavigationAidType: { en: 'Select navigation aid type', ar: 'اختر نوع المساعدة الملاحية' },
    selectPurpose: { en: 'Select purpose', ar: 'اختر الغرض' },
    enterStructureDetails: { en: 'Enter structure details', ar: 'أدخل تفاصيل الهيكل' },
    enterFocalHeight: { en: 'Enter focal height', ar: 'أدخل الارتفاع البؤري' },
    selectColourOfLight: { en: 'Select colour of light', ar: 'اختر لون الضوء' },
    selectColourOfStructure: { en: 'Select colour of structure', ar: 'اختر لون الهيكل' },
    enterOtherColour: { en: 'Enter other colour', ar: 'أدخل اللون الآخر' },
    selectSignalCharacter: { en: 'Select signal character', ar: 'اختر نوع الوميض' },
    enterNominalRange: { en: 'Enter nominal range', ar: 'أدخل المدى' },
    enterNationalNumbers: { en: 'Enter proposed national numbers', ar: 'أدخل الأرقام الوطنية المقترحة' },
    selectTopMark: { en: 'Select top mark', ar: 'اختر العلامة العلوية' },
    enterVisibleSector: { en: 'Enter visible sector', ar: 'أدخل مدى زاوية الرؤية' },
    chooseFile: { en: 'Choose File', ar: 'اختر ملف' },
    fileHint: { en: 'JPG, PNG or PDF · Max 5 MB', ar: 'JPG أو PNG أو PDF · بحد أقصى 5 MB' },
    manufacturerName: { en: 'Manufacturer Name', ar: 'اسم الشركة المصنعة' },
    enterManufacturerName: { en: 'Enter manufacturer name', ar: 'أدخل اسم الشركة المصنعة' },
    latitudeNorth: { en: 'Latitude - North (N)', ar: 'خط العرض - شمال (N)' },
    longitudeEast: { en: 'Longitude - East (E)', ar: 'خط الطول - شرق (E)' },
    example: { en: 'Example', ar: 'مثال' },
    enterNotes: { en: 'Enter notes', ar: 'أدخل الملاحظات' },
    twoSpecificationsIncluded: { en: 'Exactly two complete specifications are included in this request.', ar: 'يتضمن هذا الطلب مواصفتين كاملتين فقط.' },
    yes: { en: 'Yes', ar: 'نعم' },
    no: { en: 'No', ar: 'لا' },

    unsupportedFile: { en: 'Unsupported file type. Allowed types: JPG, PNG, PDF.', ar: 'نوع الملف غير مسموح. الأنواع المسموحة: JPG وPNG وPDF.' },
    maxFileSize: { en: 'Maximum file size is 5 MB.', ar: 'الحد الأقصى لحجم الملف هو 5 MB.' }
  };

  private readonly terms: Record<string, { en: string; ar: string }> = {
    BUOY: { en: 'Buoy', ar: 'عوامة' },
    FIXED: { en: 'Fixed', ar: 'ثابت' },
    FLOATING: { en: 'Floating', ar: 'عائم' },

    PORT_HAND_LATERAL: { en: 'Port-hand Lateral Mark', ar: 'علامة جانبية - جهة الميناء' },
    STARBOARD_HAND_LATERAL: { en: 'Starboard-hand Lateral Mark', ar: 'علامة جانبية - جهة الميمنة' },
    PREFERRED_CHANNEL_PORT: { en: 'Preferred Channel - Port Hand', ar: 'علامة القناة المفضلة - جهة الميناء' },
    PREFERRED_CHANNEL_STARBOARD: { en: 'Preferred Channel - Starboard Hand', ar: 'علامة القناة المفضلة - جهة الميمنة' },
    NORTH_CARDINAL: { en: 'North Cardinal Mark', ar: 'علامة أصلية شمالية' },
    EAST_CARDINAL: { en: 'East Cardinal Mark', ar: 'علامة أصلية شرقية' },
    SOUTH_CARDINAL: { en: 'South Cardinal Mark', ar: 'علامة أصلية جنوبية' },
    WEST_CARDINAL: { en: 'West Cardinal Mark', ar: 'علامة أصلية غربية' },
    ISOLATED_DANGER: { en: 'Isolated Danger Mark', ar: 'علامة خطر معزول' },
    SAFE_WATER: { en: 'Safe Water Mark', ar: 'علامة مياه آمنة' },
    SPECIAL_MARK: { en: 'Special Mark', ar: 'علامة خاصة' },
    EWMB: { en: 'Emergency Wreck Marking Buoy (EWMB)', ar: 'عوامة تعليم حطام طارئ (EWMB)' },
    LIGHTHOUSE: { en: 'Lighthouse', ar: 'منارة بحرية' },
    SECTOR_LIGHT: { en: 'Sector Light', ar: 'ضوء قطاعي' },
    LEADING_LINE: { en: 'Leading Line / Range Mark', ar: 'علامة خط إرشاد / توجيه' },

    WHITE: { en: 'White', ar: 'أبيض' },
    BLACK: { en: 'Black', ar: 'أسود' },
    RED: { en: 'Red', ar: 'أحمر' },
    GREEN: { en: 'Green', ar: 'أخضر' },
    YELLOW: { en: 'Yellow', ar: 'أصفر' },
    BLUE: { en: 'Blue', ar: 'أزرق' },
    ORANGE: { en: 'Orange', ar: 'برتقالي' },
    OTHER: { en: 'Other', ar: 'أخرى' },

    FIXED_LIGHT: { en: 'Fixed (F)', ar: 'ثابت (F)' },
    OCCULTING: { en: 'Occulting (Oc)', ar: 'احتجاب (Oc)' },
    GROUP_OCCULTING: { en: 'Group Occulting (Oc(n))', ar: 'احتجاب جماعي (Oc(n))' },
    ISOPHASE: { en: 'Isophase (Iso)', ar: 'متساوي الطور (Iso)' },
    FLASHING: { en: 'Flashing (Fl)', ar: 'وميض (Fl)' },
    LONG_FLASHING: { en: 'Long Flashing (LFl)', ar: 'وميض طويل (LFl)' },
    GROUP_FLASHING: { en: 'Group Flashing (Fl(n))', ar: 'وميض جماعي (Fl(n))' },
    COMPOSITE_GROUP_FLASHING: { en: 'Composite Group Flashing (Fl(n+m))', ar: 'وميض جماعي مركب (Fl(n+m))' },
    QUICK: { en: 'Quick (Q)', ar: 'وميض سريع (Q)' },
    GROUP_QUICK: { en: 'Group Quick (Q(n))', ar: 'وميض سريع جماعي (Q(n))' },
    INTERRUPTED_QUICK: { en: 'Interrupted Quick (IQ)', ar: 'وميض سريع متقطع (IQ)' },
    VERY_QUICK: { en: 'Very Quick (VQ)', ar: 'وميض سريع جداً (VQ)' },
    GROUP_VERY_QUICK: { en: 'Group Very Quick (VQ(n))', ar: 'وميض سريع جداً جماعي (VQ(n))' },
    INTERRUPTED_VERY_QUICK: { en: 'Interrupted Very Quick (IVQ)', ar: 'وميض سريع جداً متقطع (IVQ)' },
    ULTRA_QUICK: { en: 'Ultra Quick (UQ)', ar: 'وميض فائق السرعة (UQ)' },
    INTERRUPTED_ULTRA_QUICK: { en: 'Interrupted Ultra Quick (IUQ)', ar: 'وميض فائق السرعة متقطع (IUQ)' },
    MORSE: { en: 'Morse Code (Mo)', ar: 'شفرة مورس (Mo)' },
    ALTERNATING: { en: 'Alternating (Al)', ar: 'متناوب (Al)' },

    TOP_NONE: { en: 'None', ar: 'بدون علامة علوية' },
    CONE_UP: { en: 'Cone, point up', ar: 'مخروط، رأسه لأعلى' },
    CONE_DOWN: { en: 'Cone, point down', ar: 'مخروط، رأسه لأسفل' },
    TWO_CONES_UP: { en: 'Two cones, points up', ar: 'مخروطان، رأسا كلاهما لأعلى' },
    TWO_CONES_DOWN: { en: 'Two cones, points down', ar: 'مخروطان، رأسا كلاهما لأسفل' },
    TWO_CONES_BASE_TO_BASE: { en: 'Two cones, base-to-base', ar: 'مخروطان، قاعدة إلى قاعدة' },
    TWO_CONES_POINT_TO_POINT: { en: 'Two cones, point-to-point', ar: 'مخروطان، رأس إلى رأس' },
    CYLINDER_CAN: { en: 'Cylinder / Can', ar: 'أسطوانة / علبة' },
    SPHERE: { en: 'Sphere', ar: 'كرة' },
    TWO_SPHERES: { en: 'Two spheres', ar: 'كرتان' },
    X_SHAPE: { en: "X-shape (St Andrew's Cross)", ar: 'شكل X (صليب سانت أندرو)' },
    EW_CROSS: { en: 'Vertical / Perpendicular Cross (Emergency Wreck)', ar: 'صليب رأسي / متعامد (حطام طارئ)' },

    NEW_INSTALLATION: { en: 'New Installation', ar: 'تركيب جديد' },
    REPLACEMENT: { en: 'Replacement', ar: 'استبدال' },
    RELOCATION: { en: 'Relocation', ar: 'نقل الموقع' },
    MODIFICATION_UPGRADE: { en: 'Modification / Upgrade', ar: 'تعديل / تطوير' },
    TEMPORARY_INSTALLATION: { en: 'Temporary Installation', ar: 'تركيب مؤقت' },
    PERMANENT_INSTALLATION: { en: 'Permanent Installation', ar: 'تركيب دائم' },
    TRIAL_TESTING: { en: 'Trial / Testing', ar: 'تجربة / اختبار' },

    CONCRETE_STRUCTURE: { en: 'Concrete Structure', ar: 'الخرسانة الأسمنتية' },
    MOORING_CHAINS: { en: 'Mooring Chains', ar: 'السلاسل الحديدية' },
    MARINE_BUOY: { en: 'Marine Buoy', ar: 'العوامات البحرية' },
    STEEL_COLUMN: { en: 'Steel Column / Pile', ar: 'الأعمدة الحديدية' },
    NAVIGATION_LIGHT: { en: 'Navigation Light', ar: 'النور الملاحي' },

    DUQM_PORT: { en: 'Port of Duqm', ar: 'ميناء الدقم' },
    TEST: { en: 'Test', ar: 'اختبار' },
    YES: { en: 'Yes', ar: 'نعم' },
    NO: { en: 'No', ar: 'لا' }
  };

  language: AppLanguage = this.loadInitialLanguage();

  get isArabic(): boolean {
    return this.language === 'ar';
  }

  get dir(): 'rtl' | 'ltr' {
    return this.isArabic ? 'rtl' : 'ltr';
  }

  toggle(): void {
    this.setLanguage(this.isArabic ? 'en' : 'ar');
  }

  setLanguage(language: AppLanguage): void {
    this.language = language;
    localStorage.setItem(this.storageKey, language);
    document.documentElement.lang = language;
    document.documentElement.dir = this.dir;
  }

  t(key: string): string {
    return this.messages[key]?.[this.language] ?? key;
  }

  term(code: string | null | undefined): string {
    if (!code) return '--';
    return this.terms[code]?.[this.language] ?? code;
  }

  formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat(this.isArabic ? 'ar-OM' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  private loadInitialLanguage(): AppLanguage {
    const saved = localStorage.getItem(this.storageKey);
    const language: AppLanguage = saved === 'ar' ? 'ar' : 'en';
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    return language;
  }
}
