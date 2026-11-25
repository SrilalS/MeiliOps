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
//   PORT                        default 8080
//   MEILIOPS_STATIC_DIR         the built web app (default: ./public next to the server)

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
  const allowKeyManagement = /^(1|true|yes)$/i.test(env.MEILIOPS_ALLOW_KEY_MANAGEMENT ?? "");
  return { servers, userHeaders, port, allowKeyManagement };
}
