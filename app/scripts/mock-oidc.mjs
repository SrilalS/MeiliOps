// TEST ONLY: an OpenID Connect provider shaped like Entra ID v2, for exercising hosted
// MeiliOps' sign-in locally (scripts/test-hosted-auth.mjs). Discovery, authorize (a page to
// pick a test user), token (auth code + PKCE + client secret), JWKS. Some test users get
// deliberately broken ID tokens. Never expose it: anyone can sign in as anyone.
//   node scripts/mock-oidc.mjs   (PORT, ISSUER, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 9099);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}/tenant-1/v2.0`;
const CLIENT_ID = process.env.CLIENT_ID ?? "meiliops-client";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "meiliops-secret";
const REDIRECT_URI = process.env.REDIRECT_URI ?? "http://localhost:8090/meiliops/auth/callback";
const base = new URL(ISSUER).origin + new URL(ISSUER).pathname;

const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const evil = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...good.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };

const USERS = {
  alice: { desc: "admin group member", groups: ["g-admins"] },
  bob: { desc: "not in an allowed group", groups: ["g-other"] },
  overage: { desc: "too many groups (Entra overage)", overage: true },
  forged: { desc: "token signed with the wrong key" },
  expired: { desc: "expired token" },
  wrongaud: { desc: "token for another app" },
  badnonce: { desc: "nonce mismatch" },
  wrongiss: { desc: "token from another issuer" },
};
const codes = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function idToken(user, nonce) {
  const t = Math.floor(Date.now() / 1000);
  const u = USERS[user];
  const claims = {
    iss: user === "wrongiss" ? "https://evil.example/v2.0" : ISSUER,
    aud: user === "wrongaud" ? "someone-else" : CLIENT_ID,
    sub: `sub-${user}`,
    oid: `oid-${user}`,
    tid: "tenant-1",
    name: user[0].toUpperCase() + user.slice(1),
    preferred_username: `${user}@example.com`,
    nonce: user === "badnonce" ? "nope" : nonce,
    iat: t,
    nbf: t,
    exp: user === "expired" ? t - 3600 : t + 3600,
    ...(u.overage ? { _claim_names: { groups: "src1" }, _claim_sources: { src1: { endpoint: "https://graph" } } } : { groups: u.groups ?? [] }),
  };
  const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const body = b64(claims);
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), user === "forged" ? evil.privateKey : good.privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const json = (res, status, o) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(o));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p === `${new URL(ISSUER).pathname}/.well-known/openid-configuration`) {
    return json(res, 200, { issuer: ISSUER, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/keys` });
  }
  if (p === `${new URL(ISSUER).pathname}/keys`) return json(res, 200, { keys: [jwk] });
  if (p === `${new URL(ISSUER).pathname}/authorize`) {
    const q = url.searchParams;
    if (q.get("client_id") !== CLIENT_ID || q.get("redirect_uri") !== REDIRECT_URI) return json(res, 400, { error: "invalid_client_or_redirect_uri" });
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return json(res, 400, { error: "pkce_required" });
    const user = q.get("test_user");
    if (!user) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        `<h1>Mock sign-in</h1><ul>` +
          Object.entries(USERS)
            .map(([k, v]) => { const u = new URL(url); u.searchParams.set("test_user", k); return `<li><a id="${k}" href="${u.pathname + u.search}">${k}</a>: ${v.desc}</li>`; })
            .join("") +
          `</ul>`,
      );
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, { user, nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirect: q.get("redirect_uri") });
    const back = new URL(REDIRECT_URI);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { location: back.href });
    return res.end();
  }
  if (p === `${new URL(ISSUER).pathname}/token` && req.method === "POST") {
    let raw = "";
    for await (const c of req) raw += c;
    const f = new URLSearchParams(raw);
    if (f.get("client_id") !== CLIENT_ID || f.get("client_secret") !== CLIENT_SECRET) return json(res, 401, { error: "invalid_client" });
    const c = codes.get(f.get("code"));
    codes.delete(f.get("code"));
    if (!c || f.get("redirect_uri") !== c.redirect) return json(res, 400, { error: "invalid_grant" });
    if (createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verifier mismatch" });
    return json(res, 200, { token_type: "Bearer", id_token: idToken(c.user, c.nonce), access_token: "unused", expires_in: 3600 });
  }
  json(res, 404, { error: "not_found" });
}).listen(PORT, () => console.log(`mock OIDC on ${ISSUER}`));
