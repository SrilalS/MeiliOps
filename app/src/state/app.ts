import { createSignal, createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { EnqueuedTask, Meili, Task, errorMessage } from "../api/meili";
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
  status: "idle" | "connecting" | "ready" | "error";
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

/** The connected client. Views only render while connected, so this never throws in practice. */
export function api(): Meili {
  const c = state.client();
  if (!c) throw new Error("Not connected");
  return c;
}

// ---------- toasts ----------

let toastSeq = 0;
export function notify(kind: Toast["kind"], text: string, ms = kind === "error" ? 8000 : 3500) {
  const id = ++toastSeq;
  state.setToasts((t) => [...t, { id, kind, text }]);
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number) {
  state.setToasts((t) => t.filter((x) => x.id !== id));
}
export function notifyError(e: unknown, prefix?: string) {
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

export async function deleteConnection(id: string) {
  await secrets.delete(id);
  state.setConnections((list) => list.filter((c) => c.id !== id));
  await persistConnections();
  if (state.activeId() === id) disconnect();
}

export async function getConnectionKey(id: string) {
  return secrets.get(id);
}

export function disconnect() {
  state.setActiveId(undefined);
  state.setClient(undefined);
  state.setIndexes([]);
  state.setServer({ status: "idle" });
  state.setView({ kind: "welcome" });
}

export async function connect(id: string) {
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return;
  state.setActiveId(id);
  state.setServer({ status: "connecting" });
  state.setIndexes([]);
  try {
    const key = conn.hasKey ? await secrets.get(id) : undefined;
    const m = new Meili(conn.url, key);
    const version = await m.req("GET", "/version");
    state.setClient(m);
    state.setServer({ status: "ready", version });
    state.setView({ kind: "overview" });
    await refreshIndexes();
  } catch (e) {
    state.setClient(undefined);
    state.setServer({ status: "error", error: errorMessage(e) });
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
    state.setIndexes(all);
  } catch (e) {
    notifyError(e, "Failed to list indexes");
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
  try {
    const t = await enqueued;
    update({ taskUid: t.taskUid });
    const final = await api().waitForTask(t.taskUid);
    update({ status: final.status as Activity["status"], error: final.error?.message });
    if (final.status === "failed") notify("error", `${label} failed: ${final.error?.message ?? "unknown error"}`);
    else if (final.status === "succeeded") notify("success", `${label} ✓`);
    return final;
  } catch (e) {
    update({ status: "failed", error: errorMessage(e) });
    notifyError(e, label);
    return undefined;
  }
}

export const runningActivities = () => state.activity.filter((a) => a.status === "running").length;
