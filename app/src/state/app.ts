import { batch, createSignal, createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { EnqueuedTask, Meili, Task, errorMessage, isNetworkError } from "../api/meili";
import { loadSetting, saveSetting, secrets } from "../lib/platform";

// ---------- types ----------

export interface Connection {
  id: string;
  name: string;
  url: string;
  color: string;
  hasKey: boolean;
}

export interface IndexInfo {
  uid: string;
  primaryKey: string | null;
  createdAt: string;
  updatedAt: string;
  numberOfDocuments?: number;
  isIndexing?: boolean;
}

export interface ServerInfo {
  version?: { pkgVersion: string; commitSha: string; commitDate: string };
  /** `lost`: was connected, the server stopped answering. Views stay mounted; a watchdog reconnects. */
  status: "idle" | "connecting" | "ready" | "error" | "lost";
  error?: string;
}

export type IndexTab = "documents" | "search" | "schema" | "settings" | "overview";

export type View =
  | { kind: "welcome" }
  | { kind: "connection-form"; id?: string }
  | { kind: "overview" }
  /** `filter` pre-fills the Documents tab (e.g. from the Schema tab). */
  | { kind: "index"; uid: string; tab: IndexTab; filter?: string }
  | { kind: "tasks" }
  | { kind: "batches" }
  | { kind: "keys" }
  | { kind: "webhooks" }
  | { kind: "experimental" }
  | { kind: "console" }
  | { kind: "multi-search" }
  | { kind: "logs" }
  | { kind: "metrics" }
  | { kind: "export" }
  | { kind: "chats" }
  | { kind: "search-rules" }
  | { kind: "instances" };

export interface Activity {
  id: number;
  label: string;
  taskUid?: number;
  status: "running" | "succeeded" | "failed" | "canceled";
  error?: string;
  at: number;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

// ---------- state ----------

const state = createRoot(() => {
  const [connections, setConnections] = createStore<Connection[]>([]);
  const [activeId, setActiveId] = createSignal<string>();
  const [client, setClient] = createSignal<Meili>();
  const [server, setServer] = createSignal<ServerInfo>({ status: "idle" });
  const [indexes, setIndexes] = createSignal<IndexInfo[]>([]);
  const [view, setView] = createSignal<View>({ kind: "welcome" });
  const [activity, setActivity] = createStore<Activity[]>([]);
  const [toasts, setToasts] = createStore<Toast[]>([]);
  return { connections, setConnections, activeId, setActiveId, client, setClient, server, setServer, indexes, setIndexes, view, setView, activity, setActivity, toasts, setToasts };
});

export const { connections, activeId, client, server, indexes, view, setView, activity, toasts } = state;

export const activeConnection = () => state.connections.find((c) => c.id === state.activeId());

/** Connected, possibly with the server temporarily unreachable. Views render in both states. */
export const connected = () => state.server().status === "ready" || state.server().status === "lost";
/** The server is answering: polling and streams should run. */
export const online = () => state.server().status === "ready";

/** Resolves true once the server is online (immediately if it is), false if `signal` aborts first. */
export async function whenOnline(signal?: AbortSignal): Promise<boolean> {
  while (!online()) {
    if (signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return !signal?.aborted;
}

/** The connected client. Views only render while connected, so this never throws in practice. */
export function api(): Meili {
  const c = state.client();
  if (!c) throw new Error("Not connected");
  return c;
}

// ---------- toasts ----------

let toastSeq = 0;
export function notify(kind: Toast["kind"], text: string, ms = kind === "error" ? 8000 : 3500) {
  // Identical toast already showing (e.g. a poller failing repeatedly): don't stack another.
  if (state.toasts.some((t) => t.kind === kind && t.text === text)) return;
  const id = ++toastSeq;
  state.setToasts((t) => [...t, { id, kind, text }]);
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number) {
  state.setToasts((t) => t.filter((x) => x.id !== id));
}
export function notifyError(e: unknown, prefix?: string) {
  // "Server unreachable" is shown once by the connection banner, not per failed request.
  if (isNetworkError(e) && state.server().status !== "ready") return;
  notify("error", prefix ? `${prefix}: ${errorMessage(e)}` : errorMessage(e));
}

// ---------- connections ----------

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16", "#ec4899"];

export async function loadConnections() {
  state.setConnections(await loadSetting<Connection[]>("connections", []));
}

async function persistConnections() {
  await saveSetting("connections", JSON.parse(JSON.stringify(state.connections)));
}

export function newConnectionColor() {
  return PALETTE[state.connections.length % PALETTE.length];
}

export async function saveConnection(input: Omit<Connection, "id" | "hasKey"> & { id?: string }, key: string | undefined) {
  const id = input.id ?? crypto.randomUUID();
  if (key !== undefined) {
    if (key) await secrets.set(id, key);
    else await secrets.delete(id);
  }
  const existing = state.connections.find((c) => c.id === id);
  const hasKey = key !== undefined ? !!key : (existing?.hasKey ?? false);
  const conn: Connection = { id, name: input.name, url: input.url, color: input.color, hasKey };
  state.setConnections(
    produce((list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) list[i] = conn;
      else list.push(conn);
    }),
  );
  await persistConnections();
  return conn;
}

export async function deleteConnection(id: string, opts: { navigate?: boolean } = {}) {
  await secrets.delete(id);
  state.setConnections((list) => list.filter((c) => c.id !== id));
  await persistConnections();
  if (state.activeId() === id) disconnect(opts);
}

export async function getConnectionKey(id: string) {
  return secrets.get(id);
}

// ---------- navigation helpers ----------

/** Views that exist without a connection. Everything else belongs to the connected server. */
const LOCAL_VIEWS = new Set<View["kind"]>(["welcome", "connection-form", "instances"]);
export const isServerView = (v: View) => !LOCAL_VIEWS.has(v.kind);

/** Where the connection form returns to on Cancel / Save. */
let formReturnTo: View = { kind: "welcome" };

export function openConnectionForm(id?: string) {
  const v = state.view();
  if (v.kind !== "connection-form") formReturnTo = v;
  state.setView({ kind: "connection-form", id });
}

export function closeConnectionForm() {
  const back = formReturnTo;
  formReturnTo = { kind: "welcome" };
  // A server page only makes sense while we're still connected to that server.
  state.setView(isServerView(back) && !connected() ? { kind: "welcome" } : back);
}

// ---------- connection lifecycle ----------

const CONNECT_TIMEOUT_MS = 8000;
const PROBE_MS = 3000;
// Bumped on every connect/disconnect so a slow attempt can't overwrite a newer one.
let connectSeq = 0;
/** The connection whose server the current view belongs to (keep-your-place on reconnect). */
let viewOwner: string | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = undefined;
}

function probe(m: Meili) {
  m.req("GET", "/health", { signal: AbortSignal.timeout(PROBE_MS) }).catch(() => {});
}

/** Wire a client's reachability hooks to the connection state. */
function watch(m: Meili, connName: string) {
  m.onUnreachable = () => {
    if (state.client() !== m || state.server().status !== "ready") return;
    state.setServer({ ...state.server(), status: "lost", error: `Lost connection to ${connName}.` });
    stopWatchdog();
    watchdog = setInterval(() => (state.client() === m ? probe(m) : stopWatchdog()), PROBE_MS);
  };
  m.onReachable = () => {
    if (state.client() !== m || state.server().status !== "lost") return;
    stopWatchdog();
    state.setServer({ ...state.server(), status: "ready", error: undefined });
    notify("success", `Reconnected to ${connName}`);
    refreshIndexes();
  };
}

/** Probe a lost server right away (banner "Retry now"). */
export function retryNow() {
  const m = state.client();
  if (m) probe(m);
}

export function disconnect(opts: { navigate?: boolean } = {}) {
  connectSeq++;
  stopWatchdog();
  viewOwner = undefined;
  batch(() => {
    state.setActiveId(undefined);
    state.setClient(undefined);
    state.setIndexes([]);
    state.setServer({ status: "idle" });
    // Pages that don't need a server (Local instances, the form) stay put.
    if (opts.navigate !== false && isServerView(state.view())) state.setView({ kind: "welcome" });
  });
}

/**
 * Connect to a saved connection. Reconnecting to the server the current page belongs to
 * keeps the page; switching servers opens its Overview.
 */
export async function connect(id: string) {
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return notify("error", "That connection no longer exists");
  const seq = ++connectSeq;
  stopWatchdog();
  batch(() => {
    state.setActiveId(id);
    state.setClient(undefined);
    state.setServer({ status: "connecting" });
    state.setIndexes([]);
  });
  try {
    const key = conn.hasKey ? await secrets.get(id) : undefined;
    const m = new Meili(conn.url, key);
    const version = await m.req("GET", "/version", { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
    if (seq !== connectSeq) return;
    watch(m, conn.name);
    const keep = viewOwner === id && isServerView(state.view());
    batch(() => {
      state.setClient(m);
      state.setServer({ status: "ready", version });
      if (!keep && state.view().kind !== "instances") state.setView({ kind: "overview" });
    });
    viewOwner = id;
    await refreshIndexes();
    // The page we kept may point at an index that no longer exists.
    const v = state.view();
    if (seq === connectSeq && v.kind === "index" && !state.indexes().some((i) => i.uid === v.uid)) state.setView({ kind: "overview" });
  } catch (e) {
    if (seq !== connectSeq) return;
    const msg = e instanceof DOMException && e.name === "TimeoutError" ? `No response from ${conn.url} after ${CONNECT_TIMEOUT_MS / 1000} s.` : errorMessage(e);
    state.setServer({ status: "error", error: msg });
    // The form and Local instances outrank the error screen: surface the failure there too.
    if (state.view().kind === "connection-form" || state.view().kind === "instances") notify("error", `Couldn't connect to ${conn.name}: ${msg}`);
  }
}

export async function refreshIndexes() {
  const m = state.client();
  if (!m) return;
  try {
    const all: IndexInfo[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await m.req<{ results: IndexInfo[]; total: number }>("GET", "/indexes", { query: { offset, limit: 100 } });
      all.push(...page.results);
      if (all.length >= page.total || page.results.length === 0) break;
    }
    // Document counts come from global stats (single request).
    try {
      const stats = await m.req<{ indexes: Record<string, { numberOfDocuments: number; isIndexing: boolean }> }>("GET", "/stats");
      for (const idx of all) {
        const s = stats.indexes[idx.uid];
        if (s) {
          idx.numberOfDocuments = s.numberOfDocuments;
          idx.isIndexing = s.isIndexing;
        }
      }
    } catch {
      /* key may lack stats.get */
    }
    all.sort((a, b) => a.uid.localeCompare(b.uid));
    // Switched servers while this was in flight: these indexes belong to another server.
    if (state.client() !== m) return;
    state.setIndexes(all);
  } catch (e) {
    if (state.client() === m) notifyError(e, "Failed to list indexes");
  }
}

// ---------- async task tracking ----------

let activitySeq = 0;

/**
 * Track an enqueued Meilisearch task in the activity bar, wait for it to finish,
 * and surface failures. Resolves with the final task.
 */
export async function trackTask(enqueued: EnqueuedTask | Promise<EnqueuedTask>, label: string): Promise<Task | undefined> {
  const id = ++activitySeq;
  state.setActivity((a) => [{ id, label, status: "running" as const, at: Date.now() }, ...a].slice(0, 50));
  const update = (patch: Partial<Activity>) => state.setActivity((x) => x.id === id, patch);
  // Pin the server now: the user may switch connections while this task runs.
  const m = state.client();
  const connName = activeConnection()?.name;
  const where = () => (state.client() !== m && connName ? ` (on ${connName})` : "");
  try {
    if (!m) throw new Error("Not connected");
    const t = await enqueued;
    update({ taskUid: t.taskUid });
    const final = await m.waitForTask(t.taskUid);
    update({ status: final.status as Activity["status"], error: final.error?.message });
    if (final.status === "failed") notify("error", `${label}${where()} failed: ${final.error?.message ?? "unknown error"}`);
    else if (final.status === "succeeded") notify("success", `${label}${where()} ✓`);
    return final;
  } catch (e) {
    update({ status: "failed", error: errorMessage(e) });
    notifyError(e, label + where());
    return undefined;
  }
}

export const runningActivities = () => state.activity.filter((a) => a.status === "running").length;
