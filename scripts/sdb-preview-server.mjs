import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { MoeiPocAuth } from "../ai-proxy/moei-poc-auth.mjs";
import { SeafarerWorkspace } from "../ai-proxy/seafarer-workspace.mjs";
import { createSeafarerHandler } from "../ai-proxy/seafarer-http.mjs";
// CI-only fixture server; never included in the runtime image or Nginx assets.
const folder = fileURLToPath(
  new URL("../dist/oman-development-screens/browser", import.meta.url),
);
const auth = new MoeiPocAuth({
  username: "tester",
  password: "seafarer-test-only-2026",
});
const workspace = new SeafarerWorkspace({ file: null });
const handler = createSeafarerHandler({ auth, workspace });
const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
createServer(async (req, res) => {
  if (await handler(req, res)) return;
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/moei/auth/providers")
    return send(res, 200, { mode: "local", googleConfigured: false });
  if (url.pathname === "/api/moei/auth/login" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const d = JSON.parse(raw),
        s = auth.authenticate(d.username, d.password);
      res.setHeader("Set-Cookie", auth.cookie(req, s.token));
      return send(res, 200, { status: "ok", user: s.user });
    } catch {
      return send(res, 401, { error: "TEST_LOGIN_FAILED" });
    }
  }
  if (url.pathname === "/api/moei/auth/session") {
    const user = auth.session(req);
    return send(
      res,
      user ? 200 : 401,
      user ? { status: "ok", user } : { error: "MOEI_LOGIN_REQUIRED" },
    );
  }
  if (url.pathname.startsWith("/api/"))
    return send(res, 200, {
      items: [],
      definitions: [],
      alerts: [],
      activeCount: 0,
      unreadCount: 0,
      dashboards: [],
    });
  let path = resolve(folder, "." + decodeURIComponent(url.pathname));
  if (!path.startsWith(folder)) return send(res, 403, {});
  if (!existsSync(path) || statSync(path).isDirectory())
    path = resolve(folder, "index.html");
  const mime = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
  res.writeHead(200, {
    "Content-Type": mime[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
}).listen(4175, "127.0.0.1", () =>
  console.log("SDB isolated preview listening 4175"),
);
