// Local Meilisearch instance manager. Each instance picks a Meilisearch version and an
// engine: the native binary (side-by-side installs under bin/<version>/, run by
// src-tauri/src/process.rs) or a Docker/Podman container (official getmeili/meilisearch
// image, data in a named volume, driven through the shell plugin).

import { createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isTauri, loadSetting, saveSetting, secrets } from "../lib/platform";
import { FlagDef, parseHelp } from "../lib/meiliHelp";
import { Meili } from "../api/meili";
import { activeId, connect, connections, deleteConnection, saveConnection, notify, notifyError } from "./app";

export type Engine = "native" | "docker" | "podman";
export const ENGINES: Engine[] = ["native", "docker", "podman"];
export const engineLabel = (e: Engine | undefined) => (e === "docker" ? "Docker" : e === "podman" ? "Podman" : "Native");

export interface Instance {
  id: string;
  name: string;
  port: number;
  env: "development" | "production";
  /** Meilisearch version without the "v" (e.g. "1.22.1"). */
  version?: string;
  /** Where it runs. Missing means native (instances created before 0.4). */
  engine?: Engine;
  /** Version that last opened each engine's data (native folder, Docker or Podman volume). */
  dataVersion?: Partial<Record<Engine, string>>;
  /** Extra launch flags: name → value ("" / true for switches). */
  flags: Record<string, string | boolean>;
  /** Extra environment variables. */
  envVars: Record<string, string>;
  hasKey: boolean;
  connectionId?: string;
  /** Pre-0.4: set when the single shared binary was updated. Migrated into dataVersion. */
  upgradeOnNextStart?: boolean;
}

export type RunStatus = "stopped" | "pulling" | "starting" | "running" | "stopping" | "crashed";

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
  prerelease: boolean;
  publishedAt: string;
  htmlUrl: string;
  /** Native binary for this platform; missing when the release has none (containers only). */
  url?: string;
  size?: number;
  sha256?: string;
}

export interface EngineInfo {
  /** Shell scope name that worked (see capabilities/default.json). */
  program: string;
  version: string;
  /** Daemon / Podman machine answering. */
  running: boolean;
  /** Pulled getmeili/meilisearch tags, without the "v". */
  images: string[];
}

const MAX_LOG_LINES = 3000;
const IMAGE = "docker.io/getmeili/meilisearch";
/** First version with dumpless upgrades (`--upgrade-db`). */
const UPGRADE_DB_SINCE = "1.12.0";

type Child = { kill(): Promise<void>; pid?: number };

const s = createRoot(() => {
  const [instances, setInstances] = createStore<Instance[]>([]);
  const [runtime, setRuntime] = createStore<Record<string, Runtime>>({});
  const [versions, setVersions] = createSignal<{ list: string[]; checked: boolean }>({ list: [], checked: false });
  const [engines, setEngines] = createStore<{ checked: boolean; docker?: EngineInfo; podman?: EngineInfo }>({ checked: false });
  return { instances, setInstances, runtime, setRuntime, versions, setVersions, engines, setEngines };
});

export const { instances, runtime, engines } = s;
/** Installed native versions, newest first. */
export const installedVersions = () => s.versions().list;
export const versionsChecked = () => s.versions().checked;
const children = new Map<string, Child>();

export const isLive = (st: RunStatus) => st === "running" || st === "starting" || st === "pulling" || st === "stopping";
export const runningCount = () => Object.values(s.runtime).filter((r) => r.status === "running" || r.status === "starting" || r.status === "pulling").length;
export const rt = (id: string): Runtime => s.runtime[id] ?? { status: "stopped", logs: [] };
export const engineOf = (inst: Instance): Engine => inst.engine ?? "native";

// ---------- versions ----------

/** Compares "1.9.0" < "1.10.0"; a pre-release sorts before its release. */
export function cmpVersion(a: string, b: string): number {
  const [ma, pa = ""] = a.split("-", 2);
  const [mb, pb = ""] = b.split("-", 2);
  const na = ma.split(".").map(Number);
  const nb = mb.split(".").map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d) return d;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.localeCompare(pb, undefined, { numeric: true });
}
const newestFirst = (list: string[]) => [...list].sort((a, b) => cmpVersion(b, a));

