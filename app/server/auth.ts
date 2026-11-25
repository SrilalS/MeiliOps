// Built-in sign-in: OpenID Connect authorization-code flow with PKCE, tested
// against Microsoft Entra ID. No dependencies: discovery and the token call use
// fetch, ID tokens are checked with node:crypto against the provider's JWKS, and
// the session is a stateless cookie signed with MEILIOPS_SESSION_SECRET (so any
// replica can read it). Access and refresh tokens are not kept: MeiliOps only
// needs to know who the user is.
import { JsonWebKeyInput, KeyObject, createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthConfig } from "./config.js";

export interface User {
  /** Stable ID: Entra's object ID (oid), else the token subject. */
  id: string;
  /** For people: preferred_username / email / name. */
  name: string;
}

interface Session extends User {
  exp: number;
}

interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const SESSION_COOKIE = "meiliops_session";
const LOGIN_COOKIE = "meiliops_login";
const LOGIN_MINUTES = 10;
const CLOCK_SKEW_S = 120;

const b64url = (b: Buffer) => b.toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

export class Auth {
  private discovery?: Promise<Discovery>;
  private keys = new Map<string, KeyObject>();
  private keysFetchedAt = 0;
  private readonly cookieBase: string;

  constructor(
    private readonly cfg: AuthConfig,
    private readonly publicPath: string,
  ) {
    const secure = cfg.callbackUrl.protocol === "https:" ? "; Secure" : "";
    this.cookieBase = `; Path=${publicPath || "/"}; HttpOnly; SameSite=Lax${secure}`;
  }

  // ---------- signed cookies ----------

  private sign(payload: object): string {
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    return `${body}.${b64url(createHmac("sha256", this.cfg.sessionSecret).update(body).digest())}`;
  }

