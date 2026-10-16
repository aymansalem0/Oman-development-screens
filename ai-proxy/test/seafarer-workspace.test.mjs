import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SeafarerWorkspace,
  SdbError,
  evaluateReadiness,
  COP_TYPES,
} from "../seafarer-workspace.mjs";
const now = Date.parse("2026-10-15T12:00:00Z");
const ops = { operations: true, key: "operator@example.test" },
  self = (id) => ({
    operations: false,
    key: "self@example.test",
    seafarerId: id,
    companyId: null,
  });
const company = (id) => ({
  operations: false,
  key: "company@example.test",
  seafarerId: null,
  companyId: id,
});
const make = (opts = {}) =>
  new SeafarerWorkspace({ file: null, clock: () => now, ...opts });
const expectCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof SdbError && e.code === code);
function event(p, type, data, sequence = 1, extra = {}) {
  return {
    schemaVersion: 1,
    eventId: "EVENT-" + Math.random(),
    sequence,
    occurredAt: new Date(now).toISOString(),
    nationalId: p.nationalId,
    academyId: p.academyId,
    type,
    data,
    ...extra,
  };
}
function configured(s, id, format = "ELECTRONIC", delivery = "NONE") {
  const actor = self(id);
  let a = s.startApplication(actor, id);
  a = s.configure(actor, a.id, {
    version: a.version,
    format,
    delivery,
    recipient: {
      recipient: s.profile(id).name,
      email: "seafarer@example.test",
      phone: "+971500000001",
      address: "Demo address",
    },
    declaration: true,
  });
  return s.invoice(actor, a.id);
}