// ---------- native file ops (src-tauri/src/files.rs, sandboxed to the app data dir) ----------

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

const files = {
  exists: (path: string) => invoke<boolean>("app_path_exists", { path }),
  ensureDir: (path: string) => invoke<void>("app_ensure_dir", { path }),
  remove: (path: string) => invoke<void>("app_remove", { path }),
  replace: (from: string, to: string) => invoke<void>("app_replace_file", { from, to }),
  sha256: (path: string) => invoke<string>("app_sha256", { path }),
  list: (path: string) => invoke<string[]>("app_list_dir", { path }),
};

/** Windows reports open files as "os error 32"; say what that means here. */
function explainRemoveError(e: unknown, what: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/os error (32|5)\b|being used by another process|Access is denied/i.test(msg)) {
    return new Error(`Couldn't delete ${what}: a Meilisearch process is still using it. It may be left over from an earlier MeiliOps session; end meilisearch in Task Manager (or restart the computer), then try again.`);
  }
  return new Error(`Couldn't delete ${what}: ${msg}`);
}

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
    exe,
    versionDir: (v: string) => join(root, "bin", v),
    binary: (v: string) => join(root, "bin", v, exe),
    /** Pre-0.4 single binary. */
    legacyBinary: await join(root, "bin", exe),
    instanceDir: (id: string) => join(root, "instances", id),
    join,
  };
}

function assetName(platform: string, arch: string): string {
  if (platform === "windows") return "meilisearch-windows-amd64.exe";
  if (platform === "macos") return arch === "aarch64" ? "meilisearch-macos-apple-silicon" : "meilisearch-macos-amd64";
  if (arch === "aarch64") return "meilisearch-linux-aarch64";
  if (arch === "riscv64") return "meilisearch-linux-riscv64";
  return "meilisearch-linux-amd64";
}

type ProcEvent = { event: "stdout" | "stderr" | "error"; data: string } | { event: "close"; data: { code: number | null } };

/** Start an installed native version (process.rs). */
async function spawnNative(version: string, args: string[], cwd: string, env: Record<string, string>, onLine: (l: string) => void, onClose: (code: number | null) => void): Promise<Child> {
  const { Channel } = await import("@tauri-apps/api/core");
  const ch = new Channel<ProcEvent>();
  ch.onmessage = (m) => {
    if (m.event === "close") onClose(m.data.code);
    else onLine(m.event === "error" ? `[error] ${m.data}` : m.data);
  };
  const pid = await invoke<number>("meili_spawn", { version, args, cwd, env, onEvent: ch });
  return { pid, kill: () => invoke<void>("meili_kill", { pid }) };
}

const nativeOutput = (version: string, args: string[]) => invoke<{ code: number | null; stdout: string; stderr: string }>("meili_output", { version, args });

// ---------- container engines (Docker / Podman through the shell plugin) ----------

/** Scope names per engine, in the order to try (capabilities/default.json). */
const PROGRAMS: Record<"docker" | "podman", string[]> = {
  docker: ["docker", "docker-usr-local", "docker-homebrew", "docker-app"],
  podman: ["podman", "podman-usr-local", "podman-homebrew", "podman-opt"],
};

async function engineCmd(engine: "docker" | "podman", args: string[], opts: { env?: Record<string, string> } = {}) {
  const program = s.engines[engine]?.program;
  if (!program) throw new Error(`${engineLabel(engine)} isn't installed.`);
  const { Command } = await import("@tauri-apps/plugin-shell");
  return Command.create(program, args, opts);
}

async function engineRun(engine: "docker" | "podman", args: string[]) {
  const out = await (await engineCmd(engine, args)).execute();
  if (out.code !== 0) throw new Error(out.stderr.trim() || `${engineLabel(engine)} exited with code ${out.code}`);
  return out.stdout;
}

const containerName = (id: string) => `meiliops-${id}`;
const volumeName = (id: string) => `meiliops-${id}`;
const imageRef = (version: string) => `${IMAGE}:v${version}`;

