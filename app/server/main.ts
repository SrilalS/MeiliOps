// MeiliOps hosted mode: serves the web build and proxies API calls to the
// configured Meilisearch servers, adding their API keys server-side so keys
// never reach the browser. Users sign in either here (built-in OpenID Connect,
// MEILIOPS_AUTH_*) or in an SSO proxy in front of it, whose user headers are
// then trusted. Every change (and, optionally, every read) is audit-logged.
//
// Routes (under MEILIOPS_PUBLIC_PATH when set):
//   GET  /healthz                     liveness/readiness (also at the root, for probes)
//   GET  /auth/login|callback|logout  built-in sign-in
//   GET  /api/config                  servers (id, name, color; no URLs or keys), the signed-in user,
//                                     and whether the key routes are allowed
//   *    /api/servers/<id>/<path>     proxied to <server url>/<path>
//   GET  everything else              the web app (SPA fallback to index.html)
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { IncomingMessage, OutgoingHttpHeaders, ServerResponse, createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Auth, SignInError } from "./auth.js";
import { ServerConfig, loadConfig } from "./config.js";

const cfg = loadConfig(process.env);
const auth = cfg.auth ? new Auth(cfg.auth, cfg.publicPath) : undefined;
const servers = new Map(cfg.servers.map((s) => [s.id, s]));
const staticDir = resolve(process.env.MEILIOPS_STATIC_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "public"));
const indexHtml = join(staticDir, "index.html");
if (!existsSync(indexHtml)) throw new Error(`No web build at ${staticDir} (set MEILIOPS_STATIC_DIR)`);

// CSP: allow index.html's inline scripts (theme before first paint) by hash, nothing else inline.
const inlineScriptHashes = [...readFileSync(indexHtml, "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
);
const SECURITY_HEADERS: OutgoingHttpHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

// Request headers passed on to Meilisearch. Everything else (cookies, the SSO
// proxy's headers, any Authorization the browser sends) stays here.
const FORWARD_REQUEST = new Set(["content-type", "content-length", "content-encoding", "accept", "last-event-id"]);
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "set-cookie", "access-control-allow-origin", "access-control-allow-credentials", "access-control-expose-headers"]);
const EXPORT_BODY_LIMIT = 1 << 20;
/** Routes that answer with a long-lived stream (SSE / chunked logs). */
const STREAMING = /(\/stream|\/chat\/completions|^\/mcp)$/;
/** POST routes that only read data (searches, document fetches); audited as reads. */
const READ_POSTS = /(\/search|\/documents\/fetch|\/facet-search|\/similar|\/fields|^\/multi-search|^\/render-template|\/chat\/completions|^\/mcp|^\/dynamic-search-rules)$/;
/** Reads that return indexed data (documents, hits, task payloads), audited with MEILIOPS_AUDIT=all. */
const DATA_READS = /(\/documents(\/.*)?|\/search|\/facet-search|\/similar|^\/multi-search|\/chat\/completions|^\/tasks\/\d+\/documents|^\/mcp)$/;

/**
 * Who is making the request. With built-in sign-in, the session; otherwise the
 * headers an SSO proxy in front of MeiliOps sets (trusted only behind that proxy).
 */
const user = (req: IncomingMessage): string | undefined => {
  if (auth) {
    const u = auth.user(req);
    return u && (u.name === u.id ? u.id : `${u.name} (${u.id})`);
  }
  for (const h of cfg.userHeaders) {
    const v = req.headers[h];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
};

/** A small standalone page (sign-in errors, signed out). */
function page(res: ServerResponse, status: number, title: string, message: string, link?: { href: string; text: string }) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MeiliOps</title>` +
      `<style>body{font:15px/1.5 system-ui,sans-serif;background:#16002f;color:#f1ecff;display:grid;place-items:center;min-height:100vh;margin:0}` +
      `main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.3rem}a{color:#ff5caa}p{color:#c9bde6}</style></head>` +
      `<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${link ? `<p><a href="${esc(link.href)}">${esc(link.text)}</a></p>` : ""}</main></body></html>`,
  );
}

function audit(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: OutgoingHttpHeaders = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

/** Meilisearch-shaped error, so the app shows it like any API error. */
const apiError = (res: ServerResponse, status: number, code: string, message: string) => sendJson(res, status, { message, code, type: "meiliops", link: null });

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== "GET" && req.method !== "HEAD") return apiError(res, 405, "method_not_allowed", "Method not allowed");
  const decoded = safeDecode(pathname);
  if (decoded === undefined || decoded.includes("\0")) return apiError(res, 400, "meiliops_bad_request", "Bad request");
  let file = resolve(staticDir, "." + decoded);
  if (file !== staticDir && !file.startsWith(staticDir + sep)) return apiError(res, 404, "not_found", "Not found");
  let isFile = existsSync(file) && statSync(file).isFile();
  // Client-side routes have no extension: serve the app.
  if (!isFile && !extname(file)) {
    file = indexHtml;
    isFile = true;
  }
  if (!isFile) return apiError(res, 404, "not_found", "Not found");
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": statSync(file).size,
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

