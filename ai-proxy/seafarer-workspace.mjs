/** Isolated SDB contract sandbox. Never writes NMC, SI or an official registry. */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { atomicJsonWrite } from "./atomic-json-store.mjs";
import {initialSdbSettings,validateSdbRequirement,computedSdbReadiness,
 stageSdbDocument,decideSdbDocument} from './seafarer-readiness-settings.mjs';

export class SdbError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new SdbError(code, status);
};
const copy = (x) => structuredClone(x);
const day = 86400000;
const iso = (t) => new Date(t).toISOString();
const date = (t) => iso(t).slice(0, 10);
const atEnd = (x) => Date.parse(x + "T23:59:59.999Z");
const validDate = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(atEnd(x)) &&
  date(Date.parse(x + "T00:00:00Z")) === x;
const text = (x, max = 240) =>
  typeof x === "string" && x.trim().length > 0 && x.trim().length <= max
    ? x.trim()
    : fail("SDB_INVALID_FIELD");
const sources = ["ACADEMY", "MARASI", "MOI_ICP"];
export const COP_TYPES = ["PST", "FPFF", "EFA", "PSSR"];
export const COP_LABELS = {
  PST: "Personal Survival Techniques",
  FPFF: "Fire Prevention and Fire Fighting",
  EFA: "Elementary First Aid",
  PSSR: "Personal Safety and Social Responsibilities",
};
export const SDB_POLICY = {
  version: "SDB-SANDBOX-2026.1",
  requiredCops: COP_TYPES,
  sourceMaxAgeHours: 72,
  reminderDays: 30,
  bookletYears: 5,
};
export const DEMO_FEES = {
  version: "ILLUSTRATIVE-NOT-OFFICIAL-v1",
  currency: "AED",
  issue: 100,
  renewal: 80,
  print: 50,
  post: 25,
};
const fp = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

export function emptyCandidate(id, nationalId, name, academyId, now) {
  return {
    id,
    nationalId,
    name,
    rank: "Cadet",
    nationality: "Pending identity source",
    academyId,
    companyId: null,
    academyRequired: true,
    existingSdb: null,
    cocRequired: false,
    coc: null,
    endorsementRequired: false,
    endorsement: null,
    certificates: [],
    medical: null,
    passport: null,
    photoReference: null,
    contact: { email: "", phone: "", address: "", recipient: name },
    clearances: {
      ACADEMY: {
        status: "PENDING",
        reason: "Awaiting academy no objection",
        reference: null,
        updatedAt: iso(now),
      },
    },
    sourceSync: {},
    sourceVersions: {},
    version: 1,
    createdAt: iso(now),
    lastUpdated: iso(now),
    readinessFingerprint: null,
  };
}
export function demoState(now = Date.now()) {
  const rows = [];
  const names = [
    "Yousef Al Mansoori",
    "Amal Al Nuaimi",
    "Mariam Al Shamsi",
    "Marco Santos",
    "Faisal Al Hamadi",
    "Sara Al Zaabi",
    "Khalid Rahman",
  ];
  for (let n = 1; n <= 7; n++) {
    const id = "SF-" + String(n).padStart(3, "0");
    const p = emptyCandidate(
      id,
      "DEMO-NATIONAL-" + n,
      names[n - 1],
      "ACADEMY-GULF",
      now,
    );
    p.contact = {
      email: "seafarer" + n + "@example.test",
      phone: "+97150000000" + n,
      address: "Demo building " + n + ", Abu Dhabi, UAE",
      recipient: p.name,
    };
    p.passport = {
      number: "DEMO-P" + (10000 + n),
      issueDate: date(now - 365 * day),
      expiryDate: date(now + 720 * day),
      status: "VALID",
      reference: "MOI-DEMO-" + n,
    };
    p.photoReference = "MOI-DEMO-PHOTO-" + n;
    p.medical = {
      reference: "MARASI-DEMO-" + n,
      status: "FIT",
      issuedAt: date(now - 30 * day),
      expiryDate: date(now + 300 * day),
      validFor: ["FIRST_ISSUE", "RENEWAL"],
    };
    p.certificates = COP_TYPES.map((type, i) => ({
      id: id + "-COP-" + type,
      type,
      title: COP_LABELS[type],
      status: "VALID",
      issueDate: date(now - 90 * day),
      expiryDate: date(now + 550 * day),
      reference: "ACADEMY-DEMO-" + n + "-" + i,
    }));
    p.clearances.ACADEMY = {
      status: "NO_OBJECTION",
      reason: "",
      reference: "AC-NOC-DEMO-" + n,
      updatedAt: iso(now),
    };
    p.sourceSync = Object.fromEntries(
      sources.map((s) => [
        s,
        {
          status: "AVAILABLE",
          checkedAt: iso(now),
          reference: s + "-DEMO-" + n,
        },
      ]),
    );
    if (n === 1) p.certificates = p.certificates.slice(0, 1);
    if (n >= 3) {
      p.companyId = n === 4 ? "COMPANY-HARBOUR" : "COMPANY-NATIONAL";
      p.academyRequired = false;
      p.rank = "Deck Officer";
      p.existingSdb = {
        sid: "SID-DEMO-" + (2000 + n),
        number: "SDB-DEMO-OLD-" + n,
        expiryDate: date(now + 45 * day),
      };
      p.cocRequired = true;
      p.coc = {
        status: "VALID",
        reference: "COC-DEMO-" + n,
        expiryDate: date(now + 400 * day),
      };
      p.clearances.COMPANY = {
        status: "NO_OBJECTION",
        reason: "",
        reference: "EMP-NOC-DEMO-" + n,
        updatedAt: iso(now),
      };
    }
    if (n === 4)
      p.clearances.COMPANY = {
        status: "HOLD",
        reason: "Employer objection pending contract close-out.",
        reference: "CASE-DEMO-204",
        updatedAt: iso(now),
      };
    if (n === 5) p.medical.expiryDate = date(now - day);
    if (n === 6) p.passport.expiryDate = date(now - day);
    if (n === 7)
      p.sourceSync.MARASI = {
        status: "UNAVAILABLE",
        checkedAt: iso(now),
        reference: "MARASI-RETRY-DEMO",
      };
    rows.push(p);
  }
  return {
    schemaVersion: 1,
    profiles: rows,
    applications: [],
    notifications: [],
    audit: [],
    events: {},
    sequence: 0,
  };
}