async function detectEngine(engine: "docker" | "podman"): Promise<EngineInfo | undefined> {
  const { Command } = await import("@tauri-apps/plugin-shell");
  for (const program of PROGRAMS[engine]) {
    try {
      const v = await Command.create(program, ["--version"]).execute();
      if (v.code !== 0) continue;
      const version = v.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? v.stdout.trim();
      // `info` needs the daemon (Docker) or a running machine (Podman on Windows/macOS).
      const info = await Command.create(program, ["info", "--format", "{{json .}}"]).execute();
      const running = info.code === 0;
      let images: string[] = [];
      if (running) {
        const out = await Command.create(program, ["images", IMAGE, "--format", "{{.Tag}}"]).execute();
        images = newestFirst(out.stdout.split(/\s+/).filter((t) => /^v\d/.test(t)).map((t) => t.slice(1)));
      }
      return { program, version, running, images };
    } catch {
      // Not in the scope's location: try the next one.
    }
  }
  return undefined;
}

export async function refreshEngines() {
  if (!isTauri) return;
  const [docker, podman] = await Promise.all([detectEngine("docker"), detectEngine("podman")]);
  s.setEngines({ checked: true, docker, podman });
}

export function engineReady(e: Engine): boolean {
  return e === "native" || !!s.engines[e]?.running;
}

// ---------- persistence & migration ----------

export async function loadInstances() {
  let list = await loadSetting<Instance[]>("instances", []);
  if (isTauri) {
    const legacy = await migrateLegacyBinary();
    if (list.some((i) => !i.version || i.upgradeOnNextStart !== undefined)) {
      list = list.map(({ upgradeOnNextStart, ...i }) => ({
        ...i,
        version: i.version ?? legacy,
        // Data last opened by an older binary: "0" forces --upgrade-db on the next start.
        dataVersion: i.dataVersion ?? (legacy ? { native: upgradeOnNextStart ? "0" : legacy } : {}),
      }));
      s.setInstances(list);
      await persist();
    } else s.setInstances(list);
    refreshVersions();
    refreshEngines().then(adoptContainers);
  } else s.setInstances(list);
}

/** Pre-0.4 kept one binary at bin/meilisearch[.exe]: move it to bin/<version>/. */
async function migrateLegacyBinary(): Promise<string | undefined> {
  try {
    const p = await paths();
    if (!(await files.exists(p.legacyBinary))) return undefined;
    const { Command } = await import("@tauri-apps/plugin-shell");
    const out = await Command.create(p.exe.endsWith(".exe") ? "meilisearch-legacy-win" : "meilisearch-legacy", ["--version"]).execute();
    const version = out.stdout.trim().split(/\s+/).pop();
    if (!version || !/^\d/.test(version)) return undefined;
    await files.ensureDir(await p.versionDir(version));
    const target = await p.binary(version);
    if (await files.exists(target)) await files.remove(p.legacyBinary);
    else await files.replace(p.legacyBinary, target);
    return version;
  } catch (e) {
    notifyError(e, "Moving the installed Meilisearch binary");
    return undefined;
  }
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
  const inst = s.instances.find((x) => x.id === id);
  if (children.has(id)) await stopInstance(id);
  // Data first: if it can't be removed, the instance stays so the user can retry.
  if (deleteData) {
    await removeInstanceData(id);
    for (const e of ["docker", "podman"] as const) {
      // Data may also sit in a volume of each engine the instance ever ran on.
      if (inst?.dataVersion?.[e] && s.engines[e]?.running) await removeVolume(e, volumeName(id));
    }
  }
  await secrets.delete(`instance:${id}`);
  // Stay on the Local instances page even if it was the active connection.
  if (inst?.connectionId) await deleteConnection(inst.connectionId, { navigate: false });
  s.setInstances((list) => list.filter((x) => x.id !== id));
  await persist();
}

async function removeInstanceData(id: string) {
  try {
    await files.remove(await (await paths()).instanceDir(id));
  } catch (e) {
    throw explainRemoveError(e, "the data folder");
  }
}