test("readiness uses individual CoP dates, medical service coverage, passport/photo and explicit clearances", () => {
  const s = make(),
    p = s.profile("SF-002");
  assert.equal(evaluateReadiness(p, now).status, "READY");
  assert.equal(
    evaluateReadiness(s.profile("SF-001"), now).checks.filter(
      (c) => c.key.startsWith("COP-") && c.result === "FAIL",
    ).length,
    3,
  );
  const checks = evaluateReadiness(s.profile("SF-005"), now).checks;
  assert.equal(checks.find((c) => c.key === "MEDICAL").result, "FAIL");
  p.certificates[0].status = "REVOKED";
  assert.equal(evaluateReadiness(p, now).status, "INCOMPLETE");
  p.certificates[0].status = "VALID";
  p.certificates[0].expiryDate = "2026-10-14";
  assert.equal(evaluateReadiness(p, now).status, "INCOMPLETE");
  p.certificates[0].expiryDate = "2026-10-15";
  assert.equal(
    evaluateReadiness(p, now).status,
    "READY",
    "date-only expiries include the entire UTC expiry day",
  );
  p.medical.validFor = ["RENEWAL"];
  assert.equal(evaluateReadiness(p, now).status, "INCOMPLETE");
  p.medical.validFor.push("FIRST_ISSUE");
  p.photoReference = null;
  assert.equal(
    evaluateReadiness(p, now).checks.find((c) => c.key === "PHOTO").result,
    "FAIL",
  );
});
test("no objection is never inferred from unavailable, pending or stale source data", () => {
  const s = make();
  assert.equal(s.get(ops, "SF-007").readiness.status, "PENDING_VERIFICATION");
  const p = s.profile("SF-002");
  p.clearances.ACADEMY.status = "PENDING";
  assert.equal(evaluateReadiness(p, now).status, "PENDING_VERIFICATION");
  p.clearances.ACADEMY.status = "NO_OBJECTION";
  p.clearances.ACADEMY.updatedAt = "2026-10-10T00:00:00Z";
  assert.equal(evaluateReadiness(p, now).status, "PENDING_VERIFICATION");
});
test("first qualifying academy event creates one national-ID-linked potential profile and welcome notification", () => {
  const s = make({ seed: false }),
    candidate = { nationalId: "DEMO-CANDIDATE-1", academyId: "ACADEMY-GULF" };
  const data = {
    id: "COP-001",
    type: "PST",
    name: "New Candidate",
    status: "VALID",
    issueDate: "2026-10-14",
    expiryDate: "2027-10-14",
    reference: "COP-REF-1",
  };
  const e = event(candidate, "COP_UPDATED", data);
  const r = s.applyEvent(ops, e, "ACADEMY");
  assert.equal(r.created, true);
  assert.equal(r.profile.certificates.length, 1);
  assert.equal(r.profile.readiness.status, "PENDING_VERIFICATION");
  assert.equal(
    s.state.notifications.filter((n) => n.type === "WELCOME").length,
    1,
  );
  assert.deepEqual(s.applyEvent(ops, e, "ACADEMY"), { duplicate: true });
  assert.equal(s.state.profiles.length, 1);
  s.applyEvent(
    ops,
    event(
      candidate,
      "COP_UPDATED",
      { ...data, id: "COP-002", type: "FPFF" },
      1,
    ),
    "ACADEMY",
  );
  assert.equal(s.state.profiles.length, 1);
  assert.equal(s.state.profiles[0].certificates.length, 2);
  expectCode(
    () =>
      s.applyEvent(
        ops,
        { ...e, data: { ...data, status: "REVOKED" } },
        "ACADEMY",
      ),
    "SDB_EVENT_ID_CONFLICT",
  );
});
test("unqualified, future, malformed or wrong-source events cannot create a candidate", () => {
  const s = make({ seed: false }),
    p = { nationalId: "DEMO-NEW", academyId: "ACADEMY-GULF" };
  const d = {
    id: "C1",
    type: "PST",
    status: "VALID",
    name: "Test",
    issueDate: "2026-10-15",
    expiryDate: "2027-10-15",
    reference: "C1",
  };
  expectCode(
    () =>
      s.applyEvent(
        ops,
        event(p, "COP_UPDATED", { ...d, type: "UNRELATED" }),
        "ACADEMY",
      ),
    "SDB_FIRST_QUALIFYING_COP_REQUIRED",
  );
  expectCode(
    () =>
      s.applyEvent(
        ops,
        event(p, "COP_UPDATED", { ...d, issueDate: "2026-11-15" }),
        "ACADEMY",
      ),
    "SDB_FIRST_QUALIFYING_COP_REQUIRED",
  );
  expectCode(
    () => s.applyEvent(ops, event(p, "COP_UPDATED", d), "MARASI"),
    "SDB_EVENT_SOURCE_MISMATCH",
  );
  expectCode(
    () =>
      s.applyEvent(
        ops,
        event(p, "COP_UPDATED", { ...d, expiryDate: "2027-02-31" }),
        "ACADEMY",
      ),
    "SDB_FIRST_QUALIFYING_COP_REQUIRED",
  );
  assert.equal(s.state.profiles.length, 0);
});
test("event replay protection is per certificate stream; out-of-order events cannot lift a HOLD", () => {
  const s = make(),
    p = s.profile("SF-002");
  s.applyEvent(
    ops,
    event(
      p,
      "ACADEMY_CLEARANCE",
      { status: "HOLD", reason: "Review pending", reference: "AC-HOLD-1" },
      2,
    ),
    "ACADEMY",
  );
  expectCode(
    () =>
      s.applyEvent(
        ops,
        event(
          p,
          "ACADEMY_CLEARANCE",
          { status: "NO_OBJECTION", reference: "AC-CLEAR-OLD" },
          1,
        ),
        "ACADEMY",
      ),
    "SDB_EVENT_OUT_OF_ORDER",
  );
  assert.equal(s.profile(p.id).clearances.ACADEMY.status, "HOLD");
  expectCode(
    () =>
      s.applyEvent(
        ops,
        event(
          p,
          "ACADEMY_CLEARANCE",
          { status: "NO_OBJECTION", reference: "BAD" },
          3,
          { academyId: "OTHER-ACADEMY" },
        ),
        "ACADEMY",
      ),
    "SDB_ACADEMY_SCOPE_MISMATCH",
  );
  s.applyEvent(
    ops,
    event(
      p,
      "ACADEMY_CLEARANCE",
      { status: "NO_OBJECTION", reference: "AC-CLEAR-NEW" },
      3,
    ),
    "ACADEMY",
  );
  assert.equal(s.get(ops, p.id).readiness.status, "READY");
});
test("an old signed event never manufactures fresh evidence from its receipt time", () => {
  const s = make(),
    p = s.profile("SF-002");
  p.sourceSync.MARASI.checkedAt = "2026-10-01T12:00:00Z";
  s.applyEvent(
    ops,
    event(
      p,
      "MEDICAL_UPDATED",
      {
        status: "FIT",
        reference: "M-OLD",
        issuedAt: "2026-09-01",
        expiryDate: "2027-09-01",
        validFor: ["FIRST_ISSUE"],
      },
      1,
      { occurredAt: "2026-10-02T12:00:00Z" },
    ),
    "MARASI",
  );
  assert.equal(s.get(ops, p.id).readiness.status, "PENDING_VERIFICATION");
});
test("company scope is enforced for objections and cannot release academy holds", () => {
  const s = make(),
    p = s.profile("SF-003");
  p.academyRequired = true;
  p.clearances.ACADEMY = {
    status: "HOLD",
    reason: "Academy review",
    reference: "ACA-1",
    updatedAt: new Date(now).toISOString(),
  };
  expectCode(
    () =>
      s.companyDecision(company("COMPANY-HARBOUR"), p.id, {
        status: "HOLD",
        reason: "Wrong company",
        reference: "BAD",
      }),
    "SDB_COMPANY_FORBIDDEN",
  );
  expectCode(
    () =>
      s.companyDecision(ops, p.id, {
        status: "NO_OBJECTION",
        reference: "BAD",
      }),
    "SDB_COMPANY_FORBIDDEN",
  );
  expectCode(
    () =>
      s.companyDecision(company("COMPANY-NATIONAL"), p.id, {
        status: "HOLD",
        reason: "",
        reference: "EMP-1",
      }),
    "SDB_INVALID_FIELD",
  );
  s.companyDecision(company("COMPANY-NATIONAL"), p.id, {
    status: "HOLD",
    reason: "Employment review",
    reference: "EMP-1",
  });
  assert.ok(
    s.state.notifications.some(
      (n) =>
        n.profileId === p.id &&
        n.type === "HOLD" &&
        n.body.includes("Employment review"),
    ),
  );
  s.companyDecision(company("COMPANY-NATIONAL"), p.id, {
    status: "NO_OBJECTION",
    reference: "EMP-2",
  });
  assert.equal(s.profile(p.id).clearances.ACADEMY.status, "HOLD");
  assert.equal(s.get(ops, p.id).readiness.status, "ON_HOLD");
});
test("SSO identity mapping and all list/detail/application/notification paths are scoped", () => {
  const s = make({
    bindings: {
      "user@example.test": { seafarerId: "SF-002" },
      "company@example.test": { companyId: "COMPANY-HARBOUR" },
    },
  });
  const a = s.actor({ email: "user@example.test", role: "VIEWER" });
  assert.equal(s.dashboard(a).profiles.length, 1);
  expectCode(() => s.get(a, "SF-001"), "SDB_PROFILE_FORBIDDEN");
  expectCode(
    () => s.startApplication(a, "SF-003"),
    "SDB_APPLICANT_BINDING_REQUIRED",
  );
  expectCode(() => s.previewActor(a, "SF-003"), "SDB_OPERATIONS_REQUIRED");
  const c = s.actor({ email: "company@example.test", role: "VIEWER" });
  assert.deepEqual(
    s.dashboard(c).profiles.map((p) => p.id),
    ["SF-004"],
  );
  const n = s.state.notifications.find((n) => n.profileId === "SF-001");
  expectCode(() => s.markRead(a, n.id), "SDB_PROFILE_FORBIDDEN");
  assert.equal(
    s.dashboard(s.actor({ email: "unknown@example.test", role: "VIEWER" }))
      .profiles.length,
    0,
  );
});
test("electronic-only issuance charges no print or postage; repeated payment cannot issue/charge twice", () => {
  const s = make(),
    a = configured(s, "SF-002");
  assert.deepEqual(
    a.invoice.lines.map((l) => l.code),
    ["FIRST_ISSUE"],
  );
  assert.equal(a.invoice.total, 100);
  const paid = s.pay(self("SF-002"), a.id, {
    idempotencyKey: "PAY-1",
    result: "SUCCESS",
  });
  assert.equal(paid.status, "ISSUED");
  assert.equal(paid.fulfilment.status, "NOT_REQUIRED");
  assert.ok(paid.digital.sid.startsWith("SID-SANDBOX-"));
  assert.equal(s.profile("SF-002").existingSdb.sid, paid.digital.sid);
  const again = s.pay(self("SF-002"), a.id, {
    idempotencyKey: "PAY-2",
    result: "SUCCESS",
  });
  assert.equal(again.digital.number, paid.digital.number);
  assert.equal(
    s.state.audit.filter((x) => x.event === "SDB_ISSUED_SANDBOX").length,
    1,
  );
  expectCode(
    () => s.fulfil(ops, a.id, { status: "PRINTED" }),
    "SDB_PRINT_ORDER_REQUIRED",
  );
});
test("renewal preserves SID and itemises optional print and postage fees", () => {
  const s = make(),
    p = s.profile("SF-003"),
    sid = p.existingSdb.sid,
    previousNumber = p.existingSdb.number,
    a = configured(s, p.id, "ELECTRONIC_PRINT", "POST");
  assert.deepEqual(
    a.invoice.lines.map((l) => l.code),
    ["RENEWAL", "PRINT", "POST"],
  );
  assert.equal(a.invoice.total, 155);
  const paid = s.pay(self(p.id), a.id, {
    idempotencyKey: "PAY-RENEW",
    result: "SUCCESS",
  });
  assert.equal(paid.digital.sid, sid);
  assert.equal(paid.digital.previousSdb, previousNumber);
  assert.equal(paid.fulfilment.status, "PRINT_QUEUED");
  expectCode(
    () => s.fulfil(ops, a.id, { status: "DISPATCHED" }),
    "SDB_FULFILMENT_TRANSITION_INVALID",
  );
  s.fulfil(ops, a.id, { status: "PRINTED" });
  expectCode(
    () => s.fulfil(ops, a.id, { status: "DISPATCHED" }),
    "SDB_INVALID_FIELD",
  );
  s.fulfil(ops, a.id, {
    status: "DISPATCHED",
    trackingNumber: "DEMO-TRACK-99",
    carrier: "Demo Post",
  });
  assert.ok(
    s.state.notifications.some((n) => n.body.includes("DEMO-TRACK-99")),
  );
  const done = s.fulfil(ops, a.id, { status: "DELIVERED" });
  assert.equal(done.fulfilment.status, "DELIVERED");
});
test("collection requires a future appointment and sends the appointment notice", () => {
  const s = make(),
    a = configured(s, "SF-003", "ELECTRONIC_PRINT", "PICKUP");
  assert.equal(a.invoice.total, 130);
  s.pay(self("SF-003"), a.id, { idempotencyKey: "P1", result: "SUCCESS" });
  s.fulfil(ops, a.id, { status: "PRINTED" });
  expectCode(
    () =>
      s.fulfil(ops, a.id, {
        status: "READY_FOR_PICKUP",
        pickupAt: "2026-10-14T10:00:00Z",
      }),
    "SDB_PICKUP_APPOINTMENT_REQUIRED",
  );
  s.fulfil(ops, a.id, {
    status: "READY_FOR_PICKUP",
    pickupAt: "2026-10-18T10:00:00Z",
  });
  assert.ok(
    s.state.notifications.some((n) => n.body.includes("2026-10-18T10:00:00Z")),
  );
  assert.equal(
    s.fulfil(ops, a.id, { status: "COLLECTED" }).fulfilment.status,
    "COLLECTED",
  );
});
test("HOLD arriving after invoice creation blocks payment and issuance until cleared by its owner", () => {
  const s = make(),
    a = configured(s, "SF-003");
  s.companyDecision(company("COMPANY-NATIONAL"), "SF-003", {
    status: "HOLD",
    reason: "New objection",
    reference: "CASE-900",
  });
  expectCode(
    () =>
      s.pay(self("SF-003"), a.id, { idempotencyKey: "P1", result: "SUCCESS" }),
    "SDB_READINESS_CHANGED",
  );
  assert.equal(s.application(self("SF-003"), a.id).payment, null);
  s.companyDecision(company("COMPANY-NATIONAL"), "SF-003", {
    status: "NO_OBJECTION",
    reference: "CASE-901",
  });
  assert.equal(
    s.pay(self("SF-003"), a.id, { idempotencyKey: "P1", result: "SUCCESS" })
      .status,
    "ISSUED",
  );
});
test("failed/cancelled payment retains invoice and permits a safe retry", () => {
  const s = make(),
    a = configured(s, "SF-002");
  for (const result of ["FAILED", "CANCELLED"]) {
    const r = s.pay(self("SF-002"), a.id, { idempotencyKey: result, result });
    assert.equal(r.status, "AWAITING_PAYMENT");
    assert.equal(r.digital, null);
    assert.equal(r.invoice.status, "UNPAID");
  }
  assert.equal(
    s.pay(self("SF-002"), a.id, {
      idempotencyKey: "SUCCESS",
      result: "SUCCESS",
    }).status,
    "ISSUED",
  );
});
test("invalid delivery data, missing declarations and stale versions cannot create invoice", () => {
  const s = make(),
    actor = self("SF-002"),
    a = s.startApplication(actor, "SF-002");
  assert.equal(s.startApplication(actor, "SF-002").id, a.id);
  expectCode(
    () => s.invoice(actor, a.id),
    "SDB_APPLICATION_CONFIRMATION_REQUIRED",
  );
  expectCode(
    () => s.configure(actor, a.id, { version: a.version - 1 }),
    "SDB_VERSION_CONFLICT",
  );
  expectCode(
    () =>
      s.configure(actor, a.id, {
        version: a.version,
        format: "ELECTRONIC",
        delivery: "POST",
      }),
    "SDB_FULFILMENT_CHOICE_INVALID",
  );
  expectCode(
    () =>
      s.configure(actor, a.id, {
        version: a.version,
        format: "ELECTRONIC",
        delivery: "NONE",
        declaration: false,
      }),
    "SDB_DECLARATION_REQUIRED",
  );
});
test("periodic monitoring detects expiry without inbound events and de-duplicates reminders", () => {
  let clock = now;
  const s = make({ clock: () => clock }),
    p = s.profile("SF-002");
  p.medical.expiryDate = "2026-10-16";
  s.monitor();
  const before = s.state.notifications.length;
  s.monitor();
  assert.equal(s.state.notifications.length, before);
  assert.ok(
    s.state.notifications.some(
      (n) => n.type === "EXPIRY" && n.profileId === p.id,
    ),
  );
  clock = Date.parse("2026-10-17T12:00:00Z");
  s.monitor();
  assert.equal(s.get(ops, p.id).readiness.status, "INCOMPLETE");
});
test("atomic isolated persistence survives reload and failed writes roll back domain state", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdb-test-")),
    file = join(dir, "sdb.json");
  try {
    const s = make({ file }),
      a = configured(s, "SF-002");
    s.pay(self("SF-002"), a.id, {
      idempotencyKey: "PERSIST",
      result: "SUCCESS",
    });
    const restored = make({ file });
    assert.equal(restored.application(self("SF-002"), a.id).status, "ISSUED");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).schemaVersion, 1);
    const before = JSON.stringify(restored.state);
    restored.file = join(file, "invalid-child.json");
    expectCode(
      () => restored.simulate(self("SF-002"), "SF-002", "ACADEMY_HOLD"),
      "SDB_OPERATIONS_REQUIRED",
    );
    assert.throws(() => restored.simulate(ops, "SF-002", "ACADEMY_HOLD"));
    assert.equal(JSON.stringify(restored.state), before);
    writeFileSync(file, "not json");
    expectCode(() => make({ file }), "SDB_STORE_UNREADABLE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
