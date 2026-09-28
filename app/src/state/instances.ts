// Local Meilisearch instance manager: install the official binary, then start/stop
// instances with their own data dir, port, master key and launch flags.
// Uses only Tauri plugins (shell, upload, fs, os) — no custom Rust.

import { createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isTauri, loadSetting, saveSetting, secrets } from "../lib/platform";
import { FlagDef, parseHelp } from "../lib/meiliHelp";
import { Meili } from "../api/meili";
import { deleteConnection, saveConnection, notify, notifyError } from "./app";

export interface Instance {
  id: string;
  name: string;
  port: number;
  env: "development" | "production";
  /** Extra launch flags: name → value ("" / true for switches). */
  flags: Record<string, string | boolean>;
  /** Extra environment variables. */
  envVars: Record<string, string>;
  hasKey: boolean;
  connectionId?: string;
  upgradeOnNextStart?: boolean;
}

export type RunStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";

interface Runtime {
  status: RunStatus;
  pid?: number;
  exitCode?: number | null;
  logs: string[];
  startedAt?: number;
}

export interface Release {
  tag: string;
  version: string;
  publishedAt: string;
  url: string;
  size: number;
  sha256?: string;
  htmlUrl: string;
}

const MAX_LOG_LINES = 3000;

type Child = { kill(): Promise<void>; pid: number };

const s = createRoot(() => {
  const [instances, setInstances] = createStore<Instance[]>([]);
  const [runtime, setRuntime] = createStore<Record<string, Runtime>>({});
  const [binary, setBinary] = createSignal<{ path?: string; version?: string; checked: boolean }>({ checked: false });
  const [flagDefs, setFlagDefs] = createSignal<FlagDef[]>([]);
  return { instances, setInstances, runtime, setRuntime, binary, setBinary, flagDefs, setFlagDefs };
});

export const { instances, runtime, binary, flagDefs } = s;
const children = new Map<string, Child>();

export const runningCount = () => Object.values(s.runtime).filter((r) => r.status === "running" || r.status === "starting").length;
export const rt = (id: string): Runtime => s.runtime[id] ?? { status: "stopped", logs: [] };

// ---------- native file ops (src-tauri/src/files.rs, sandboxed to the app data dir) ----------

const files = {
  async call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  },
  exists: (path: string) => files.call<boolean>("app_path_exists", { path }),
  ensureDir: (path: string) => files.call<void>("app_ensure_dir", { path }),
  remove: (path: string) => files.call<void>("app_remove", { path }),
  replace: (from: string, to: string) => files.call<void>("app_replace_file", { from, to }),
  sha256: (path: string) => files.call<string>("app_sha256", { path }),
};

// ---------- paths & platform ----------

async function platformInfo() {
  const os = await import("@tauri-apps/plugin-os");
  return { platform: os.platform(), arch: os.arch() };
}

async function paths() {
  const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
  const root = await appLocalDataDir();
  const { platform } = await platformInfo();
  const exe = platform === "windows" ? "meilisearch.exe" : "meilisearch";
  return {
    root,
    binDir: await join(root, "bin"),
    binary: await join(root, "bin", exe),
    instanceDir: (id: string) => join(root, "instances", id),
    join,
  };
}

async function command(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  const { platform } = await platformInfo();
  return Command.create(platform === "windows" ? "meilisearch-win" : "meilisearch", args, opts);
}

function assetName(platform: string, arch: string): string {
  if (platform === "windows") return "meilisearch-windows-amd64.exe";
  if (platform === "macos") return arch === "aarch64" ? "meilisearch-macos-apple-silicon" : "meilisearch-macos-amd64";
  if (arch === "aarch64") return "meilisearch-linux-aarch64";
  if (arch === "riscv64") return "meilisearch-linux-riscv64";
  return "meilisearch-linux-amd64";
}

// ---------- persistence ----------

export async function loadInstances() {
  s.setInstances(await loadSetting<Instance[]>("instances", []));
  if (isTauri) refreshBinary();
}

async function persist() {
  await saveSetting("instances", JSON.parse(JSON.stringify(s.instances)));
}