async function removeVolume(engine: "docker" | "podman", name: string) {
  try {
    await engineRun(engine, ["volume", "rm", "-f", name]);
  } catch (e) {
    throw new Error(`Couldn't delete the ${engineLabel(engine)} volume ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

// ---------- leftover data ----------

export interface Leftover {
  /** "native" = folder under instances/, else a volume of that engine. */
  engine: Engine;
  /** Folder or volume name. */
  name: string;
}

/** Data folders and volumes that no instance owns (deleted with "keep data", or older sessions). */
export async function findLeftovers(): Promise<Leftover[]> {
  if (!isTauri) return [];
  const ids = new Set(s.instances.map((i) => i.id));
  const p = await paths();
  const out: Leftover[] = (await files.list(await p.join(p.root, "instances"))).filter((d) => !ids.has(d)).map((name) => ({ engine: "native", name }));
  for (const e of ["docker", "podman"] as const) {
    if (!s.engines[e]?.running) continue;
    const vols = (await engineRun(e, ["volume", "ls", "--filter", "name=meiliops-", "--format", "{{.Name}}"]).catch(() => ""))
      .split(/\s+/)
      .filter((v) => v.startsWith("meiliops-") && !ids.has(v.slice("meiliops-".length)));
    out.push(...vols.map((name) => ({ engine: e as Engine, name })));
  }
  return out;
}

export async function removeLeftover(l: Leftover) {
  if (l.engine === "native") {
    try {
      await files.remove(await (await paths()).instanceDir(l.name));
    } catch (e) {
      throw explainRemoveError(e, "the folder");
    }
  } else await removeVolume(l.engine, l.name);
}

export function newInstanceTemplate(): Instance {
  const used = new Set(s.instances.map((i) => i.port));
  let port = 7700;
  while (used.has(port)) port++;
  const native = installedVersions()[0];
  const engine: Engine = native ? "native" : s.engines.docker?.running ? "docker" : s.engines.podman?.running ? "podman" : "native";
  const version = native ?? (engine !== "native" ? s.engines[engine]?.images[0] : undefined);
  return { id: crypto.randomUUID(), name: `local-${s.instances.length + 1}`, port, env: "development", engine, version, dataVersion: {}, flags: {}, envVars: {}, hasKey: true };
}

export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .slice(0, 32);
}

// ---------- native versions ----------

export async function refreshVersions() {
  try {
    s.setVersions({ list: newestFirst(await invoke<string[]>("meili_versions")), checked: true });
  } catch (e) {
    s.setVersions({ list: [], checked: true });
    notifyError(e, "Listing installed Meilisearch versions");
  }
}

const flagCache = new Map<string, FlagDef[]>();

/**
 * Launch flags of a version, from its own `--help`. Uses the native binary when that
 * version is installed, otherwise the pulled image. Undefined when neither is available.
 */
export async function flagDefsFor(engine: Engine, version: string | undefined): Promise<FlagDef[] | undefined> {
  if (!version) return undefined;
  const native = installedVersions().includes(version);
  // Keyed by source too: defaults (memory, threads) differ between the host and a container.
  const cacheKey = `${native ? "native" : engine}:${version}`;
  const cached = flagCache.get(cacheKey);
  if (cached) return cached;
  let help: string | undefined;
  if (native) help = (await nativeOutput(version, ["--help"])).stdout;
  else if (engine !== "native" && s.engines[engine]?.images.includes(version)) {
    help = await engineRun(engine, ["run", "--rm", imageRef(version), "/bin/meilisearch", "--help"]);
  }
  if (!help) return undefined;
  const defs = parseHelp(help);
  flagCache.set(cacheKey, defs);
  return defs;
}

export async function listReleases(): Promise<Release[]> {
  const res = await fetch("https://api.github.com/repos/meilisearch/meilisearch/releases?per_page=100", { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const { platform, arch } = await platformInfo();
  const name = assetName(platform, arch);
  return (await res.json())
    .filter((r: any) => !r.draft && /^v\d/.test(r.tag_name))
    .map((r: any): Release => {
      // Community edition (MIT) only — enterprise assets are BUSL-licensed.
      const asset = r.assets.find((a: any) => a.name === name);
      return {
        tag: r.tag_name,
        version: r.tag_name.slice(1),
        prerelease: r.prerelease,
        publishedAt: r.published_at,
        htmlUrl: r.html_url,
        url: asset?.browser_download_url,
        size: asset?.size,
        sha256: typeof asset?.digest === "string" && asset.digest.startsWith("sha256:") ? asset.digest.slice(7) : undefined,
      };
    })
    .sort((a: Release, b: Release) => cmpVersion(b.version, a.version));
}

export async function installVersion(rel: Release, onProgress: (phase: string, done: number, total: number) => void) {
  if (!rel.url) throw new Error(`${rel.tag} has no binary for this platform.`);
  if (s.instances.some((i) => engineOf(i) === "native" && i.version === rel.version && isLive(rt(i.id).status))) {
    throw new Error(`Stop the instances running ${rel.tag} before reinstalling it.`);
  }
  const p = await paths();
  const { download } = await import("@tauri-apps/plugin-upload");
  await files.ensureDir(await p.versionDir(rel.version));
  const target = await p.binary(rel.version);
  const tmp = `${target}.download`;
  await files.remove(tmp);

  await download(rel.url, tmp, (e) => onProgress("Downloading", e.progressTotal, e.total || rel.size || 0));

  if (rel.sha256) {
    onProgress("Verifying SHA-256", rel.size ?? 0, rel.size ?? 0);
    const actual = await files.sha256(tmp);
    if (actual !== rel.sha256) {
      await files.remove(tmp);
      throw new Error(`Checksum mismatch — expected ${rel.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…. The download was discarded.`);
    }
  }

  await files.replace(tmp, target); // also sets the executable bit on macOS/Linux
  flagCache.delete(`native:${rel.version}`);
  await refreshVersions();
}

export async function removeVersion(version: string) {
  if (s.instances.some((i) => engineOf(i) === "native" && i.version === version && isLive(rt(i.id).status))) {
    throw new Error(`An instance is running ${version}. Stop it first.`);
  }
  await files.remove(await (await paths()).versionDir(version));
  flagCache.delete(`native:${version}`);
  await refreshVersions();
}

export async function pullImage(engine: "docker" | "podman", version: string, onLine: (l: string) => void = () => {}) {
  const cmd = await engineCmd(engine, ["pull", imageRef(version)]);
  const code = await new Promise<number | null>((resolve, reject) => {
    cmd.stdout.on("data", onLine);
    cmd.stderr.on("data", onLine);
    cmd.on("close", ({ code }) => resolve(code));
    cmd.on("error", reject);
    cmd.spawn().catch(reject);
  });
  if (code !== 0) throw new Error(`Pulling ${imageRef(version)} failed (exit code ${code}). See the logs.`);
  await refreshEngines();
}

export async function removeImage(engine: "docker" | "podman", version: string) {
  await engineRun(engine, ["rmi", imageRef(version)]);
  await refreshEngines();
}

// ---------- process lifecycle ----------

function pushLog(id: string, line: string) {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r?\n$/, "");
  s.setRuntime(id, (r) => {
    const logs = (r?.logs ?? []).concat(clean);
    return { ...(r ?? { status: "stopped" }), logs: logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs };
  });
}

/** Meilisearch arguments. Paths are inside the container for Docker/Podman. */
async function buildArgs(inst: Instance, dataDir: string, join: (...p: string[]) => Promise<string>, upgrade: boolean) {
  const container = engineOf(inst) !== "native";
  const args = [
    "--db-path", await join(dataDir, "data.ms"),
    "--dump-dir", await join(dataDir, "dumps"),
    "--snapshot-dir", await join(dataDir, "snapshots"),
    // Inside a container it must listen on all interfaces; the published port stays on 127.0.0.1.
    "--http-addr", container ? "0.0.0.0:7700" : `127.0.0.1:${inst.port}`,
    "--env", inst.env,
    "--no-analytics",
  ];
  if (upgrade) args.push("--upgrade-db");
  for (const [name, value] of Object.entries(inst.flags)) {
    if (value === false || value === undefined) continue;
    if (value === true || value === "") args.push(`--${name}`);
    else args.push(`--${name}`, String(value));
  }
  return args;
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

/** Whether starting `version` on this engine upgrades the data, or can't open it at all. */
export function upgradePlan(inst: Instance): { upgrade: boolean; error?: string } {
  const from = inst.dataVersion?.[engineOf(inst)];
  const to = inst.version;
  if (!from || !to || from === to) return { upgrade: false };
  if (cmpVersion(to, from) < 0) return { upgrade: false, error: `This data was last opened by Meilisearch ${from}. Meilisearch can't open data from a newer version; pick ${from} or later, or import a dump.` };
  if (cmpVersion(to, UPGRADE_DB_SINCE) < 0) return { upgrade: false, error: `Upgrading data in place needs Meilisearch ${UPGRADE_DB_SINCE} or later. Create a dump with ${from} and import it instead.` };
  return { upgrade: true };
}

export async function startInstance(id: string) {
  const inst = s.instances.find((i) => i.id === id);
  if (!inst || children.has(id)) return;
  const engine = engineOf(inst);
  const version = inst.version;
  if (!version) throw new Error("Pick a Meilisearch version for this instance (Edit).");
  if (engine === "native" && !installedVersions().includes(version)) throw new Error(`Meilisearch ${version} isn't installed. Install it above, or edit the instance.`);
  if (engine !== "native" && !s.engines[engine]?.running) throw new Error(`${engineLabel(engine)} isn't running. Start it, then refresh the engines.`);
  const plan = upgradePlan(inst);
  if (plan.error) throw new Error(plan.error);
  // Otherwise the readiness probe below could get an answer from someone else's server.
  if (await portInUse(inst.port)) throw new Error(`Port ${inst.port} is already in use by another process. Edit the instance and pick another port.`);

  const key = inst.hasKey ? await secrets.get(`instance:${id}`) : undefined;
  const env: Record<string, string> = { ...inst.envVars };
  if (key) env.MEILI_MASTER_KEY = key; // env, not argv: keeps the key out of the process list
  s.setRuntime(id, { status: "starting", logs: [], startedAt: Date.now() });

  const onClose = (code: number | null) => {
    children.delete(id);
    const wasStopping = rt(id).status === "stopping";
    s.setRuntime(id, (r) => ({ ...r, status: wasStopping || code === 0 ? "stopped" : "crashed", exitCode: code, pid: undefined }));
    pushLog(id, `[process exited with code ${code}]`);
    if (!wasStopping && code !== 0) notify("error", `Instance ${inst.name} exited with code ${code}. See its logs.`);
  };

  try {
    if (engine === "native") {
      const p = await paths();
      const dataDir = await p.instanceDir(id);
      await files.ensureDir(dataDir);
      const args = await buildArgs(inst, dataDir, p.join, plan.upgrade);
      pushLog(id, `$ meilisearch ${args.join(" ")}   (v${version})`);
      const child = await spawnNative(version, args, dataDir, env, (l) => pushLog(id, l), onClose);
      children.set(id, child);
      s.setRuntime(id, (r) => ({ ...r, pid: child.pid }));
    } else {
      if (!s.engines[engine]!.images.includes(version)) {
        s.setRuntime(id, (r) => ({ ...r, status: "pulling" }));
        pushLog(id, `$ ${engine} pull ${imageRef(version)}`);
        await pullImage(engine, version, (l) => pushLog(id, l));
        s.setRuntime(id, (r) => ({ ...r, status: "starting" }));
      }
      // A container left over from a crash would hold the name and the port.
      await engineRun(engine, ["rm", "-f", containerName(id)]).catch(() => {});
      const posix = async (...parts: string[]) => parts.join("/");
      const args = await buildArgs(inst, "/meili_data", posix, plan.upgrade);
      const run = [
        "run", "--rm", "--name", containerName(id),
        "--label", `meiliops.instance=${id}`,
        "-p", `127.0.0.1:${inst.port}:7700`,
        "-v", `${volumeName(id)}:/meili_data`,
        // `-e NAME` without a value copies it from the CLI's environment: the key stays out of argv.
        ...Object.keys(env).flatMap((k) => ["-e", k]),
        imageRef(version), "/bin/meilisearch", ...args,
      ];
      pushLog(id, `$ ${engine} ${run.join(" ")}`);
      const cmd = await engineCmd(engine, run, { env });
      cmd.stdout.on("data", (l: string) => pushLog(id, l));
      cmd.stderr.on("data", (l: string) => pushLog(id, l));
      cmd.on("error", (e: string) => pushLog(id, `[error] ${e}`));
      cmd.on("close", ({ code }: { code: number | null }) => onClose(code));
      const proc = await cmd.spawn();
      children.set(id, containerChild(engine, id, proc));
    }
  } catch (e) {
    children.delete(id);
    s.setRuntime(id, (r) => ({ ...r, status: "crashed" }));
    pushLog(id, `[error] ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  // Wait for /health, then register a connection for it.
  const client = new Meili(`http://127.0.0.1:${inst.port}`, key);
  for (let i = 0; i < 120 && children.has(id); i++) {
    try {
      await client.req("GET", "/health");
      s.setRuntime(id, (r) => ({ ...r, status: "running" }));
      const latest = s.instances.find((x) => x.id === id)!;
      if (latest.dataVersion?.[engine] !== version) await saveInstance({ ...latest, dataVersion: { ...latest.dataVersion, [engine]: version } });
      await ensureConnection(latest, key);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Stopping a container means `docker stop`: killing the CLI would leave it running. */
function containerChild(engine: "docker" | "podman", id: string, proc?: { kill(): Promise<void> }): Child {
  return {
    async kill() {
      try {
        await engineRun(engine, ["stop", "-t", "10", containerName(id)]);
      } catch (e) {
        await proc?.kill();
        throw e;
      }
    },
  };
}

/** Containers still running from an earlier session (MeiliOps crashed or was killed): take them back. */
async function adoptContainers() {
  for (const engine of ["docker", "podman"] as const) {
    if (!s.engines[engine]?.running) continue;
    let names: string[];
    try {
      names = (await engineRun(engine, ["ps", "--filter", "label=meiliops.instance", "--format", "{{.Names}}"])).split(/\s+/).filter(Boolean);
    } catch {
      continue;
    }
    for (const inst of s.instances) {
      if (engineOf(inst) !== engine || children.has(inst.id) || !names.includes(containerName(inst.id))) continue;
      const id = inst.id;
      s.setRuntime(id, { status: "running", logs: [`[reattached to running container ${containerName(id)}]`], startedAt: Date.now() });
      const cmd = await engineCmd(engine, ["logs", "-f", "--tail", "200", containerName(id)]);
      cmd.stdout.on("data", (l: string) => pushLog(id, l));
      cmd.stderr.on("data", (l: string) => pushLog(id, l));
      cmd.on("close", () => {
        children.delete(id);
        s.setRuntime(id, (r) => ({ ...r, status: "stopped" }));
      });
      const proc = await cmd.spawn();
      children.set(id, containerChild(engine, id, proc));
    }
  }
}

async function ensureConnection(inst: Instance, key: string | undefined) {
  // Keep a name/color the user gave the connection; only the URL and key follow the instance.
  const existing = connections.find((c) => c.id === inst.connectionId);
  const url = `http://127.0.0.1:${inst.port}`;
  const conn = await saveConnection(
    { id: existing?.id, name: existing?.name ?? `${inst.name} (local)`, url, color: existing?.color ?? "#00c7b7" },
    key ?? "",
  );
  if (inst.connectionId !== conn.id) await saveInstance({ ...s.instances.find((i) => i.id === inst.id)!, connectionId: conn.id });
  // It's the live connection and the port changed: the open client points at the old URL.
  if (activeId() === conn.id && existing && existing.url !== url) await connect(conn.id);
}

export async function stopInstance(id: string) {
  const child = children.get(id);
  if (!child) return;
  s.setRuntime(id, (r) => ({ ...r, status: "stopping" }));
  await child.kill();
}

/** Stop every managed instance (window close, installing an app update). */
export async function stopAllInstances() {
  await Promise.allSettled([...children.keys()].map(stopInstance));
}

/** Stop managed instances when the window closes so no orphans keep ports and DB locks. */
export async function stopAllOnExit() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    if (children.size === 0) return;
    event.preventDefault();
    await stopAllInstances();
    await win.destroy();
  });
}

/** Where an instance's data lives, for display. */
export async function dataLocation(inst: Instance): Promise<string> {
  const e = engineOf(inst);
  return e === "native" ? (await paths()).instanceDir(inst.id) : `${engineLabel(e)} volume ${volumeName(inst.id)}`;
}