export function evaluateReadiness(p, now = Date.now(), policy = SDB_POLICY) {
  const service = p.existingSdb ? "RENEWAL" : "FIRST_ISSUE",
    checks = [];
  const add = (
    key,
    label,
    source,
    result,
    reason,
    expiryDate = null,
    reference = null,
  ) =>
    checks.push({ key, label, source, result, reason, expiryDate, reference });
  const fresh = (source) => {
    const s = p.sourceSync[source];
    return (
      s?.status === "AVAILABLE" &&
      Number.isFinite(Date.parse(s.checkedAt)) &&
      Date.parse(s.checkedAt) <= now + 60000 &&
      now - Date.parse(s.checkedAt) <= policy.sourceMaxAgeHours * 3600000
    );
  };
  for (const source of sources)
    add(
      "SOURCE-" + source,
      source + " verification",
      source,
      fresh(source) ? "PASS" : "PENDING",
      fresh(source)
        ? "Source verified"
        : "Source unavailable, stale or not verified",
      null,
      p.sourceSync[source]?.reference,
    );
  for (const type of policy.requiredCops) {
    const c = p.certificates.find((c) => c.type === type);
    const pass =
      c &&
      c.status === "VALID" &&
      validDate(c.issueDate) &&
      validDate(c.expiryDate) &&
      Date.parse(c.issueDate + "T00:00:00Z") <= now &&
      atEnd(c.expiryDate) > now;
    add(
      "COP-" + type,
      COP_LABELS[type] || type,
      "ACADEMY",
      pass ? "PASS" : "FAIL",
      !c
        ? "Certificate missing"
        : c.status !== "VALID"
          ? c.status
          : !pass
            ? "Certificate expired or dates invalid"
            : "Valid CoP",
      c?.expiryDate,
      c?.reference,
    );
  }
  const m = p.medical;
  const fit =
    m?.status === "FIT" &&
    m.validFor?.includes(service) &&
    validDate(m.issuedAt) &&
    Date.parse(m.issuedAt + "T00:00:00Z") <= now &&
    validDate(m.expiryDate) &&
    atEnd(m.expiryDate) > now;
  add(
    "MEDICAL",
    "Medical fitness",
    "MARASI",
    fit ? "PASS" : "FAIL",
    fit
      ? "Fit for " + service
      : !m
        ? "Medical examination required"
        : m.status !== "FIT"
          ? "Medical fitness not confirmed"
          : !m.validFor?.includes(service)
            ? "Medical does not cover this service"
            : "Medical expired or dates invalid",
    m?.expiryDate,
    m?.reference,
  );
  const psp = p.passport;
  const passportOk =
    psp?.status === "VALID" &&
    validDate(psp.issueDate) &&
    Date.parse(psp.issueDate + "T00:00:00Z") <= now &&
    validDate(psp.expiryDate) &&
    atEnd(psp.expiryDate) > now;
  add(
    "PASSPORT",
    "Passport",
    "MOI_ICP",
    passportOk ? "PASS" : "FAIL",
    passportOk
      ? "Verified valid passport"
      : "Passport missing, expired or not verified",
    psp?.expiryDate,
    psp?.reference,
  );
  add(
    "PHOTO",
    "Personal photograph",
    "MOI_ICP",
    p.photoReference ? "PASS" : "FAIL",
    p.photoReference
      ? "Photograph reference verified"
      : "Source photograph required",
    null,
    p.photoReference,
  );
  const authorities = [];
  if (p.academyRequired || service === "FIRST_ISSUE")
    authorities.push("ACADEMY");
  if (service === "RENEWAL" && p.companyId) authorities.push("COMPANY");
  if (!authorities.length) authorities.push("ACADEMY");
  for (const a of authorities) {
    const c = p.clearances[a],
      current =
        c &&
        Number.isFinite(Date.parse(c.updatedAt)) &&
        now - Date.parse(c.updatedAt) <= policy.sourceMaxAgeHours * 3600000;
    add(
      "CLEARANCE-" + a,
      a === "ACADEMY" ? "Academy no objection" : "Employer no objection",
      a,
      c?.status === "HOLD"
        ? "HOLD"
        : c?.status === "NO_OBJECTION" && current
          ? "PASS"
          : "PENDING",
      c?.status === "HOLD"
        ? c.reason
        : !current
          ? "Clearance missing or requires source refresh"
          : c?.status === "NO_OBJECTION"
            ? "Explicit no objection received"
            : "Waiting for source decision",
      null,
      c?.reference,
    );
  }
  for (const [field, required, label] of [
    ["coc", p.cocRequired, "Certificate of Competency"],
    ["endorsement", p.endorsementRequired, "Foreign endorsement"],
  ]) {
    if (required) {
      const c = p[field],
        pass =
          c?.status === "VALID" &&
          validDate(c.expiryDate) &&
          atEnd(c.expiryDate) > now;
      add(
        field.toUpperCase(),
        label,
        "REGISTRY",
        pass ? "PASS" : "FAIL",
        pass ? "Valid verified record" : "Valid record required",
        c?.expiryDate,
        c?.reference,
      );
    }
  }
  const blockers = checks.filter((c) => c.result !== "PASS");
  const status = checks.some((c) => c.result === "HOLD")
    ? "ON_HOLD"
    : checks.some((c) => c.result === "PENDING")
      ? "PENDING_VERIFICATION"
      : blockers.length
        ? "INCOMPLETE"
        : "READY";
  const expiring = checks.filter(
    (c) =>
      c.expiryDate &&
      atEnd(c.expiryDate) > now &&
      atEnd(c.expiryDate) - now <= policy.reminderDays * day,
  );
  return {
    service,
    status,
    checks,
    blockers,
    expiring,
    passed: checks.length - blockers.length,
    total: checks.length,
    percent: Math.round(
      ((checks.length - blockers.length) / checks.length) * 100,
    ),
    evaluatedAt: iso(now),
    policyVersion: policy.version,
  };
}