  private unsign<T extends { exp: number }>(token: string | undefined): T | undefined {
    if (!token) return undefined;
    const [body, mac] = token.split(".");
    if (!body || !mac) return undefined;
    const expected = createHmac("sha256", this.cfg.sessionSecret).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
      return typeof payload.exp === "number" && payload.exp > now() ? payload : undefined;
    } catch {
      return undefined;
    }
  }

  private cookie(req: IncomingMessage, name: string): string | undefined {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return undefined;
  }

  private setCookie(name: string, value: string, maxAge: number) {
    return `${name}=${value}${this.cookieBase}; Max-Age=${maxAge}`;
  }

  /** The signed-in user, or undefined. */
  user(req: IncomingMessage): User | undefined {
    const s = this.unsign<Session>(this.cookie(req, SESSION_COOKIE));
    return s ? { id: s.id, name: s.name } : undefined;
  }

  // ---------- provider metadata ----------

  private getDiscovery(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const res = await fetch(`${this.cfg.providerUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`OpenID configuration: HTTP ${res.status}`);
      const d = (await res.json()) as Discovery;
      for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const) if (typeof d[k] !== "string") throw new Error(`OpenID configuration has no ${k}`);
      return d;
    })().catch((e) => {
      this.discovery = undefined; // retry on the next sign-in
      throw e;
    });
    return this.discovery;
  }

  private async key(kid: string): Promise<KeyObject | undefined> {
    // Providers rotate signing keys: refetch on an unknown kid, at most once a minute.
    if (!this.keys.has(kid) && Date.now() - this.keysFetchedAt > 60_000) {
      this.keysFetchedAt = Date.now();
      const res = await fetch((await this.getDiscovery()).jwks_uri, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`JWKS: HTTP ${res.status}`);
      const { keys } = (await res.json()) as { keys: (JsonWebKeyInput["key"] & { kid?: string; kty?: string; use?: string })[] };
      this.keys = new Map(keys.filter((k) => k.kid && k.kty === "RSA" && (!k.use || k.use === "sig")).map((k) => [k.kid!, createPublicKey({ key: k, format: "jwk" })]));
    }
    return this.keys.get(kid);
  }

  /** Verifies an ID token's signature and standard claims; returns its claims. */
  private async verifyIdToken(token: string, nonce: string): Promise<Record<string, unknown>> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed ID token");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) throw new Error(`Unsupported ID token algorithm ${header.alg}`);
    const key = await this.key(header.kid);
    if (!key) throw new Error("ID token signed with an unknown key");
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) throw new Error("ID token signature is invalid");

    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const t = now();
    if (c.iss !== this.cfg.issuer) throw new Error(`ID token issuer ${String(c.iss)} is not ${this.cfg.issuer}`);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(this.cfg.clientId)) throw new Error("ID token is for another application");
    if (aud.length > 1 && c.azp !== this.cfg.clientId) throw new Error("ID token azp is not this application");
    if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_S < t) throw new Error("ID token has expired");
    if (typeof c.nbf === "number" && c.nbf - CLOCK_SKEW_S > t) throw new Error("ID token is not valid yet");
    if (c.nonce !== nonce) throw new Error("ID token nonce does not match");
    return c;
  }

  // ---------- routes ----------

  /** Starts sign-in: redirect to the provider. `returnTo` is a path under the public path. */
  async login(res: ServerResponse, returnTo: string) {
    const d = await this.getDiscovery();
    const login: LoginState = {
      state: b64url(randomBytes(24)),
      nonce: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
      returnTo: this.safeReturn(returnTo),
      exp: now() + LOGIN_MINUTES * 60,
    };
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.callbackUrl.href,
      scope: this.cfg.scopes.join(" "),
      state: login.state,
      nonce: login.nonce,
      code_challenge: b64url(createHash("sha256").update(login.verifier).digest()),
      code_challenge_method: "S256",
    }).toString();
    res.writeHead(302, { location: url.href, "set-cookie": this.setCookie(LOGIN_COOKIE, this.sign(login), LOGIN_MINUTES * 60), "cache-control": "no-store" });
    res.end();
  }

  /** The provider's redirect back: exchange the code, check the ID token, start a session. Returns the user, or throws. */
  async callback(req: IncomingMessage, res: ServerResponse, params: URLSearchParams): Promise<User> {
    const login = this.unsign<LoginState>(this.cookie(req, LOGIN_COOKIE));
    if (params.get("error")) throw new SignInError(`The sign-in provider returned ${params.get("error")}: ${params.get("error_description") ?? ""}`);
    if (!login) throw new SignInError("The sign-in attempt expired or was started in another browser. Try again.");
    const state = params.get("state") ?? "";
    if (state.length !== login.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(login.state))) throw new SignInError("The sign-in response doesn't match this browser's sign-in attempt. Try again.");
    const code = params.get("code");
    if (!code) throw new SignInError("The sign-in response has no authorization code.");

    const d = await this.getDiscovery();
    const tokenRes = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.callbackUrl.href,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code_verifier: login.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!tokenRes.ok || !tokens.id_token) throw new SignInError(`The token request failed: ${tokens.error ?? `HTTP ${tokenRes.status}`} ${tokens.error_description ?? ""}`.trim());

    let claims: Record<string, unknown>;
    try {
      claims = await this.verifyIdToken(tokens.id_token, login.nonce);
    } catch (e) {
      // The user gets a generic message; the reason goes to the log.
      throw new SignInError("MeiliOps couldn't verify your sign-in. Try again, and tell your administrator if it keeps happening.", 401, (e as Error).message);
    }
    this.checkAllowed(claims);
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const user: User = {
      id: str(claims.oid) ?? str(claims.sub) ?? "unknown",
      name: str(claims.preferred_username) ?? str(claims.email) ?? str(claims.name) ?? str(claims.sub) ?? "unknown",
    };
    const session: Session = { ...user, exp: now() + Math.round(this.cfg.sessionHours * 3600) };
    res.writeHead(302, {
      location: login.returnTo,
      "set-cookie": [this.setCookie(SESSION_COOKIE, this.sign(session), Math.round(this.cfg.sessionHours * 3600)), this.setCookie(LOGIN_COOKIE, "", 0)],
      "cache-control": "no-store",
    });
    res.end();
    return user;
  }

  /** Ends the MeiliOps session (not the provider's own sign-in). */
  logout(res: ServerResponse) {
    res.writeHead(302, { location: `${this.publicPath}/auth/signed-out`, "set-cookie": this.setCookie(SESSION_COOKIE, "", 0), "cache-control": "no-store" });
    res.end();
  }

  /** Group / app-role check. Entra puts group IDs in `groups` and app roles in `roles`. */
  private checkAllowed(c: Record<string, unknown>) {
    if (!this.cfg.allowedGroups.length) return;
    const has = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const mine = [...has(c.groups), ...has(c.roles)];
    if (mine.some((g) => this.cfg.allowedGroups.includes(g))) return;
    const overage = typeof c._claim_names === "object" && c._claim_names !== null && "groups" in c._claim_names;
    throw new SignInError(
      overage
        ? "Your account is in too many groups for them to fit in the sign-in token. Ask your administrator to set the app registration to emit only the groups assigned to the application, or to use app roles."
        : "Your account isn't in a group that may use MeiliOps. Ask your administrator for access.",
      403,
    );
  }

  /** Only same-app paths, so the post-login redirect can't be turned into an open redirect. */
  private safeReturn(path: string): string {
    const home = `${this.publicPath}/`;
    if (!path.startsWith(home) || path.startsWith("//") || path.includes("\\") || path.startsWith(`${this.publicPath}/auth/`)) return home;
    return path;
  }
}

/** A sign-in failure worth showing the user (not a server bug). */
export class SignInError extends Error {
  constructor(
    message: string,
    public status = 400,
    /** Why, for the log only (not shown to the user). */
    public detail?: string,
  ) {
    super(message);
  }
}
