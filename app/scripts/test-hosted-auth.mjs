// End-to-end checks of hosted MeiliOps' built-in sign-in against scripts/mock-oidc.mjs:
// routing under the public path, the sign-in flow, refused and forged tokens, session
// tampering, code replay, state mismatch, open redirects and sign-out.
// Setup: docs/guide/hosted.md, "Sign-in, with a mock provider".
//   node scripts/test-hosted-auth.mjs   (APP=http://localhost:8090, public path /meiliops)
const APP = process.env.APP ?? "http://localhost:8090";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
};

const cookiesFrom = (res, jar) => {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i), v = pair.slice(i + 1);
    if (v === "" || /Max-Age=0/.test(c)) jar.delete(k);
    else jar.set(k, v);
  }
};
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const get = async (url, jar, headers = {}) => {
  const res = await fetch(url, { redirect: "manual", headers: { cookie: cookieHeader(jar), ...headers } });
  cookiesFrom(res, jar);
  return res;
};

/** Runs the sign-in for a test user; returns the callback response and the jar. */
async function signIn(user, returnTo) {
  const jar = new Map();
  const login = await get(`${APP}/meiliops/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, jar);
  const authorize = new URL(login.headers.get("location"));
  authorize.searchParams.set("test_user", user);
  const back = await get(authorize.href, jar);
  const cb = await get(back.headers.get("location"), jar);
  return { cb, jar, callbackUrl: back.headers.get("location") };
}

// Routing and gating
let r = await get(`${APP}/healthz`, new Map());
check("healthz at root, no session", r.status === 200, r.status);
r = await get(`${APP}/meiliops`, new Map());
check("/meiliops redirects to /meiliops/", r.status === 308 && r.headers.get("location") === "/meiliops/", `${r.status} ${r.headers.get("location")}`);
r = await get(`${APP}/elsewhere`, new Map());
check("path outside public path is 404", r.status === 404, r.status);
r = await get(`${APP}/meiliops/`, new Map());
check("page without session redirects to login", r.status === 302 && r.headers.get("location").startsWith("/meiliops/auth/login?returnTo="), `${r.status} ${r.headers.get("location")}`);
r = await get(`${APP}/meiliops/api/config`, new Map());
check("API without session is 401 + x-meiliops-auth", r.status === 401 && r.headers.get("x-meiliops-auth") === "login", r.status);
r = await get(`${APP}/meiliops/assets/x.js`, new Map());
check("assets need a session too", r.status === 302, r.status);

// Happy path
const alice = await signIn("alice", "/meiliops/?x=1");
check("alice: callback redirects back to returnTo", alice.cb.status === 302 && alice.cb.headers.get("location") === "/meiliops/?x=1", `${alice.cb.status} ${alice.cb.headers.get("location")}`);
check("alice: session cookie set, login cookie cleared", alice.jar.has("meiliops_session") && !alice.jar.has("meiliops_login"), [...alice.jar.keys()].join(","));
const setCookie = alice.cb.headers.getSetCookie().find((c) => c.startsWith("meiliops_session="));
check("session cookie is HttpOnly, SameSite=Lax, Path=/meiliops", /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Path=\/meiliops/.test(setCookie), setCookie);
r = await get(`${APP}/meiliops/api/config`, alice.jar);
const cfg = await r.json();
check("alice: /api/config shows the user and sign-out", r.status === 200 && cfg.user === "alice@example.com" && cfg.signOut === true, JSON.stringify(cfg));
r = await get(`${APP}/meiliops/api/servers/${encodeURIComponent(cfg.servers[0].id)}/version`, alice.jar, { "x-meiliops": "1" });
check("alice: proxied API works", r.status === 200 && typeof (await r.json()).pkgVersion === "string", r.status);
r = await get(`${APP}/meiliops/`, alice.jar);
check("alice: app page served", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/html"), r.status);

// Session integrity
const forgedJar = new Map(alice.jar);
const [body, mac] = forgedJar.get("meiliops_session").split(".");
const evilBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), name: "ceo@example.com" })).toString("base64url");
forgedJar.set("meiliops_session", `${evilBody}.${mac}`);
r = await get(`${APP}/meiliops/api/config`, forgedJar);
check("edited session cookie is rejected", r.status === 401, r.status);

// Refusals
for (const [user, expect, text] of [
  ["bob", 403, "in a group that may use MeiliOps"],
  ["overage", 403, "too many groups"],
  ["forged", 401, "verify your sign-in"],
  ["expired", 401, "verify your sign-in"],
  ["wrongaud", 401, "verify your sign-in"],
  ["badnonce", 401, "verify your sign-in"],
  ["wrongiss", 401, "verify your sign-in"],
]) {
  const s = await signIn(user);
  const html = await s.cb.text();
  check(`${user}: refused (${expect}), no session`, s.cb.status === expect && !s.jar.has("meiliops_session") && (!text || html.includes(text)), `${s.cb.status} ${html.slice(0, 120)}`);
}

// Replay and CSRF on the callback
const again = await signIn("alice");
r = await get(again.callbackUrl, again.jar);
check("authorization code can't be replayed", r.status !== 302 || !r.headers.get("location")?.startsWith("/meiliops/?"), r.status);
const other = await signIn("alice");
const otherCb = new URL(other.callbackUrl);
otherCb.searchParams.set("state", "x".repeat(otherCb.searchParams.get("state").length));
const freshJar = new Map();
await get(`${APP}/meiliops/auth/login`, freshJar);
r = await get(otherCb.href, freshJar);
check("callback with a state from another attempt is refused", r.status === 400 && !freshJar.has("meiliops_session"), r.status);
r = await get(`${APP}/meiliops/auth/callback?code=x&state=y`, new Map());
check("callback without a login cookie is refused", r.status === 400, r.status);

// Open redirect
const open = await signIn("alice", "//evil.example/");
check("returnTo //evil.example falls back to /meiliops/", open.cb.headers.get("location") === "/meiliops/", open.cb.headers.get("location"));
const abs = await signIn("alice", "https://evil.example/");
check("absolute returnTo falls back to /meiliops/", abs.cb.headers.get("location") === "/meiliops/", abs.cb.headers.get("location"));

// Sign out
r = await get(`${APP}/meiliops/auth/logout`, alice.jar);
check("logout clears the session", r.status === 302 && !alice.jar.has("meiliops_session"), r.status);
r = await get(`${APP}/meiliops/api/config`, alice.jar);
check("after logout the API is 401", r.status === 401, r.status);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