export class SeafarerWorkspace {
  constructor({
    file = process.env.SDB_STORE_PATH || "/data/sdb-readiness-sandbox.json",
    clock = () => Date.now(),
    seed = true,
    bindings = {},
    fees = DEMO_FEES,
    policy = SDB_POLICY,
  } = {}) {
    this.file = file;
    this.clock = clock;
    this.bindings = bindings;
    this.fees = copy(fees);
    this.policy = copy(policy);
    for (const k of ["issue", "renewal", "print", "post"])
      if (!Number.isInteger(fees[k]) || fees[k] < 0 || fees[k] > 100000)
        fail("SDB_FEE_CONFIGURATION_INVALID", 503);
    if (file && existsSync(file)) {
      try {
        this.state = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        fail("SDB_STORE_UNREADABLE", 503);
      }
      if (
        this.state.schemaVersion !== 1 ||
        !Array.isArray(this.state.profiles) ||
        !Array.isArray(this.state.applications) ||
        !Array.isArray(this.state.notifications) ||
        !Array.isArray(this.state.audit) ||
        typeof this.state.events !== "object"
      )
        fail("SDB_STORE_SCHEMA_INVALID", 503);
    } else {
      this.state = seed
        ? demoState(clock())
        : {
            schemaVersion: 1,
            profiles: [],
            applications: [],
            notifications: [],
            audit: [],
            events: {},
            sequence: 0,
          };
    }
    // Existing schemaVersion=1 records remain backward compatible.
    // Settings and review evidence are additive fields, never a reset.
    this.state.readinessSettings ||= initialSdbSettings(this.policy);
    for(const p of this.state.profiles)p.documents ||= [];
    this.monitor();
  }
  transaction(fn) {
    const previous = copy(this.state);
    try {
      const result = fn();
      if (this.file) atomicJsonWrite(this.file, this.state);
      return copy(result);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  /** Configurable POC overlays can only add blockers, never remove baseline checks. */
  evaluate(profile){
    return computedSdbReadiness(profile,this.clock(),this.policy,
      this.state.readinessSettings);
  }
  readinessConfiguration(actor){
    this.assertOperations(actor);
    return {...copy(this.state.readinessSettings),
      engine:{type:'CONFIG_DRIVEN_AGENTIC_AI_READINESS_POC',
       mode:'EXPLAINABLE_RULE_ENGINE',modelInvoked:false,
       documentAiProvider:'NOT_CONNECTED',attachmentBytesStored:false,
       baselineEnforced:true}};
  }
  saveRequirement(actor,input){
    this.assertOperations(actor);
    const current=this.state.readinessSettings;
    const req=validateSdbRequirement(input,current.requirements);
    return this.transaction(()=>{
      const settings=this.state.readinessSettings;
      const index=settings.requirements.findIndex(r=>r.id===req.id);
      if(index<0){
        if(settings.requirements.length>=60)fail('SDB_SETTING_LIMIT_REACHED',409);
        settings.requirements.push(req);
      }else{
        const existing=settings.requirements[index];
        if(existing.core){
          // Settings never suppress, remap or weaken a legal/source check.
          if(req.source!==existing.source||req.scope!==existing.scope)
            fail('SDB_CORE_SOURCE_IMMUTABLE',409);
        }
        settings.requirements[index]=req;
      }
      settings.version++;
      settings.updatedAt=iso(this.clock());
      settings.updatedBy=actor.key;
      this.audit(null,'READINESS_SETTINGS_UPDATED',actor.key,
        req.id+'; config version '+settings.version);
      for(const p of this.state.profiles)this.refreshProfile(p);
      return this.readinessConfiguration(actor);
    });
  }
  submitEvidence(actor,id,requirementId,metadata){
    const p=this.profile(id);
    // Unlike general customer workflow actions, personal evidence uploads
    // cannot be submitted by an employer bound to the same company.
    if(actor?.seafarerId!==p.id)
      fail('SDB_APPLICANT_BINDING_REQUIRED',403);
    const req=this.state.readinessSettings.requirements.find(r=>r.id===requirementId);
    if(!req)fail('SDB_SETTING_NOT_FOUND',404);
    return this.transaction(()=>{
      const item=stageSdbDocument(p,req,metadata,this.clock());
      p.documents ||= [];
      p.documents.push(item);
      p.version++;
      p.lastUpdated=iso(this.clock());
      this.audit(p.id,'DOCUMENT_AI_TRIAGE_QUEUED',actor.key,
        req.id+'; reference '+item.reference+'; no model invoked');
      this.notify(p,'DOCUMENT_REVIEW','Evidence awaiting review',
        'Evidence metadata was received. Automated AI triage is queued but not connected; human verification is required.',
        'doc-review:'+item.id);
      this.refreshProfile(p);
      return {document:copy(item),readiness:this.evaluate(p)};
    });
  }
  documentReviewQueue(actor){
    this.assertOperations(actor);
    const docs=this.state.profiles.flatMap(p=>(p.documents||[]).map(d=>({
      ...copy(d),seafarerName:p.name,service:p.existingSdb?'RENEWAL':'FIRST_ISSUE'
    })));
    return {mode:'CONTRACT_SANDBOX',aiProvider:'NOT_CONNECTED',
      aiModelInvoked:false,
      queued:docs.filter(d=>d.reviewStatus==='AI_TRIAGE_QUEUED'),
      reviewed:docs.filter(d=>d.reviewStatus!=='AI_TRIAGE_QUEUED').slice(-100)};
  }
  reviewEvidence(actor,documentId,decision,reason){
    this.assertOperations(actor);
    const p=this.state.profiles.find(p=>(p.documents||[]).some(d=>d.id===documentId));
    if(!p)fail('SDB_DOCUMENT_NOT_FOUND',404);
    return this.transaction(()=>{
      const index=p.documents.findIndex(d=>d.id===documentId);
      const reviewed=decideSdbDocument(actor.key,p.documents[index],
        decision,reason,this.clock());
      p.documents[index]=reviewed;
      p.version++;
      p.lastUpdated=iso(this.clock());
      this.audit(p.id,'DOCUMENT_HUMAN_'+decision,actor.key,
        reviewed.requirementId+'; reference '+reviewed.reference);
      this.notify(p,'DOCUMENT_REVIEW','Evidence review completed',
        reviewed.requirementId+': '+decision,
        'doc-reviewed:'+reviewed.id+':'+decision);
      this.refreshProfile(p);
      return {document:copy(reviewed),readiness:this.evaluate(p)};
    });
  }

  actor(identity) {
    if (!identity) fail("SDB_LOGIN_REQUIRED", 401);
    const binding =
      this.bindings[identity.sub] ||
      this.bindings[identity.email?.toLowerCase()] ||
      {};
    return {
      key: identity.email || identity.username,
      operations: identity.role === "ADMIN" || binding.operations === true,
      seafarerId: binding.seafarerId || null,
      companyId: binding.companyId || null,
    };
  }
  assertOperations(actor) {
    if (!actor?.operations) fail("SDB_OPERATIONS_REQUIRED", 403);
  }
  profile(id) {
    return (
      this.state.profiles.find((p) => p.id === id) ||
      fail("SDB_PROFILE_NOT_FOUND", 404)
    );
  }
  assertDemoOwnership(actor, p) {
    if (!p.demoJourney) return;
    const owner = p.demoJourney.operatorKey;
    const operator = actor?.operations === true && actor.key === owner;
    const preview = actor?.seafarerId === p.id &&
      actor.key === owner + " [SANDBOX PREVIEW]";
    if (!operator && !preview)
      fail("SDB_DEMO_JOURNEY_NOT_OWNED", 403);
  }
  scope(actor, p) {
    this.assertDemoOwnership(actor, p);
    if (
      !actor?.operations &&
      actor?.seafarerId !== p.id &&
      !(actor?.companyId && actor.companyId === p.companyId)
    )
      fail("SDB_PROFILE_FORBIDDEN", 403);
  }
  customerScope(actor, p) {
    this.assertDemoOwnership(actor, p);
    if (
      actor?.seafarerId !== p.id &&
      !(actor?.companyId && actor.companyId === p.companyId)
    )
      fail("SDB_APPLICANT_BINDING_REQUIRED", 403);
  }
  view(p) {
    return {
      ...copy(p),
      readiness: this.evaluate(p),
      applications: copy(
        this.state.applications.filter((a) => a.profileId === p.id),
      ),
    };
  }
  audit(profileId, event, actor, detail) {
    this.state.audit.unshift({
      id: randomUUID(),
      profileId,
      event,
      actor,
      detail,
      at: iso(this.clock()),
    });
  }
  notify(p, type, title, body, dedup) {
    if (this.state.notifications.some((n) => n.dedup === dedup)) return;
    this.state.notifications.unshift({
      id: randomUUID(),
      profileId: p.id,
      type,
      title,
      body,
      at: iso(this.clock()),
      read: false,
      delivery: "IN_APP",
      externalDelivery: "NOT_CONNECTED",
      dedup,
      link: "/moei/seafarers/services",
    });
  }
  refreshProfile(p) {
    const r = this.evaluate(p);
    const fingerprint = fp({
      status: r.status,
      checks: r.checks.map((c) => [
        c.key,
        c.result,
        c.expiryDate,
        c.reason,
        c.reference,
      ]),
    });
    if (p.readinessFingerprint !== fingerprint) {
      p.readinessFingerprint = fingerprint;
      this.notify(
        p,
        "READINESS",
        r.status === "READY"
          ? "Ready to apply for your SDB"
          : "Your SDB readiness has changed",
        r.status === "READY"
          ? "All current prerequisites passed. Sign in to confirm your SDB request."
          : r.blockers.map((b) => b.label + ": " + b.reason).join(" • "),
        "readiness:" + p.id + ":" + p.version + ":" + fingerprint,
      );
      this.audit(
        p.id,
        "READINESS_RECALCULATED",
        "SYSTEM",
        r.status + "; policy " + this.policy.version,
      );
    }
    if (
      p.existingSdb &&
      atEnd(p.existingSdb.expiryDate) > this.clock() &&
      atEnd(p.existingSdb.expiryDate) - this.clock() <=
        this.policy.reminderDays * day
    )
      this.notify(
        p,
        "RENEWAL",
        "Your SDB expires soon",
        "Your SDB expires on " +
          p.existingSdb.expiryDate +
          ". Review your renewal readiness.",
        p.id + ":sdb-expiry:" + p.existingSdb.expiryDate,
      );
    for (const c of r.expiring)
      this.notify(
        p,
        "EXPIRY",
        "A document expires soon",
        c.label +
          " expires on " +
          c.expiryDate +
          ". Renew it at " +
          c.source +
          ".",
        p.id + ":expiry:" + c.key + ":" + c.expiryDate,
      );
    return r;
  }
  monitor() {
    // GETs and the periodic worker both catch expiries even without source events.
    const before = fp(this.state);
    const previous = copy(this.state);
    try {
      for (const p of this.state.profiles) this.refreshProfile(p);
      if (before !== fp(this.state) && this.file)
        atomicJsonWrite(this.file, this.state);
    } catch (e) {
      this.state = previous;
      throw e;
    }
  }
  dashboard(actor) {
    this.monitor();
    const profiles = this.state.profiles
      .filter(
        (p) =>
          (!p.demoJourney||p.demoJourney.operatorKey===actor.key||
             (actor.seafarerId===p.id&&actor.key.includes('[SANDBOX PREVIEW]'))) &&
          (actor.operations ||
          p.id === actor.seafarerId ||
          (actor.companyId && p.companyId === actor.companyId)),
      )
      .map((p) => this.view(p));
    const visible = new Set(profiles.map((p) => p.id));
    return {
      mode: "CONTRACT_SANDBOX",
      policy: this.policy,
      readinessConfigurationVersion:this.state.readinessSettings.version,
      readinessEngine:{
        type:'CONFIG_DRIVEN_AGENTIC_AI_READINESS_POC',
        mode:'EXPLAINABLE_RULE_ENGINE',aiModelInvoked:false,
        documentAiProvider:'NOT_CONNECTED',baselineEnforced:true
      },
      fees: this.fees,
      actor,
      profiles,
      notifications: this.state.notifications.filter((n) =>
        visible.has(n.profileId),
      ),
      audit: this.state.audit
        .filter((a) => visible.has(a.profileId))
        .slice(0, 250),
      companies: [
        { id: "COMPANY-NATIONAL", name: "National Sea Transport" },
        { id: "COMPANY-HARBOUR", name: "Harbour Marine LLC" },
      ],
      connectors: sources.map((source) => ({
        source,
        mode: "CONTRACT_SANDBOX",
        liveConnected: false,
      })),
      summary: {
        candidates: profiles.length,
        ready: profiles.filter((p) => p.readiness.status === "READY").length,
        holds: profiles.filter((p) => p.readiness.status === "ON_HOLD").length,
        pending: profiles.filter(
          (p) => p.readiness.status === "PENDING_VERIFICATION",
        ).length,
      },
    };
  }
  get(actor, id) {
    this.monitor();
    const p = this.profile(id);
    this.scope(actor, p);
    return this.view(p);
  }
  /**
   * Explicit READY-only sandbox fixture selection, scoped to the signed-in
   * operations user. Existing real/sandbox profiles and applications NEVER
   * change when the demo scenario is selected.
   */
  beginReadyDemoJourney(actor,scenarioId,syntheticProfile){
    this.assertOperations(actor);
    if(!['CADET_READY','RENEWAL_READY'].includes(scenarioId)||
      !syntheticProfile||typeof syntheticProfile!=='object')
      fail('SDB_READY_SCENARIO_REQUIRED',422);
    const current=this.state.profiles.find(p=>p.demoJourney?.operatorKey===
      actor.key&&p.demoJourney.scenarioId===scenarioId);
    if(current){
      const r=this.evaluate(current);
      if(r.status!=='READY')fail('SDB_READINESS_CHANGED',409);
      return {profileId:current.id,scenarioId,readiness:r,
       alreadyProvisioned:true,mode:'ISOLATED_POC_DEMO'};
    }
    const profile=copy(syntheticProfile);
    const originReadiness=this.evaluate(profile);
    if(originReadiness.status!=='READY'||
      (scenarioId==='CADET_READY'&&originReadiness.service!=='FIRST_ISSUE')||
      (scenarioId==='RENEWAL_READY'&&originReadiness.service!=='RENEWAL'))
      fail('SDB_READINESS_CHANGED',409);
    return this.transaction(()=>{
      // Cloned POC service journey must never share a national identifier,
      // applicant ID, live work order or issued register with source fixture.
      profile.id='SF-POC-'+randomUUID().slice(0,12);
      profile.nationalId='SYNTHETIC-DEMO-'+randomUUID().slice(0,16);
      profile.contact={...profile.contact,
       email:'synthetic-applicant@example.test'};
      profile.demoJourney={
        scenarioId,operatorKey:actor.key,createdAt:iso(this.clock()),
        dataClassification:'SYNTHETIC_POC_ONLY',
        officialSubmission:false,sourceProfileId:syntheticProfile.id
      };
      profile.documents=[];
      profile.version=1;
      profile.readinessFingerprint=null;
      this.state.profiles.push(profile);
      this.audit(profile.id,'ISOLATED_READY_DEMO_PROVISIONED',actor.key,
        scenarioId+'; never creates an official ministry record');
      const readiness=this.evaluate(profile);
      if(readiness.status!=='READY')fail('SDB_READINESS_CHANGED',409);
      return {profileId:profile.id,scenarioId,readiness,
       alreadyProvisioned:false,mode:'ISOLATED_POC_DEMO'};
    });
  }

  previewActor(actor, id, company = false) {
    this.assertOperations(actor);
    const p = this.profile(id);
    if(p.demoJourney&&p.demoJourney.operatorKey!==actor.key)
      fail('SDB_DEMO_JOURNEY_NOT_OWNED',403);
    if (company && !p.companyId) fail("SDB_COMPANY_ASSOCIATION_REQUIRED");
    return {
      ...actor,
      operations: false,
      seafarerId: company ? null : id,
      companyId: company ? p.companyId : null,
      key: actor.key + " [SANDBOX PREVIEW]",
    };
  }
  applyEvent(actor, event, source) {
    this.assertOperations(actor);
    return this.transaction(() => this.ingest(event, source, actor.key));
  }
  ingest(event, source, actorKey) {
    if (!sources.includes(source)) fail("SDB_SOURCE_INVALID");
    const eventId = text(event.eventId, 100),
      nationalId = text(event.nationalId, 80);
    if (
      event.schemaVersion !== 1 ||
      !Number.isInteger(event.sequence) ||
      event.sequence < 1 ||
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      Date.parse(event.occurredAt) > this.clock() + 60000
    )
      fail("SDB_EVENT_ENVELOPE_INVALID");
    const key = source + ":" + eventId,
      hash = fp(event);
    if (this.state.events[key]) {
      if (this.state.events[key] !== hash) fail("SDB_EVENT_ID_CONFLICT", 409);
      return { duplicate: true };
    }
    const allowed = {
      ACADEMY: ["COP_UPDATED", "ACADEMY_CLEARANCE"],
      MARASI: ["MEDICAL_UPDATED"],
      MOI_ICP: ["IDENTITY_UPDATED"],
    };
    if (!allowed[source].includes(event.type))
      fail("SDB_EVENT_SOURCE_MISMATCH", 403);
    const d = event.data || {},
      now = this.clock();
    let p = this.state.profiles.find((p) => p.nationalId === nationalId),
      created = false;
    // A Potential Seafarer is created only by a real certificate-shaped qualifying event.
    if (!p) {
      if (
        event.type !== "COP_UPDATED" ||
        !COP_TYPES.includes(d.type) ||
        d.status !== "VALID" ||
        !validDate(d.issueDate) ||
        Date.parse(d.issueDate + "T00:00:00Z") > now ||
        !validDate(d.expiryDate) ||
        atEnd(d.expiryDate) <= now
      )
        fail("SDB_FIRST_QUALIFYING_COP_REQUIRED");
      p = emptyCandidate(
        "SF-" + randomUUID().slice(0, 8),
        nationalId,
        text(d.name, 160),
        text(event.academyId, 80),
        now,
      );
      this.state.profiles.push(p);
      created = true;
    }
    if (source === "ACADEMY" && event.academyId !== p.academyId)
      fail("SDB_ACADEMY_SCOPE_MISMATCH", 403);
    const recordKey =
      source +
      ":" +
      event.type +
      (event.type === "COP_UPDATED" ? ":" + d.type : "");
    const previous = p.sourceVersions[recordKey];
    if (
      previous &&
      (event.sequence <= previous.sequence ||
        Date.parse(event.occurredAt) < Date.parse(previous.occurredAt))
    )
      fail("SDB_EVENT_OUT_OF_ORDER", 409);
    if (event.type === "COP_UPDATED") {
      if (
        !COP_TYPES.includes(d.type) ||
        !["VALID", "REVOKED", "SUSPENDED"].includes(d.status) ||
        !validDate(d.issueDate) ||
        !validDate(d.expiryDate) ||
        d.expiryDate < d.issueDate
      )
        fail("SDB_CERTIFICATE_INVALID");
      const cert = {
        id: text(d.id, 100),
        type: d.type,
        title: COP_LABELS[d.type],
        status: d.status,
        issueDate: d.issueDate,
        expiryDate: d.expiryDate,
        reference: text(d.reference, 100),
      };
      p.certificates = p.certificates.filter((c) => c.type !== d.type);
      p.certificates.push(cert);
    } else if (event.type === "MEDICAL_UPDATED") {
      if (
        !["FIT", "UNFIT", "PENDING", "REVOKED"].includes(d.status) ||
        !validDate(d.issuedAt) ||
        !validDate(d.expiryDate) ||
        d.expiryDate < d.issuedAt ||
        !Array.isArray(d.validFor) ||
        d.validFor.some((x) => !["FIRST_ISSUE", "RENEWAL"].includes(x))
      )
        fail("SDB_MEDICAL_INVALID");
      p.medical = {
        reference: text(d.reference, 100),
        status: d.status,
        issuedAt: d.issuedAt,
        expiryDate: d.expiryDate,
        validFor: d.validFor,
      };
    } else if (event.type === "IDENTITY_UPDATED") {
      if (
        !validDate(d.issueDate) ||
        !validDate(d.expiryDate) ||
        d.expiryDate < d.issueDate ||
        !["VALID", "REVOKED", "PENDING"].includes(d.status)
      )
        fail("SDB_PASSPORT_INVALID");
      p.passport = {
        number: text(d.number, 80),
        issueDate: d.issueDate,
        expiryDate: d.expiryDate,
        status: d.status,
        reference: text(d.reference, 100),
      };
      p.photoReference = text(d.photoReference, 160);
      p.name = text(d.name, 160);
      p.nationality = text(d.nationality, 80);
    } else if (event.type === "ACADEMY_CLEARANCE") {
      this.setClearance(
        p,
        "ACADEMY",
        { ...d, updatedAt: event.occurredAt },
        actorKey,
      );
    }
    // Evidence observedAt is authoritative event time, not receipt time: old events never manufacture freshness.
    const checkedAt = event.occurredAt;
    if (
      !p.sourceSync[source] ||
      Date.parse(checkedAt) >= Date.parse(p.sourceSync[source].checkedAt)
    )
      p.sourceSync[source] = {
        status: "AVAILABLE",
        checkedAt,
        reference: eventId,
      };
    p.sourceVersions[recordKey] = {
      sequence: event.sequence,
      occurredAt: event.occurredAt,
    };
    p.version++;
    p.lastUpdated = iso(now);
    this.state.events[key] = hash;
    this.audit(
      p.id,
      event.type,
      actorKey,
      source + " event " + eventId + "; evidence " + (d.reference || ""),
    );
    if (created)
      this.notify(
        p,
        "WELCOME",
        "Congratulations on your qualifying certificate",
        "Your Potential Seafarer profile is open. Complete the remaining CoPs, MARASI medical, passport/photo verification and academy no objection for your SDB.",
        "welcome:" + p.id,
      );
    this.notify(
      p,
      "SOURCE_UPDATE",
      "Your source record has changed",
      source +
        ": " +
        event.type +
        ". " +
        (d.status || "") +
        " " +
        (d.expiryDate ? "Expiry: " + d.expiryDate : ""),
      "source:" + key,
    );
    this.refreshProfile(p);
    return { created, profile: this.view(p) };
  }
  setClearance(p, authority, d, actorKey) {
    if (!["HOLD", "NO_OBJECTION"].includes(d.status))
      fail("SDB_CLEARANCE_INVALID");
    const reason = d.status === "HOLD" ? text(d.reason, 500) : "";
    p.clearances[authority] = {
      status: d.status,
      reason,
      reference: text(d.reference, 100),
      updatedAt: d.updatedAt || iso(this.clock()),
    };
    this.notify(
      p,
      d.status === "HOLD" ? "HOLD" : "HOLD_RELEASED",
      d.status === "HOLD"
        ? "A hold has been placed on your SDB journey"
        : "No objection received",
      authority +
        ": " +
        (reason || "No objection confirmed by the owning source.") +
        " Reference: " +
        d.reference +
        ". Contact the source for follow-up.",
      "clearance:" +
        p.id +
        ":" +
        authority +
        ":" +
        d.reference +
        ":" +
        d.status +
        ":" +
        (p.version + 1),
    );
    this.audit(
      p.id,
      "CLEARANCE_" + d.status,
      actorKey,
      authority + "; " + d.reference + "; " + reason,
    );
  }
  companyDecision(actor, id, d) {
    const p = this.profile(id);
    // Operations cannot manufacture a company's decision: use a scoped sandbox preview instead.
    if (!actor.companyId || actor.companyId !== p.companyId)
      fail("SDB_COMPANY_FORBIDDEN", 403);
    if (!p.existingSdb) fail("SDB_COMPANY_HOLD_RENEWAL_ONLY", 409);
    return this.transaction(() => {
      const previous = p.clearances.COMPANY;
      if (
        previous?.status === d.status &&
        previous?.reference === d.reference &&
        previous?.reason === (d.reason || "")
      )
        return this.view(p);
      this.setClearance(p, "COMPANY", d, actor.key);
      p.version++;
      p.lastUpdated = iso(this.clock());
      this.refreshProfile(p);
      return this.view(p);
    });
  }
  requireReady(p) {
    const r = this.evaluate(p);
    if (r.status !== "READY") fail("SDB_READINESS_CHANGED", 409);
    return r;
  }
  startApplication(actor, id) {
    const p = this.profile(id);
    this.customerScope(actor, p);
    this.requireReady(p);
    return this.transaction(() => {
      const active = this.state.applications.find(
        (a) =>
          a.profileId === id && !["ISSUED", "CANCELLED"].includes(a.status),
      );
      if (active) return active;
      if (
        this.state.applications.some(
          (a) => a.profileId === id && a.status === "ISSUED",
        )
      )
        fail("SDB_ALREADY_ISSUED_IN_SANDBOX", 409);
      const a = {
        id: "APP-" + randomUUID().slice(0, 12),
        profileId: id,
        service: p.existingSdb ? "RENEWAL" : "FIRST_ISSUE",
        status: "DRAFT",
        version: 1,
        createdAt: iso(this.clock()),
        format: "ELECTRONIC",
        delivery: "NONE",
        recipient: copy(p.contact),
        declaration: false,
        invoice: null,
        payment: null,
        digital: null,
        fulfilment: null,
      };
      this.state.applications.push(a);
      this.notify(
        p,
        "APPLICATION",
        "Your SDB request has started",
        "Request " +
          a.id +
          " is ready for your SDB format and delivery choices.",
        "application:" + a.id,
      );
      this.audit(id, "APPLICATION_STARTED", actor.key, a.id + "; " + a.service);
      return a;
    });
  }
  application(actor, id) {
    const a =
      this.state.applications.find((a) => a.id === id) ||
      fail("SDB_APPLICATION_NOT_FOUND", 404);
    const p = this.profile(a.profileId);
    this.scope(actor, p);
    return a;
  }
  configure(actor, id, d) {
    const a = this.application(actor, id),
      p = this.profile(a.profileId);
    this.customerScope(actor, p);
    this.requireReady(p);
    if (a.status !== "DRAFT") fail("SDB_APPLICATION_LOCKED", 409);
    if (d.version !== a.version) fail("SDB_VERSION_CONFLICT", 409);
    if (
      !["ELECTRONIC", "ELECTRONIC_PRINT"].includes(d.format) ||
      !["NONE", "POST", "PICKUP"].includes(d.delivery) ||
      (d.format === "ELECTRONIC"
        ? d.delivery !== "NONE"
        : d.delivery === "NONE")
    )
      fail("SDB_FULFILMENT_CHOICE_INVALID");
    if (d.declaration !== true) fail("SDB_DECLARATION_REQUIRED");
    const recipient = {
      recipient: text(d.recipient?.recipient, 160),
      email: text(d.recipient?.email, 160),
      phone: text(d.recipient?.phone, 40),
      address:
        d.delivery === "POST"
          ? text(d.recipient?.address, 300)
          : String(d.recipient?.address || "").slice(0, 300),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email))
      fail("SDB_CONTACT_EMAIL_INVALID");
    return this.transaction(() => {
      Object.assign(a, {
        format: d.format,
        delivery: d.delivery,
        recipient,
        declaration: true,
        version: a.version + 1,
      });
      this.audit(
        p.id,
        "DELIVERY_CONFIRMED",
        actor.key,
        a.id + "; " + a.format + "; " + a.delivery,
      );
      return a;
    });
  }
  invoice(actor, id) {
    const a = this.application(actor, id),
      p = this.profile(a.profileId);
    this.customerScope(actor, p);
    this.requireReady(p);
    if (a.invoice) return copy(a);
    if (a.status !== "DRAFT" || !a.declaration)
      fail("SDB_APPLICATION_CONFIRMATION_REQUIRED", 409);
    return this.transaction(() => {
      const lines = [
        {
          code: a.service,
          description:
            a.service === "RENEWAL" ? "SDB renewal" : "SDB first issuance",
          amount: a.service === "RENEWAL" ? this.fees.renewal : this.fees.issue,
        },
      ];
      if (a.format === "ELECTRONIC_PRINT")
        lines.push({
          code: "PRINT",
          description: "Printed booklet",
          amount: this.fees.print,
        });
      if (a.delivery === "POST")
        lines.push({
          code: "POST",
          description: "Postal delivery",
          amount: this.fees.post,
        });
      a.invoice = {
        id: "INV-" + randomUUID().slice(0, 10),
        currency: this.fees.currency,
        feeVersion: this.fees.version,
        illustrative: true,
        lines,
        total: lines.reduce((s, l) => s + l.amount, 0),
        createdAt: iso(this.clock()),
        status: "UNPAID",
      };
      a.status = "AWAITING_PAYMENT";
      a.version++;
      this.notify(
        p,
        "INVOICE",
        "Your SDB invoice is ready",
        "Invoice " +
          a.invoice.id +
          "; sandbox total " +
          a.invoice.total +
          " " +
          a.invoice.currency +
          ". Sign in to continue payment.",
        "invoice:" + a.invoice.id,
      );
      this.audit(p.id, "INVOICE_CREATED", actor.key, a.invoice.id);
      return a;
    });
  }
  pay(actor, id, d) {
    const a = this.application(actor, id),
      p = this.profile(a.profileId);
    this.customerScope(actor, p);
    const key = text(d.idempotencyKey, 120);
    if (a.payment?.idempotencyKey === key) return copy(a);
    if (a.status === "ISSUED") return copy(a);
    this.requireReady(p);
    if (a.status !== "AWAITING_PAYMENT" || !a.invoice)
      fail("SDB_INVOICE_REQUIRED", 409);
    if (!["SUCCESS", "FAILED", "CANCELLED"].includes(d.result))
      fail("SDB_PAYMENT_RESULT_INVALID");
    return this.transaction(() => {
      a.payment = {
        idempotencyKey: key,
        reference: "PAY-SANDBOX-" + randomUUID().slice(0, 8),
        result: d.result,
        amount: a.invoice.total,
        currency: a.invoice.currency,
        at: iso(this.clock()),
      };
      this.audit(
        p.id,
        "SANDBOX_PAYMENT_" + d.result,
        actor.key,
        a.id + "; no money moved",
      );
      if (d.result !== "SUCCESS") {
        this.notify(
          p,
          "PAYMENT",
          "Payment was not completed",
          "Your invoice is available to retry. No SDB was issued.",
          "payment:" + a.id + ":" + key,
        );
        a.version++;
        return a;
      }
      this.requireReady(p);
      a.invoice.status = "PAID";
      a.status = "ISSUED";
      a.version++;
      const now = this.clock(),
        expires = new Date(now);
      expires.setUTCFullYear(
        expires.getUTCFullYear() + this.policy.bookletYears,
      );
      a.digital = {
        number: "SDB-SANDBOX-" + randomUUID().slice(0, 10),
        sid: p.existingSdb?.sid || "SID-SANDBOX-" + randomUUID().slice(0, 10),
        name: p.name,
        issuedAt: date(now),
        expiryDate: date(expires),
        status: "SIMULATED",
        verificationReference: "VERIFY-SANDBOX-" + randomUUID().slice(0, 8),
        policyVersion: this.policy.version,
        evidenceVersion: p.version,
        previousSdb: p.existingSdb?.number || null,
      };
      // Link the issued SID and current booklet to this sandbox profile; renewal keeps its identity.
      p.issuedSdbHistory = [...(p.issuedSdbHistory || []), copy(a.digital)];
      p.existingSdb = {
        sid: a.digital.sid,
        number: a.digital.number,
        expiryDate: a.digital.expiryDate,
      };
      p.version++;
      p.lastUpdated = iso(now);
      this.refreshProfile(p);
      a.fulfilment = {
        status: a.format === "ELECTRONIC" ? "NOT_REQUIRED" : "PRINT_QUEUED",
        trackingNumber: null,
        carrier: null,
        pickupAt: null,
        history: [
          {
            status: a.format === "ELECTRONIC" ? "NOT_REQUIRED" : "PRINT_QUEUED",
            at: iso(now),
          },
        ],
      };
      this.notify(
        p,
        "ISSUED",
        "Your electronic SDB is available",
        "Sandbox SDB " +
          a.digital.number +
          "; SID " +
          a.digital.sid +
          ". " +
          (a.format === "ELECTRONIC_PRINT"
            ? "Your printed booklet has entered the print queue."
            : "You selected electronic only."),
        "issued:" + a.id,
      );
      this.audit(
        p.id,
        "SDB_ISSUED_SANDBOX",
        "SYSTEM",
        a.id + "; " + a.digital.sid + "; " + this.policy.version,
      );
      return a;
    });
  }
  fulfil(actor, id, d) {
    this.assertOperations(actor);
    const a = this.application(actor, id),
      p = this.profile(a.profileId);
    if (a.status !== "ISSUED" || a.format !== "ELECTRONIC_PRINT")
      fail("SDB_PRINT_ORDER_REQUIRED", 409);
    const current = a.fulfilment.status;
    const next = {
      PRINT_QUEUED: "PRINTED",
      PRINTED: a.delivery === "POST" ? "DISPATCHED" : "READY_FOR_PICKUP",
      DISPATCHED: "DELIVERED",
      READY_FOR_PICKUP: "COLLECTED",
    }[current];
    if (!next || d.status !== next)
      fail("SDB_FULFILMENT_TRANSITION_INVALID", 409);
    return this.transaction(() => {
      if (next === "DISPATCHED") {
        a.fulfilment.trackingNumber = text(d.trackingNumber, 100);
        a.fulfilment.carrier = text(d.carrier, 100);
      }
      if (next === "READY_FOR_PICKUP") {
        if (
          !Number.isFinite(Date.parse(d.pickupAt)) ||
          Date.parse(d.pickupAt) <= this.clock()
        )
          fail("SDB_PICKUP_APPOINTMENT_REQUIRED");
        a.fulfilment.pickupAt = d.pickupAt;
      }
      a.fulfilment.status = next;
      a.fulfilment.history.push({ status: next, at: iso(this.clock()) });
      a.version++;
      const body =
        next === "DISPATCHED"
          ? "Carrier: " +
            a.fulfilment.carrier +
            "; tracking: " +
            a.fulfilment.trackingNumber +
            "."
          : next === "READY_FOR_PICKUP"
            ? "Collect from MOEI service centre at " +
              a.fulfilment.pickupAt +
              "."
            : "Your printed SDB status is " + next + ".";
      this.notify(
        p,
        "FULFILMENT",
        "Printed booklet: " + next,
        body,
        "fulfilment:" + a.id + ":" + next,
      );
      this.audit(p.id, "FULFILMENT_" + next, actor.key, a.id);
      return a;
    });
  }
  markRead(actor, id) {
    const n =
      this.state.notifications.find((n) => n.id === id) ||
      fail("SDB_NOTIFICATION_NOT_FOUND", 404);
    this.scope(actor, this.profile(n.profileId));
    return this.transaction(() => {
      n.read = true;
      return { ok: true };
    });
  }
  simulate(actor, id, action) {
    this.assertOperations(actor);
    const p = this.profile(id),
      now = this.clock();
    if (action === "NEW_CANDIDATE") {
      const uid = randomUUID().slice(0, 8);
      return this.applyEvent(
        actor,
        {
          schemaVersion: 1,
          eventId: "DEMO-" + uid,
          sequence: 1,
          occurredAt: iso(now),
          nationalId: "DEMO-NATIONAL-" + uid,
          academyId: "ACADEMY-GULF",
          type: "COP_UPDATED",
          data: {
            name: "New Academy Candidate " + uid,
            id: "COP-" + uid,
            type: "PST",
            status: "VALID",
            issueDate: date(now),
            expiryDate: date(now + 500 * day),
            reference: "ACADEMY-" + uid,
          },
        },
        "ACADEMY",
      );
    }
    let source, type, data;
    if (action === "COMPLETE_COPS") {
      const results = [];
      for (const cop of COP_TYPES)
        results.push(this.simulateCop(actor, p, cop));
      return results.at(-1);
    }
    if (action === "MEDICAL_FIT") {
      source = "MARASI";
      type = "MEDICAL_UPDATED";
      data = {
        reference: "MARASI-" + randomUUID().slice(0, 8),
        status: "FIT",
        issuedAt: date(now),
        expiryDate: date(now + 365 * day),
        validFor: ["FIRST_ISSUE", "RENEWAL"],
      };
    }
    if (action === "PASSPORT_VALID") {
      source = "MOI_ICP";
      type = "IDENTITY_UPDATED";
      data = {
        number: p.passport?.number || "DEMO-P-" + p.id,
        status: "VALID",
        issueDate: date(now - 365 * day),
        expiryDate: date(now + 900 * day),
        reference: "MOI-" + randomUUID().slice(0, 8),
        photoReference: "PHOTO-DEMO-" + p.id,
        name: p.name,
        nationality: "UAE",
      };
    }
    if (action === "ACADEMY_HOLD" || action === "ACADEMY_CLEAR") {
      source = "ACADEMY";
      type = "ACADEMY_CLEARANCE";
      data = {
        status: action === "ACADEMY_HOLD" ? "HOLD" : "NO_OBJECTION",
        reason: "Academy administrative review pending.",
        reference: "ACADEMY-CASE-" + randomUUID().slice(0, 8),
      };
    }
    if (action === "SOURCE_OUTAGE")
      return this.transaction(() => {
        p.sourceSync.MARASI = {
          status: "UNAVAILABLE",
          checkedAt: iso(now),
          reference: "SIMULATED-OUTAGE",
        };
        p.version++;
        this.audit(
          id,
          "SOURCE_UNAVAILABLE",
          actor.key,
          "MARASI simulated outage",
        );
        this.notify(
          p,
          "SOURCE_UPDATE",
          "Medical verification is temporarily unavailable",
          "Your SDB readiness is awaiting MARASI verification.",
          "outage:" + p.id + ":" + p.version,
        );
        this.refreshProfile(p);
        return { profile: this.view(p) };
      });
    if (!source) fail("SDB_DEMO_ACTION_INVALID");
    return this.applyEvent(
      actor,
      {
        schemaVersion: 1,
        eventId: randomUUID(),
        sequence: (p.sourceVersions[source + ":" + type]?.sequence || 0) + 1,
        occurredAt: iso(now),
        nationalId: p.nationalId,
        academyId: p.academyId,
        type,
        data,
      },
      source,
    );
  }
  simulateCop(actor, p, cop) {
    const key = "ACADEMY:COP_UPDATED:" + cop,
      now = this.clock();
    return this.applyEvent(
      actor,
      {
        schemaVersion: 1,
        eventId: randomUUID(),
        sequence: (p.sourceVersions[key]?.sequence || 0) + 1,
        occurredAt: iso(now),
        nationalId: p.nationalId,
        academyId: p.academyId,
        type: "COP_UPDATED",
        data: {
          id: p.id + "-" + cop,
          type: cop,
          status: "VALID",
          issueDate: date(now - 10 * day),
          expiryDate: date(now + 550 * day),
          reference: "COP-" + randomUUID().slice(0, 8),
        },
      },
      "ACADEMY",
    );
  }
}
