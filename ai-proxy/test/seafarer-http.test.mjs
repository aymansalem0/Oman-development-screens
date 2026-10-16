import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { MoeiPocAuth } from "../moei-poc-auth.mjs";
import { MoeiGoogleSso } from "../moei-google-sso.mjs";
import { SeafarerWorkspace } from "../seafarer-workspace.mjs";
import {
  createSeafarerHandler,
  verifySdbSignature,
} from "../seafarer-http.mjs";
async function fixture(t) {
  const auth = new MoeiPocAuth(),
    workspace = new SeafarerWorkspace({
      file: null,
      bindings: {
        "self@example.test": { seafarerId: "SF-002" },
        "employer@example.test": { companyId: "COMPANY-HARBOUR" },
      },
    });
  const secret = "sandbox-contract-secret-for-tests-only-12345";
  const handler = createSeafarerHandler({
    auth,
    workspace,
    env: { SDB_ACADEMY_WEBHOOK_SECRET: secret },
  });
  const server = createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port + "/api/seafarers/v1";
  const tokens = {};
  for (const [name, role] of [
    ["admin", "ADMIN"],
    ["self", "VIEWER"],
    ["employer", "VIEWER"],
  ])
    tokens[name] = auth.issueSession({
      username: name,
      email: name + "@example.test",
      role,
    }).token;
  async function request(
    path = "",
    { method = "GET", as = "admin", body, csrf = true, headers = {} } = {},
  ) {
    const h = { ...headers };
    if (as) h.cookie = "MOEI_POC_SESSION=" + tokens[as];
    if (csrf) h["x-moei-csrf"] = "1";
    if (body) h["content-type"] = "application/json";
    const r = await fetch(url + path, {
      method,
      headers: h,
      ...(body
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: r.status, data: await r.json() };
  }
  return { workspace, request, secret };
}

test("HTTP session and CSRF are required; unbound users cannot preview another seafarer", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/dashboard", { as: null })).status, 401);
  assert.equal(
    (
      await request("/profiles/SF-002/applications", {
        as: "self",
        method: "POST",
        body: {},
        csrf: false,
      })
    ).status,
    403,
  );
  const own = await request("/dashboard", { as: "self" });
  assert.equal(own.status, 200);
  assert.deepEqual(
    own.data.profiles.map((p) => p.id),
    ["SF-002"],
  );
  assert.equal((await request("/profiles/SF-001", { as: "self" })).status, 403);
  assert.equal(
    (await request("/dashboard?preview=SF-003", { as: "self" })).status,
    403,
  );
  const preview = await request("/dashboard?preview=SF-003");
  assert.equal(preview.data.actor.operations, false);
  assert.equal(preview.data.profiles.length, 1);
  assert.equal(
    (
      await request("/profiles/SF-002/simulate", {
        as: "self",
        method: "POST",
        body: { action: "MEDICAL_FIT" },
      })
    ).status,
    403,
  );
});
test("HTTP company requests are scoped and notify the relevant seafarer", async (t) => {
  const { request } = await fixture(t);
  const portfolio = await request("/dashboard", { as: "employer" });
  assert.deepEqual(
    portfolio.data.profiles.map((p) => p.id),
    ["SF-004"],
  );
  const r = await request("/profiles/SF-003/company-decision", {
    as: "employer",
    method: "POST",
    body: { status: "HOLD", reason: "Wrong company", reference: "CASE-1" },
  });
  assert.equal(r.status, 403);
  const clear = await request("/profiles/SF-004/company-decision", {
    as: "employer",
    method: "POST",
    body: { status: "NO_OBJECTION", reference: "CASE-2" },
  });
  assert.equal(clear.status, 200);
  assert.equal(clear.data.readiness.status, "READY");
  const d = await request("/dashboard", { as: "employer" });
  assert.ok(d.data.notifications.some((n) => n.type === "HOLD_RELEASED"));
});
test("full HTTP customer journey invoices authoritative amounts and safely retries failed payment", async (t) => {
  const { request } = await fixture(t);
  let r = await request("/profiles/SF-002/applications", {
    as: "self",
    method: "POST",
    body: {},
  });
  assert.equal(r.status, 200);
  const a = r.data;
  r = await request("/applications/" + a.id + "/options", {
    as: "self",
    method: "POST",
    body: {
      version: a.version,
      format: "ELECTRONIC_PRINT",
      delivery: "POST",
      recipient: a.recipient,
      declaration: true,
    },
  });
  assert.equal(r.status, 200);
  r = await request("/applications/" + a.id + "/invoice", {
    as: "self",
    method: "POST",
    body: { total: 1 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.invoice.total, 175);
  r = await request("/applications/" + a.id + "/pay", {
    as: "self",
    method: "POST",
    body: { result: "FAILED", idempotencyKey: "PAY-FAILED", amount: 1 },
  });
  assert.equal(r.data.status, "AWAITING_PAYMENT");
  r = await request("/applications/" + a.id + "/pay", {
    as: "self",
    method: "POST",
    body: { result: "SUCCESS", idempotencyKey: "PAY-OK", amount: 1 },
  });
  assert.equal(r.data.status, "ISSUED");
  assert.equal(r.data.payment.amount, 175);
  assert.equal(r.data.digital.status, "SIMULATED");
  assert.equal(
    (
      await request("/applications/" + a.id + "/fulfil", {
        as: "self",
        method: "POST",
        body: { status: "PRINTED" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/applications/" + a.id + "/fulfil", {
        method: "POST",
        body: { status: "PRINTED" },
      })
    ).data.fulfilment.status,
    "PRINTED",
  );
});
test("signed webhook verifies raw bytes, source ownership, envelope and persistent deduplication", async (t) => {
  const { request, secret } = await fixture(t),
    ts = String(Math.floor(Date.now() / 1000));
  const e = {
    schemaVersion: 1,
    eventId: "ACADEMY-WEBHOOK-1",
    sequence: 1,
    occurredAt: new Date().toISOString(),
    nationalId: "DEMO-HOOK-CANDIDATE",
    academyId: "ACADEMY-GULF",
    type: "COP_UPDATED",
    data: {
      id: "COP-PST-1",
      name: "بحار تجريبي",
      type: "PST",
      status: "VALID",
      issueDate: new Date().toISOString().slice(0, 10),
      expiryDate: "2028-01-01",
      reference: "COP-SRC-1",
    },
  };
  const raw = JSON.stringify(e),
    headers = {
      "x-sdb-timestamp": ts,
      "x-sdb-signature":
        "sha256=" +
        createHmac("sha256", secret)
          .update(ts + "." + raw)
          .digest("hex"),
    };
  assert.equal(
    (
      await request("/integrations/ACADEMY/events", {
        as: null,
        method: "POST",
        body: raw,
      })
    ).status,
    401,
  );
  const accepted = await request("/integrations/ACADEMY/events", {
    as: null,
    method: "POST",
    body: raw,
    headers,
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.created, true);
  assert.equal(accepted.data.profile.name, "بحار تجريبي");
  assert.equal(
    (
      await request("/integrations/ACADEMY/events", {
        as: null,
        method: "POST",
        body: raw,
        headers,
      })
    ).data.duplicate,
    true,
  );
  assert.equal(
    (
      await request("/integrations/ACADEMY/events", {
        as: null,
        method: "POST",
        body: { ...e, eventId: "TAMPER" },
        headers,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/integrations/MARASI/events", {
        as: null,
        method: "POST",
        body: raw,
        headers,
      })
    ).status,
    503,
  );
  assert.throws(
    () =>
      verifySdbSignature(
        raw,
        { ...headers, "x-sdb-timestamp": "1000000000" },
        secret,
      ),
    (e) => e.code === "SDB_SOURCE_SIGNATURE_INVALID",
  );
});
test("OAuth preserves approved SDB return route through state and rejects external redirect targets", async () => {
  const setup = () =>
    new MoeiGoogleSso({
      clientId: "sandbox-client",
      clientSecret: "sandbox-secret",
      transport: async () => ({
        ok: true,
        json: async () => ({ id_token: "stub" }),
      }),
    });
  for (const returnTo of [
    "/moei/seafarers/services",
    "https://attacker.invalid/",
    "//attacker.invalid",
    "/moei/nmc?redirect=bad",
  ]) {
    const sso = setup();
    sso.verifyIdToken = async () => ({
      email: "user@example.test",
      sub: "test-sub",
    });
    const started = sso.start({
      url:
        "/api/moei/auth/google/start?returnTo=" + encodeURIComponent(returnTo),
      headers: {},
    });
    const state = new URL(started.url).searchParams.get("state");
    const id = await sso.callback(
      { headers: { cookie: "MOEI_GOOGLE_OAUTH_STATE=" + state } },
      { state, code: "test-code" },
    );
    assert.equal(
      id.returnTo,
      returnTo === "/moei/seafarers/services" ? returnTo : undefined,
    );
  }
});

test('eight read-only case previews require an operator and never mutate SDB records',async t=>{
 const {request,workspace}=await fixture(t);
 const before=structuredClone(workspace.state);
 assert.equal((await request('/demo-scenarios',{as:null})).status,401);
 const denied=await request('/demo-scenarios',{as:'self'});
 assert.equal(denied.status,403);
 assert.equal(denied.data.error,'SDB_OPERATIONS_REQUIRED');
 const preview=await request('/demo-scenarios');
 assert.equal(preview.status,200);
 assert.equal(preview.data.officialData,false);
 assert.equal(preview.data.modelInvoked,false);
 assert.equal(preview.data.scenarios.length,8);
 assert.equal(preview.data.scenarios.filter(s=>s.canContinue).length,2);
 assert.equal(preview.data.scenarios.filter(s=>!!s.existingSdb).length,4);
 assert.deepEqual(workspace.state,before,
  'demo preview cannot modify applicant/issuance/hold/notification store');
});