/**
 * POST /export pushes documents to another Meilisearch. The browser has no keys,
 * so it names a configured server as `meiliops:<id>`; this fills in its URL and key.
 */
function rewriteExport(body: Buffer): Buffer | string {
  let parsed: { url?: unknown; apiKey?: unknown };
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (typeof parsed.url !== "string" || !parsed.url.startsWith("meiliops:")) return body;
  const dest = servers.get(parsed.url.slice("meiliops:".length));
  if (!dest) return `Unknown export destination ${parsed.url}`;
  parsed.url = dest.url;
  parsed.apiKey = dest.key ?? null;
  return Buffer.from(JSON.stringify(parsed));
}

async function proxy(req: IncomingMessage, res: ServerResponse, srv: ServerConfig, rest: string, search: string) {
  const started = Date.now();
  const isRead = req.method === "GET" || req.method === "HEAD" || (req.method === "POST" && READ_POSTS.test(rest));
  // "all" adds reads of data (documents, search results), not the polling of tasks, stats or
  // settings, which would log a line every few seconds per open screen.
  const audited = !isRead || (cfg.audit === "all" && DATA_READS.test(rest));
  const log = (status: number | undefined, extra: Record<string, unknown> = {}) =>
    audit({ user: user(req) ?? null, server: srv.id, kind: isRead ? "read" : "write", method: req.method, path: rest + search, status, ms: Date.now() - started, ...extra });
  const refuse = (status: number, code: string, message: string) => {
    log(status, { refused: code });
    apiError(res, status, code, message);
  };

  // CSRF: the app sends this header on every API call. Cross-site pages can't
  // without a CORS preflight, which this server never approves.
  const site = req.headers["sec-fetch-site"];
  if (req.headers["x-meiliops"] !== "1" || (site && site !== "same-origin" && site !== "none")) {
    return refuse(403, "meiliops_forbidden", "Cross-site API requests are not allowed");
  }
  // The key routes return API keys in plain text. Anyone who reads one can use it
  // without SSO and keeps it after leaving, so they're off unless enabled.
  if (!cfg.allowKeyManagement && (rest === "/keys" || rest.startsWith("/keys/"))) {
    return refuse(403, "meiliops_keys_disabled", "API key management is turned off on this MeiliOps server (MEILIOPS_ALLOW_KEY_MANAGEMENT).");
  }

  // Streams must arrive uncompressed: Meilisearch's compressor holds small chunks back.
  // Everything else may be compressed between Meilisearch and the browser.
  const headers: OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && (FORWARD_REQUEST.has(k) || k.startsWith("meili-"))) headers[k] = v;
  headers["accept-encoding"] = STREAMING.test(rest) ? "identity" : (req.headers["accept-encoding"] ?? "identity");
  if (srv.key) headers.authorization = `Bearer ${srv.key}`;

  let body: Buffer | undefined;
  if (req.method === "POST" && rest === "/export") {
    try {
      const rewritten = rewriteExport(await readBody(req, EXPORT_BODY_LIMIT));
      if (typeof rewritten === "string") return refuse(400, "meiliops_bad_export", rewritten);
      body = rewritten;
      headers["content-length"] = body.length;
    } catch (e) {
      return refuse(413, "meiliops_body_too_large", (e as Error).message);
    }
  }

  const target = new URL(srv.url + rest + search);
  const up = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method: req.method, headers }, (ur) => {
    const out: OutgoingHttpHeaders = { "cache-control": "no-store" };
    for (const [k, v] of Object.entries(ur.headers)) if (v !== undefined && !DROP_RESPONSE.has(k)) out[k] = v;
    res.writeHead(ur.statusCode ?? 502, out);
    // Node holds headers back until the first body chunk; a quiet stream would never open.
    res.flushHeaders();
    ur.pipe(res);
    if (audited) log(ur.statusCode);
  });
  up.on("error", (e) => {
    if (audited) log(502, { error: e.message });
    if (res.headersSent) return res.destroy();
    // The header tells the app to treat this like a network failure (reconnect banner), not an API error.
    sendJson(res, 502, { message: `MeiliOps couldn't reach ${srv.name}: ${e.message}`, code: "meiliops_upstream_unreachable", type: "meiliops", link: null }, { "x-meiliops-upstream": "unreachable" });
  });
  // The browser went away (e.g. left a live stream): stop the upstream request too.
  res.on("close", () => up.destroy());
  if (body) up.end(body);
  else req.pipe(up);
}