export async function saveInstance(inst: Instance, key?: string) {
  if (key !== undefined) {
    if (key) await secrets.set(`instance:${inst.id}`, key);
    else await secrets.delete(`instance:${inst.id}`);
    inst = { ...inst, hasKey: !!key };
  }
  const i = s.instances.findIndex((x) => x.id === inst.id);
  if (i >= 0) s.setInstances(i, inst);
  else s.setInstances(s.instances.length, inst);
  await persist();
}

export async function deleteInstance(id: string, deleteData: boolean) {
  if (children.has(id)) await stopInstance(id);
  await secrets.delete(`instance:${id}`);
  if (deleteData) await files.remove(await (await paths()).instanceDir(id));
  // Drop the connection this instance registered for itself.
  const connId = s.instances.find((x) => x.id === id)?.connectionId;
  if (connId) await deleteConnection(connId);
  s.setInstances((list) => list.filter((x) => x.id !== id));
  await persist();
}

export function newInstanceTemplate(): Instance {
  const used = new Set(s.instances.map((i) => i.port));
  let port = 7700;
  while (used.has(port)) port++;
  return { id: crypto.randomUUID(), name: `local-${s.instances.length + 1}`, port, env: "development", flags: {}, envVars: {}, hasKey: true };
}

export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .slice(0, 32);
}

// ---------- binary management ----------

export async function refreshBinary() {
  try {
    const p = await paths();
    if (!(await files.exists(p.binary))) return s.setBinary({ checked: true });
    const out = await (await command(["--version"])).execute();
    const version = out.stdout.trim().split(/\s+/).pop();
    s.setBinary({ path: p.binary, version, checked: true });
    const help = await (await command(["--help"])).execute();
    s.setFlagDefs(parseHelp(help.stdout));
  } catch (e) {
    s.setBinary({ checked: true });
    notifyError(e, "Checking the Meilisearch binary");
  }
}

export async function latestRelease(): Promise<Release> {
  const res = await fetch("https://api.github.com/repos/meilisearch/meilisearch/releases?per_page=10", { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const releases: any[] = await res.json();
  const rel = releases.find((r) => !r.draft && !r.prerelease);
  if (!rel) throw new Error("No stable release found");
  const { platform, arch } = await platformInfo();
  const name = assetName(platform, arch);
  // Community edition (MIT) only — enterprise assets are BUSL-licensed.
  const asset = rel.assets.find((a: any) => a.name === name);
  if (!asset) throw new Error(`Release ${rel.tag_name} has no ${name}`);
  return {
    tag: rel.tag_name,
    version: rel.tag_name.replace(/^v/, ""),
    publishedAt: rel.published_at,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: typeof asset.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : undefined,
    htmlUrl: rel.html_url,
  };
}

export async function installBinary(rel: Release, onProgress: (phase: string, done: number, total: number) => void) {
  if (runningCount() > 0) throw new Error("Stop all running instances before installing a new binary.");
  const p = await paths();
  const { download } = await import("@tauri-apps/plugin-upload");
  await files.ensureDir(p.binDir);
  const tmp = `${p.binary}.download`;
  await files.remove(tmp);

  let done = 0;
  await download(rel.url, tmp, (e) => {
    done = e.progressTotal;
    onProgress("Downloading", done, e.total || rel.size);
  });

  if (rel.sha256) {
    onProgress("Verifying SHA-256", rel.size, rel.size);
    const actual = await files.sha256(tmp);
    if (actual !== rel.sha256) {
      await files.remove(tmp);
      throw new Error(`Checksum mismatch — expected ${rel.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…. The download was discarded.`);
    }
  }

  await files.replace(tmp, p.binary); // also sets the executable bit on macOS/Linux
  const previous = s.binary().version;
  await refreshBinary();
  // Existing databases need a one-time upgrade after a version change.
  if (previous && previous !== s.binary().version) {
    for (const inst of s.instances) await saveInstance({ ...inst, upgradeOnNextStart: true });
  }
}

// ---------- process lifecycle ----------

function pushLog(id: string, line: string) {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r?\n$/, "");
  s.setRuntime(id, (r) => {
    const logs = (r?.logs ?? []).concat(clean);
    return { ...(r ?? { status: "stopped" }), logs: logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs };
  });
}

export function buildArgs(inst: Instance, dataDir: string, join: (...p: string[]) => Promise<string>) {
  return (async () => {
    const args = [
      "--db-path", await join(dataDir, "data.ms"),
      "--dump-dir", await join(dataDir, "dumps"),
      "--snapshot-dir", await join(dataDir, "snapshots"),
      "--http-addr", `127.0.0.1:${inst.port}`,
      "--env", inst.env,
      "--no-analytics",
    ];
    if (inst.upgradeOnNextStart) args.push("--upgrade-db");
    for (const [name, value] of Object.entries(inst.flags)) {
      if (value === false || value === undefined) continue;
      if (value === true || value === "") args.push(`--${name}`);
      else args.push(`--${name}`, String(value));
    }
    return args;
  })();
}

/** True if something already answers HTTP on 127.0.0.1:port. */
export async function portInUse(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) });
    return true;
  } catch {
    return false;
  }
}

