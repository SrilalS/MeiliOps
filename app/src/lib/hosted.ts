// Hosted mode: the web build served by app/server (`npm run build:web`), usually
// behind an SSO proxy. The server owns the connections and their API keys; the
// browser only sees server IDs and talks to /api/servers/<id>/..., which the
// server forwards to Meilisearch with the key added.
export const hosted = import.meta.env.MODE === "hosted";

export interface HostedServer {
  id: string;
  name: string;
  color: string;
}

export interface HostedConfig {
  servers: HostedServer[];
  /** The signed-in user, as reported by the SSO proxy in front of MeiliOps. */
  user: string | null;
  /** The server proxies the /keys routes (MEILIOPS_ALLOW_KEY_MANAGEMENT). */
  keyManagement: boolean;
  /** The server signs users in itself (MEILIOPS_AUTH_*), so it can sign them out. */
  signOut: boolean;
}

/** The server's session ended: go through sign-in and come back to this page. */
export function signInAgain() {
  const url = new URL("auth/login", document.baseURI);
  url.searchParams.set("returnTo", location.pathname + location.search);
  location.assign(url.href);
}

export const signOut = () => location.assign(new URL("auth/logout", document.baseURI).href);

/** A response from the MeiliOps server saying the session has ended. */
export const isLoginRequired = (res: Response) => res.status === 401 && res.headers.get("x-meiliops-auth") === "login";

/** Resolved against the page, so MeiliOps also works under a sub-path the ingress strips. */
const apiUrl = (path: string) => new URL(path, document.baseURI).href;

export async function loadHostedConfig(): Promise<HostedConfig> {
  const res = await fetch(apiUrl("api/config"), { cache: "no-store" });
  if (isLoginRequired(res)) signInAgain();
  if (!res.ok) throw new Error(`Couldn't load the MeiliOps server configuration (HTTP ${res.status})`);
  return res.json();
}

/** Base URL of a configured server, for the Meili client. */
export const hostedServerUrl = (id: string) => apiUrl(`api/servers/${encodeURIComponent(id)}`);

/** Export destination understood by the server: it fills in that server's URL and key. */
export const hostedExportUrl = (id: string) => `meiliops:${id}`;
