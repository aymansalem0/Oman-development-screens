import { createHmac, timingSafeEqual } from "node:crypto";
import { SeafarerWorkspace, SdbError } from "./seafarer-workspace.mjs";
const root = "/api/seafarers/v1";
const reject = (code, status) => {
  throw new SdbError(code, status);
};
export function verifySdbSignature(raw, headers, secret, now = Date.now()) {
  if (!secret || secret.length < 32)
    reject("SDB_SOURCE_SIGNATURE_NOT_CONFIGURED", 503);
  const timestamp = String(headers["x-sdb-timestamp"] || ""),
    signature = String(headers["x-sdb-signature"] || "");
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    reject("SDB_SOURCE_SIGNATURE_INVALID", 401);
  const expected = createHmac("sha256", secret)
    .update(timestamp + "." + raw)
    .digest("hex");
  if (
    !timingSafeEqual(
      Buffer.from(signature.slice(7), "hex"),
      Buffer.from(expected, "hex"),
    )
  )
    reject("SDB_SOURCE_SIGNATURE_INVALID", 401);
}
async function read(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 65536) reject("SDB_BODY_TOO_LARGE", 413);
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    reject("SDB_JSON_INVALID", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    reject("SDB_JSON_INVALID", 400);
  return { raw, body };
}
function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
export function createSeafarerHandler({
  auth,
  workspace = null,
  env = process.env,
} = {}) {
  let store = workspace;
  function getStore() {
    if (!store) {
      let bindings;
      try {
        bindings = JSON.parse(env.SDB_SSO_BINDINGS_JSON || "{}");
      } catch {
        reject("SDB_BINDINGS_CONFIGURATION_INVALID", 503);
      }
      if (!bindings || typeof bindings !== "object" || Array.isArray(bindings))
        reject("SDB_BINDINGS_CONFIGURATION_INVALID", 503);
      store = new SeafarerWorkspace({
        bindings,
        file: env.SDB_STORE_PATH || "/data/sdb-readiness-sandbox.json",
      });
      const timer = setInterval(() => {
        try {
          store.monitor();
        } catch {
          console.error("[sdb] SDB_MONITOR_UNAVAILABLE");
        }
      }, 60000);
      timer.unref();
    }
    return store;
  }
  return async function handle(req, res) {
    const url = new URL(req.url || "/", "http://localhost"),
      path = url.pathname;
    if (path !== root && !path.startsWith(root + "/")) return false;
    try {
      if (env.SDB_ENABLED === "false") reject("SDB_MODULE_DISABLED", 503);
      const hook = path.match(
        /^\/api\/seafarers\/v1\/integrations\/(ACADEMY|MARASI|MOI_ICP)\/events$/,
      );
      if (hook) {
        if (req.method !== "POST") reject("SDB_METHOD_NOT_ALLOWED", 405);
        const { raw, body } = await read(req);
        verifySdbSignature(
          raw,
          req.headers,
          env["SDB_" + hook[1] + "_WEBHOOK_SECRET"],
        );
        const result = getStore().applyEvent(
          { operations: true, key: hook[1] + " SIGNED CONTRACT EVENT" },
          body,
          hook[1],
        );
        send(res, 200, result);
        return true;
      }
      const identity = auth.require(req),
        s = getStore();
      let actor = s.actor(identity);
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-moei-csrf"] !== "1"
      )
        reject("SDB_CSRF_REQUIRED", 403);
      const preview = url.searchParams.get("preview");
      if (preview)
        actor = s.previewActor(
          actor,
          preview,
          url.searchParams.get("as") === "COMPANY",
        );
      if (req.method === "GET" && path === root + "/dashboard") {
        send(res, 200, s.dashboard(actor));
        return true;
      }
      const profile = path.match(
        /^\/api\/seafarers\/v1\/profiles\/([^/]+)(?:\/(applications|company-decision|simulate))?$/,
      );
      if (profile) {
        const id = decodeURIComponent(profile[1]),
          action = profile[2];
        if (req.method === "GET" && !action) {
          send(res, 200, s.get(actor, id));
          return true;
        }
        if (req.method === "POST") {
          const { body } = await read(req);
          let result;
          if (action === "applications") result = s.startApplication(actor, id);
          else if (action === "company-decision")
            result = s.companyDecision(actor, id, body);
          else if (action === "simulate")
            result = s.simulate(actor, id, body.action);
          else reject("SDB_ROUTE_NOT_FOUND", 404);
          send(res, 200, result);
          return true;
        }
      }
      const application = path.match(
        /^\/api\/seafarers\/v1\/applications\/([^/]+)(?:\/(options|invoice|pay|fulfil))?$/,
      );
      if (application) {
        const id = decodeURIComponent(application[1]),
          action = application[2];
        if (req.method === "GET" && !action) {
          send(res, 200, s.application(actor, id));
          return true;
        }
        if (req.method === "POST") {
          const { body } = await read(req);
          let result;
          if (action === "options") result = s.configure(actor, id, body);
          else if (action === "invoice") result = s.invoice(actor, id);
          else if (action === "pay") result = s.pay(actor, id, body);
          else if (action === "fulfil") result = s.fulfil(actor, id, body);
          else reject("SDB_ROUTE_NOT_FOUND", 404);
          send(res, 200, result);
          return true;
        }
      }
      const readNotice = path.match(
        /^\/api\/seafarers\/v1\/notifications\/([^/]+)\/read$/,
      );
      if (readNotice && req.method === "POST") {
        send(res, 200, s.markRead(actor, readNotice[1]));
        return true;
      }
      reject("SDB_ROUTE_NOT_FOUND", 404);
    } catch (e) {
      send(res, e.status || 503, {
        error: e.code || "SDB_SERVICE_UNAVAILABLE",
      });
      return true;
    }
  };
}