/** decodeURIComponent that returns undefined on a malformed escape instead of throwing. */
function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const base = cfg.publicPath;
  // Probes hit the pod directly, without the public path.
  if (url.pathname === "/healthz" || url.pathname === `${base}/healthz`) return sendJson(res, 200, { status: "ok" });

  // Served under a path the ingress forwards as-is (no rewrite), like Temporal UI's /temporal.
  if (base) {
    if (url.pathname === base) {
      res.writeHead(308, { location: `${base}/${url.search}` });
      return res.end();
    }
    if (!url.pathname.startsWith(`${base}/`)) return apiError(res, 404, "not_found", "Not found");
  }
  const path = url.pathname.slice(base.length);

  if (auth) {
    try {
      if (path === "/auth/login") return await auth.login(res, url.searchParams.get("returnTo") ?? `${base}/`);
      if (path === "/auth/callback") {
        const u = await auth.callback(req, res, url.searchParams);
        return audit({ user: u.name === u.id ? u.id : `${u.name} (${u.id})`, event: "sign-in" });
      }
    } catch (e) {
      const known = e instanceof SignInError;
      if (known) audit({ user: null, event: "sign-in refused", reason: e.detail ?? e.message });
      else {
        // fetch() reports only "fetch failed"; the cause says why (DNS, refused, TLS, timeout).
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        console.error(JSON.stringify({ time: new Date().toISOString(), msg: "sign-in failed", error: (e as Error).message, cause: cause?.code ?? cause?.message }));
      }
      return page(res, known ? e.status : 502, "Couldn't sign you in", known ? e.message : "The sign-in provider couldn't be reached. Try again in a moment.", {
        href: `${base}/auth/login`,
        text: "Try again",
      });
    }
    if (path === "/auth/logout") {
      if (auth.user(req)) audit({ user: user(req) ?? null, event: "sign-out" });
      return auth.logout(res);
    }
    if (path === "/auth/signed-out") return page(res, 200, "You're signed out of MeiliOps", "Your organization's sign-in may still be active in this browser.", { href: `${base}/auth/login`, text: "Sign in again" });

    // Everything else needs a session.
    if (!auth.user(req)) {
      if (path.startsWith("/api/")) {
        return sendJson(res, 401, { message: "Your MeiliOps session has ended. Sign in again.", code: "meiliops_login_required", type: "meiliops", link: null }, { "x-meiliops-auth": "login" });
      }
      res.writeHead(302, { location: `${base}/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" });
      return res.end();
    }
  }

  if (path === "/api/config") {
    if (req.method !== "GET") return apiError(res, 405, "method_not_allowed", "Method not allowed");
    return sendJson(res, 200, {
      servers: cfg.servers.map(({ id, name, color }) => ({ id, name, color })),
      user: (auth ? auth.user(req)?.name : user(req)) ?? null,
      signOut: !!auth,
      keyManagement: cfg.allowKeyManagement,
    });
  }
  const m = /^\/api\/servers\/([^/]+)(\/.*)?$/.exec(path);
  if (m) {
    const id = safeDecode(m[1]);
    const srv = id === undefined ? undefined : servers.get(id);
    if (!srv) return apiError(res, 404, "meiliops_unknown_server", `No server ${m[1]} is configured`);
    return void proxy(req, res, srv, m[2] ?? "/", url.search).catch((e) => {
      if (!res.headersSent) apiError(res, 500, "meiliops_internal", (e as Error).message);
      else res.destroy();
    });
  }
  if (path.startsWith("/api/")) return apiError(res, 404, "not_found", "Not found");
  serveStatic(req, res, path);
}

const server = createServer((req, res) => {
  // Never let one bad request take the process (and every user's session) down.
  handle(req, res).catch((e) => {
    console.error(JSON.stringify({ time: new Date().toISOString(), msg: "request failed", url: req.url, error: (e as Error).message }));
    if (!res.headersSent) apiError(res, 400, "meiliops_bad_request", "Bad request");
    else res.destroy();
  });
});

// Streams (logs, tasks) stay open for a long time: no request timeout.
server.requestTimeout = 0;
server.listen(cfg.port, () => {
  console.log(
    JSON.stringify({
      time: new Date().toISOString(),
      msg: `MeiliOps listening on :${cfg.port}`,
      servers: cfg.servers.map((s) => ({ id: s.id, name: s.name, url: s.url, key: s.key ? "set" : "none" })),
      keyManagement: cfg.allowKeyManagement,
      publicPath: cfg.publicPath || "/",
      auth: cfg.auth ? { issuer: cfg.auth.issuer, clientId: cfg.auth.clientId, callback: cfg.auth.callbackUrl.href, allowedGroups: cfg.auth.allowedGroups.length } : "off (trusting SSO proxy headers)",
      audit: cfg.audit,
    }),
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