export async function findFreePort(start: number): Promise<number> {
  const used = new Set(s.instances.map((i) => i.port));
  for (let p = start; p < start + 200; p++) if (!used.has(p) && !(await portInUse(p))) return p;
  return start;
}

export async function startInstance(id: string) {
  const inst = s.instances.find((i) => i.id === id);
  if (!inst || children.has(id)) return;
  if (!s.binary().path) throw new Error("Install the Meilisearch binary first.");
  // Otherwise the readiness probe below could get an answer from someone else's server.
  if (await portInUse(inst.port)) throw new Error(`Port ${inst.port} is already in use by another process. Edit the instance and pick another port.`);
  const p = await paths();
  const dataDir = await p.instanceDir(id);
  await files.ensureDir(dataDir);

  const key = inst.hasKey ? await secrets.get(`instance:${id}`) : undefined;
  const env: Record<string, string> = { ...inst.envVars };
  if (key) env.MEILI_MASTER_KEY = key; // env, not argv: keeps the key out of the process list
  const args = await buildArgs(inst, dataDir, p.join);

  s.setRuntime(id, { status: "starting", logs: [`$ meilisearch ${args.join(" ")}`], startedAt: Date.now() });
  const cmd = await command(args, { cwd: dataDir, env });
  cmd.stdout.on("data", (l: string) => pushLog(id, l));
  cmd.stderr.on("data", (l: string) => pushLog(id, l));
  cmd.on("error", (e: string) => pushLog(id, `[error] ${e}`));
  cmd.on("close", ({ code }: { code: number | null }) => {
    children.delete(id);
    const wasStopping = rt(id).status === "stopping";
    s.setRuntime(id, (r) => ({ ...r, status: wasStopping || code === 0 ? "stopped" : "crashed", exitCode: code, pid: undefined }));
    pushLog(id, `[process exited with code ${code}]`);
    if (!wasStopping && code !== 0) notify("error", `Instance ${inst.name} exited with code ${code}. See its logs.`);
  });
  const child = await cmd.spawn();
  children.set(id, child);
  s.setRuntime(id, (r) => ({ ...r, pid: child.pid }));

  // Wait for /health, then register a connection for it.
  const client = new Meili(`http://127.0.0.1:${inst.port}`, key);
  for (let i = 0; i < 120 && children.has(id); i++) {
    try {
      await client.req("GET", "/health");
      s.setRuntime(id, (r) => ({ ...r, status: "running" }));
      if (inst.upgradeOnNextStart) await saveInstance({ ...inst, upgradeOnNextStart: false });
      await ensureConnection(inst, key);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function ensureConnection(inst: Instance, key: string | undefined) {
  const conn = await saveConnection(
    { id: inst.connectionId, name: `${inst.name} (local)`, url: `http://127.0.0.1:${inst.port}`, color: "#10b981" },
    key ?? "",
  );
  if (inst.connectionId !== conn.id) await saveInstance({ ...s.instances.find((i) => i.id === inst.id)!, connectionId: conn.id });
}

export async function stopInstance(id: string) {
  const child = children.get(id);
  if (!child) return;
  s.setRuntime(id, (r) => ({ ...r, status: "stopping" }));
  await child.kill();
}

/** Kill managed instances when the window closes so no orphans keep ports and DB locks. */
export async function stopAllOnExit() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    if (children.size === 0) return;
    event.preventDefault();
    await Promise.allSettled([...children.keys()].map(stopInstance));
    await win.destroy();
  });
}

export async function instanceDataDir(id: string) {
  return (await paths()).instanceDir(id);
}
