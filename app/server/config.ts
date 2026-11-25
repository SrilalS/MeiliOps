// Hosted-mode configuration, read once from the environment.
//
//   MEILIOPS_SERVER_<ID>_URL    required, e.g. http://meilisearch.search.svc:7700
//   MEILIOPS_SERVER_<ID>_KEY    optional API key (master or admin key), never sent to the browser
//   MEILIOPS_SERVER_<ID>_NAME   optional display name (default: the ID)
//   MEILIOPS_SERVER_<ID>_COLOR  optional dot color, e.g. #ef4444
//   MEILIOPS_SERVERS            optional comma-separated IDs, to set the order
//   MEILIOPS_USER_HEADERS       request headers that carry the signed-in user, set by the SSO proxy
//                               (default: x-auth-request-email, x-forwarded-email, x-forwarded-user, x-ms-client-principal-name)
//   MEILIOPS_ALLOW_KEY_MANAGEMENT  "true" to proxy the /keys routes (they return API keys in plain text)
//   MEILIOPS_PUBLIC_PATH        serve under this path, e.g. /meiliops, when the ingress forwards the prefix
//   MEILIOPS_AUDIT              "writes" (default) or "all" (also searches and document reads; not monitoring polls)
//   PORT                        default 8080
//   MEILIOPS_STATIC_DIR         the built web app (default: ./public next to the server)
//
// Built-in sign-in (OpenID Connect, e.g. Microsoft Entra ID). Same shape as Temporal UI's TEMPORAL_AUTH_*:
//   MEILIOPS_AUTH_ENABLED         "true" to require sign-in
//   MEILIOPS_AUTH_ISSUER_URL      e.g. https://login.microsoftonline.com/<tenant-id>/v2.0
//   MEILIOPS_AUTH_PROVIDER_URL    where to read .well-known/openid-configuration (default: the issuer)
//   MEILIOPS_AUTH_CLIENT_ID       the app registration's client ID
//   MEILIOPS_AUTH_CLIENT_SECRET   its client secret
//   MEILIOPS_AUTH_CALLBACK_URL    e.g. https://admin.example.com/meiliops/auth/callback (register it on the app)
//   MEILIOPS_AUTH_SCOPES          default openid,profile,email
//   MEILIOPS_AUTH_ALLOWED_GROUPS  optional comma-separated group or app-role IDs; sign-in needs one of them
//   MEILIOPS_SESSION_SECRET       32+ characters, the same on every replica (signs the session cookie)
//   MEILIOPS_SESSION_HOURS        session length, default 8

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  key?: string;
  color: string;
}

export interface HostedConfig {
  servers: ServerConfig[];
  userHeaders: string[];
  port: number;
  /** Proxy the /keys routes. Off by default: they reveal API keys in plain text. */
  allowKeyManagement: boolean;
  /** "" or a path like "/meiliops" (no trailing slash). */
  publicPath: string;
  audit: "writes" | "all";
  auth?: AuthConfig;
}

export interface AuthConfig {
  issuer: string;
  providerUrl: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: URL;
  scopes: string[];
  allowedGroups: string[];
  sessionSecret: string;
  sessionHours: number;
}

const truthy = (v: string | undefined) => /^(1|true|yes)$/i.test(v ?? "");

function loadAuth(env: NodeJS.ProcessEnv, publicPath: string): AuthConfig | undefined {
  if (!truthy(env.MEILIOPS_AUTH_ENABLED)) return undefined;
  const need = (name: string) => {
    const v = env[name]?.trim();
    if (!v) throw new Error(`MEILIOPS_AUTH_ENABLED is on, but ${name} is not set`);
    return v;
  };
  const issuer = need("MEILIOPS_AUTH_ISSUER_URL").replace(/\/+$/, "");
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(need("MEILIOPS_AUTH_CALLBACK_URL"));
  } catch {
    throw new Error(`MEILIOPS_AUTH_CALLBACK_URL is not a URL: ${env.MEILIOPS_AUTH_CALLBACK_URL}`);
  }
  if (callbackUrl.pathname !== `${publicPath}/auth/callback`) {
    throw new Error(`MEILIOPS_AUTH_CALLBACK_URL must end in ${publicPath}/auth/callback (MEILIOPS_PUBLIC_PATH is "${publicPath}"): ${callbackUrl.href}`);
  }
  const sessionSecret = need("MEILIOPS_SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("MEILIOPS_SESSION_SECRET must be at least 32 characters");
  const sessionHours = Number(env.MEILIOPS_SESSION_HOURS ?? 8);
  if (!(sessionHours > 0 && sessionHours <= 24 * 7)) throw new Error(`MEILIOPS_SESSION_HOURS must be between 0 and 168: ${env.MEILIOPS_SESSION_HOURS}`);
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const scopes = list(env.MEILIOPS_AUTH_SCOPES ?? "openid,profile,email");
  if (!scopes.includes("openid")) scopes.unshift("openid");
  return {
    issuer,
    providerUrl: (env.MEILIOPS_AUTH_PROVIDER_URL?.trim() || issuer).replace(/\/+$/, ""),
    clientId: need("MEILIOPS_AUTH_CLIENT_ID"),
    clientSecret: need("MEILIOPS_AUTH_CLIENT_SECRET"),
    callbackUrl,
    scopes,
    allowedGroups: list(env.MEILIOPS_AUTH_ALLOWED_GROUPS),
    sessionSecret,
    sessionHours,
  };
}

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#ec4899"];
const DEFAULT_USER_HEADERS = ["x-auth-request-email", "x-forwarded-email", "x-forwarded-user", "x-ms-client-principal-name"];

export function loadConfig(env: NodeJS.ProcessEnv): HostedConfig {
  const found = Object.keys(env)
    .map((k) => /^MEILIOPS_SERVER_([A-Z0-9_]+)_URL$/.exec(k)?.[1])
    .filter((id): id is string => !!id);
  const order = [
    ...new Set(
      (env.MEILIOPS_SERVERS ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase().replace(/-/g, "_"))
        .filter(Boolean),
    ),
  ];
  for (const id of order) if (!found.includes(id)) throw new Error(`MEILIOPS_SERVERS lists ${id}, but MEILIOPS_SERVER_${id}_URL is not set`);
  const ids = [...order, ...found.filter((id) => !order.includes(id)).sort()];
  if (!ids.length) throw new Error("No Meilisearch servers configured: set MEILIOPS_SERVER_<ID>_URL (and _KEY)");

  const servers = ids.map((id, i): ServerConfig => {
    const raw = env[`MEILIOPS_SERVER_${id}_URL`]!.trim().replace(/\/+$/, "");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`MEILIOPS_SERVER_${id}_URL is not a URL: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`MEILIOPS_SERVER_${id}_URL must be http(s): ${raw}`);
    return {
      id: id.toLowerCase().replace(/_/g, "-"),
      name: env[`MEILIOPS_SERVER_${id}_NAME`]?.trim() || id.toLowerCase().replace(/_/g, "-"),
      url: raw,
      key: env[`MEILIOPS_SERVER_${id}_KEY`] || undefined,
      color: env[`MEILIOPS_SERVER_${id}_COLOR`]?.trim() || PALETTE[i % PALETTE.length],
    };
  });

  const userHeaders = (env.MEILIOPS_USER_HEADERS ?? DEFAULT_USER_HEADERS.join(","))
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`PORT is not a valid port: ${env.PORT}`);
  const allowKeyManagement = truthy(env.MEILIOPS_ALLOW_KEY_MANAGEMENT);

  const rawPath = (env.MEILIOPS_PUBLIC_PATH ?? "").trim().replace(/\/+$/, "");
  if (rawPath && !/^(\/[A-Za-z0-9._~-]+)+$/.test(rawPath)) throw new Error(`MEILIOPS_PUBLIC_PATH must look like /meiliops: ${env.MEILIOPS_PUBLIC_PATH}`);
  const publicPath = rawPath;

  const audit = (env.MEILIOPS_AUDIT ?? "writes").trim().toLowerCase();
  if (audit !== "writes" && audit !== "all") throw new Error(`MEILIOPS_AUDIT must be "writes" or "all": ${env.MEILIOPS_AUDIT}`);

  return { servers, userHeaders, port, allowKeyManagement, publicPath, audit, auth: loadAuth(env, publicPath) };
}
