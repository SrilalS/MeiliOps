import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js";
import { isTauri } from "../../lib/platform";
import { connect } from "../../state/app";
import { Confirm, Empty, StatusPill, formatBytes } from "../../components/ui";
import {
  Engine,
  EngineInfo,
  Instance,
  Release,
  deleteInstance,
  engineLabel,
  engineOf,
  engineReady,
  engines,
  installVersion,
  installedVersions,
  instances,
  isLive,
  listReleases,
  newInstanceTemplate,
  Leftover,
  findLeftovers,
  refreshEngines,
  removeLeftover,
  refreshVersions,
  removeImage,
  removeVersion,
  rt,
  startInstance,
  stopInstance,
  upgradePlan,
  versionsChecked,
} from "../../state/instances";
import { notify, notifyError } from "../../state/app";
import InstanceDialog from "./InstanceDialog";
import { IconContainer, IconDownload, IconHardDrive, IconPlay, IconPlus, IconRefresh, IconStop, IconTrash, IconX } from "../../components/icons";

export default function InstancesView() {
  if (!isTauri)
    return (
      <Empty title="Local instances">
        Running Meilisearch locally needs the desktop app (<code>npm run tauri dev</code>).
      </Empty>
    );

  const [releases, setReleases] = createSignal<Release[]>([]);
  const [editing, setEditing] = createSignal<{ inst: Instance; isNew: boolean }>();
  const [deleting, setDeleting] = createSignal<Instance>();
  const [logsFor, setLogsFor] = createSignal<string>();
  let logBox: HTMLDivElement | undefined;

  const loadReleases = async () => {
    try {
      setReleases(await listReleases());
    } catch (e) {
      notifyError(e, "Checking for releases");
    }
  };
  onMount(() => {
    if (!versionsChecked()) refreshVersions();
    if (!engines.checked) refreshEngines();
    loadReleases();
  });

  const latest = createMemo(() => releases().find((r) => !r.prerelease)?.version);
  const canCreate = () => installedVersions().length > 0 || engineReady("docker") || engineReady("podman");

  const start = async (id: string) => {
    setLogsFor(id);
    try {
      await startInstance(id);
    } catch (e) {
      notifyError(e, "Start failed");
    }
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Local instances</h2>
        <span class="muted small">Run and manage Meilisearch on this computer, natively or in Docker / Podman.</span>
        <span class="grow" />
        <button class="primary" disabled={!canCreate()} onClick={() => setEditing({ inst: newInstanceTemplate(), isNew: true })}>
          <IconPlus /> New instance
        </button>
      </div>

      <div class="engine-grid">
        <VersionsCard releases={releases()} latest={latest()} onReload={loadReleases} />
        <EnginesCard />
      </div>

      <table class="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Runs on</th>
            <th>Address</th>
            <th>Status</th>
            <th>Env</th>
            <th>Flags</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={instances} fallback={<tr><td colspan="7" class="muted">No instances yet{canCreate() ? "" : ". Install a Meilisearch version or start Docker / Podman first"}.</td></tr>}>
            {(inst) => {
              const r = () => rt(inst.id);
              const live = () => isLive(r().status);
              const plan = () => upgradePlan(inst);
              return (
                <tr classList={{ selected: logsFor() === inst.id }}>
                  <td>
                    <b>{inst.name}</b>
                    <Show when={!live() && plan().upgrade}>
                      {" "}
                      <span class="pill status-enqueued" title={`The data is upgraded in place (--upgrade-db) from ${inst.dataVersion?.[engineOf(inst)]} on the next start`}>
                        upgrade on start
                      </span>
                    </Show>
                    <Show when={plan().error}>
                      {" "}
                      <span class="pill status-failed" title={plan().error}>
                        version conflict
                      </span>
                    </Show>
                  </td>
                  <td class="small nowrap">
                    <span class="engine-tag">
                      {engineOf(inst) === "native" ? <IconHardDrive /> : <IconContainer />}
                      {engineLabel(inst.engine)}
                    </span>{" "}
                    <span class="mono">{inst.version ? `v${inst.version}` : "no version"}</span>
                    <Show when={latest() && inst.version && inst.version !== latest()}>
                      {" "}
                      <span class="pill" title={`Edit the instance to move it to ${latest()}`}>
                        v{latest()} available
                      </span>
                    </Show>
                  </td>
                  <td class="mono small">127.0.0.1:{inst.port}</td>
                  <td>
                    <StatusPill status={r().status} />
                    <Show when={r().pid}>
                      <span class="muted small"> pid {r().pid}</span>
                    </Show>
                  </td>
                  <td class="small">{inst.env}</td>
                  <td class="small mono">{Object.keys(inst.flags).filter((k) => inst.flags[k] !== false).length || "—"}</td>
                  <td class="nowrap">
                    <Show
                      when={!live()}
                      fallback={
                        <button disabled={r().status === "stopping"} onClick={() => stopInstance(inst.id).catch((e) => notifyError(e, "Stop failed"))}>
                          <IconStop /> Stop
                        </button>
                      }
                    >
                      <button class="primary" disabled={!inst.version || !engineReady(engineOf(inst)) || !!plan().error} onClick={() => start(inst.id)}>
                        <IconPlay /> Start
                      </button>
                    </Show>{" "}
                    <button disabled={r().status !== "running" || !inst.connectionId} onClick={() => connect(inst.connectionId!)}>
                      Open
                    </button>{" "}
                    <button onClick={() => setLogsFor(logsFor() === inst.id ? undefined : inst.id)}>Logs</button>{" "}
                    <button disabled={live()} onClick={() => setEditing({ inst: JSON.parse(JSON.stringify(inst)), isNew: false })}>
                      Edit
                    </button>{" "}
                    <button class="danger" disabled={live()} onClick={() => setDeleting(inst)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>

      <LeftoverData />

      <Show when={instances.some((i) => i.id === logsFor()) && logsFor()}>
        {(id) => (
          <div class="log-panel">
            <div class="side-head">
              <b>Logs — {instances.find((i) => i.id === id())?.name}</b>
              <span class="grow" />
              <button class="icon-btn" onClick={() => setLogsFor(undefined)}>
                <IconX />
              </button>
            </div>
            <div
              class="log-box"
              ref={(el) => {
                logBox = el;
              }}
            >
              <For each={rt(id()).logs}>
                {(l) => {
                  queueMicrotask(() => logBox && (logBox.scrollTop = logBox.scrollHeight));
                  return <div class={`log-line ${/ERROR/.test(l) ? "err" : /WARN/.test(l) ? "warn" : ""}`}>{l}</div>;
                }}
              </For>
            </div>
          </div>
        )}
      </Show>

      <Show when={editing()}>
        <InstanceDialog initial={editing()!.inst} isNew={editing()!.isNew} releases={releases()} onClose={() => setEditing(undefined)} />
      </Show>
      <Show when={deleting()}>
        <DeleteInstance inst={deleting()!} onClose={() => setDeleting(undefined)} />
      </Show>
    </div>
  );
}

/** Native binaries: install any release side by side, remove unused ones. */
function VersionsCard(props: { releases: Release[]; latest?: string; onReload: () => void }) {
  const [pre, setPre] = createSignal(false);
  const [pick, setPick] = createSignal<string>();
  const [progress, setProgress] = createSignal<{ phase: string; done: number; total: number }>();
  const [removing, setRemoving] = createSignal<string>();

  const choices = createMemo(() => props.releases.filter((r) => r.url && (pre() || !r.prerelease)));
  const selected = () => choices().find((r) => r.version === (pick() ?? props.latest)) ?? choices()[0];
  const usedBy = (v: string) => instances.filter((i) => engineOf(i) === "native" && i.version === v).length;

  const install = async () => {
    const rel = selected();
    if (!rel) return;
    try {
      await installVersion(rel, (phase, done, total) => setProgress({ phase, done, total }));
      notify("success", `Meilisearch ${rel.version} installed`);
    } catch (e) {
      notifyError(e, "Install failed");
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <div class="card">
      <div class="row">
        <IconHardDrive />
        <b class="grow">Native versions</b>
        <button class="icon-btn" title="Reload releases" onClick={props.onReload}>
          <IconRefresh />
        </button>
      </div>
      <div class="version-list">
        <For each={installedVersions()} fallback={<div class="muted small">{versionsChecked() ? "None installed." : "Checking…"}</div>}>
          {(v) => (
            <div class="version-row">
              <span class="mono">v{v}</span>
              <Show when={v === props.latest}>
                <span class="pill status-succeeded">latest</span>
              </Show>
              <span class="muted small grow">{usedBy(v) ? `${usedBy(v)} instance${usedBy(v) > 1 ? "s" : ""}` : "unused"}</span>
              <button class="icon-btn" title={`Remove v${v}`} onClick={() => setRemoving(v)}>
                <IconTrash />
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="row">
        <select class="grow" value={selected()?.version ?? ""} onChange={(e) => setPick(e.currentTarget.value)} disabled={!choices().length}>
          <For each={choices()} fallback={<option>Loading releases…</option>}>
            {(r) => (
              <option value={r.version}>
                {r.tag}
                {r.prerelease ? " (pre-release)" : r.version === props.latest ? " (latest)" : ""}
                {installedVersions().includes(r.version) ? " · installed" : ""}
              </option>
            )}
          </For>
        </select>
        <label class="inline-label">
          <input type="checkbox" checked={pre()} onChange={(e) => setPre(e.currentTarget.checked)} /> pre-releases
        </label>
        <button class="primary" disabled={!selected() || !!progress()} onClick={install}>
          <IconDownload /> {selected() && installedVersions().includes(selected()!.version) ? "Reinstall" : "Install"}
        </button>
      </div>
      <Show when={progress()}>
        <div class="progress">
          <span class="progress-bar" style={{ width: `${progress()!.total ? (progress()!.done / progress()!.total) * 100 : 0}%` }} />
          <span class="progress-label">
            {progress()!.phase} · {formatBytes(progress()!.done)} / {formatBytes(progress()!.total)}
          </span>
        </div>
      </Show>
      <div class="muted small">
        Community edition (MIT) from GitHub{selected()?.sha256 ? ", SHA-256 verified" : ""}. Versions install side by side; each instance picks its own.
      </div>
      <Show when={removing()}>
        <Confirm
          title="Remove version"
          message={
            <>
              Delete the Meilisearch v{removing()} binary.{" "}
              {usedBy(removing()!) ? `${usedBy(removing()!)} instance(s) use it and won't start until you reinstall it or pick another version.` : "No instance uses it."} Instance data is not touched.
            </>
          }
          onClose={() => setRemoving(undefined)}
          onConfirm={() => removeVersion(removing()!).catch((e) => notifyError(e, "Remove failed"))}
        />
      </Show>
    </div>
  );
}

/** Docker / Podman availability and pulled images. */
function EnginesCard() {
  const [busy, setBusy] = createSignal(false);
  const refresh = async () => {
    setBusy(true);
    await refreshEngines().finally(() => setBusy(false));
  };
  const row = (engine: "docker" | "podman", info: EngineInfo | undefined) => (
    <div class="engine-row">
      <div class="row">
        <b>{engineLabel(engine)}</b>
        <Show when={engines.checked} fallback={<span class="muted small">Checking…</span>}>
          <Show when={info} fallback={<span class="muted small">Not found</span>}>
            <span class="mono small">{info!.version}</span>
            <span class={`pill ${info!.running ? "status-succeeded" : "status-enqueued"}`}>{info!.running ? "running" : "not running"}</span>
          </Show>
        </Show>
      </div>
      <Show when={info && !info.running}>
        <div class="muted small">{engine === "podman" ? "Start the Podman machine (podman machine start), then refresh." : "Start Docker Desktop or the Docker daemon, then refresh."}</div>
      </Show>
      <Show when={info?.running}>
        <div class="chips">
          <For each={info!.images} fallback={<span class="muted small">No Meilisearch images yet. They're pulled on first start.</span>}>
            {(v) => (
              <span class="chip mono">
                v{v}
                <button
                  class="chip-x"
                  title={`Remove image v${v}`}
                  disabled={instances.some((i) => engineOf(i) === engine && i.version === v && isLive(rt(i.id).status))}
                  onClick={() => removeImage(engine, v).catch((e) => notifyError(e, "Removing the image"))}
                >
                  <IconX />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
  return (
    <div class="card">
      <div class="row">
        <IconContainer />
        <b class="grow">Container engines</b>
        <button class="icon-btn" title="Detect again" disabled={busy()} onClick={refresh}>
          <IconRefresh />
        </button>
      </div>
      {row("docker", engines.docker)}
      {row("podman", engines.podman)}
      <div class="muted small">Runs the official getmeili/meilisearch image. Data lives in a named volume per instance.</div>
    </div>
  );
}

/**
 * Data folders and volumes no instance owns: instances deleted with "keep data", or data an
 * orphaned process kept locked. Re-scanned whenever the instance list or the engines change.
 */
function LeftoverData() {
  const [leftovers, { refetch }] = createResource(
    () => [instances.length, engines.docker?.running, engines.podman?.running] as const,
    () => findLeftovers().catch(() => [] as Leftover[]),
  );
  const [removing, setRemoving] = createSignal<Leftover>();
  const label = (l: Leftover) => (l.engine === "native" ? "Data folder" : `${engineLabel(l.engine)} volume`);
  return (
    <Show when={leftovers()?.length}>
      <div class="card leftovers">
        <div class="row">
          <b class="grow">Leftover data</b>
          <span class="muted small">Not used by any instance: kept when an instance was deleted without its data.</span>
        </div>
        <For each={leftovers()}>
          {(l) => (
            <div class="version-row">
              <span class="small">{label(l)}</span>
              <span class="mono small grow ellipsis">{l.name}</span>
              <button class="icon-btn" title="Delete" onClick={() => setRemoving(l)}>
                <IconTrash />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={removing()}>
        <Confirm
          title="Delete leftover data"
          message={
            <>
              Permanently delete {label(removing()!).toLowerCase()} <code>{removing()!.name}</code>, with all its indexes, dumps and snapshots.
            </>
          }
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            await removeLeftover(removing()!);
            refetch();
          }}
        />
      </Show>
    </Show>
  );
}

function DeleteInstance(props: { inst: Instance; onClose: () => void }) {
  const [wipe, setWipe] = createSignal(false);
  const where = () => {
    const e = Object.keys(props.inst.dataVersion ?? {}) as Engine[];
    return e.length ? e.map((x) => (x === "native" ? "data folder" : `${engineLabel(x)} volume`)).join(", ") : "data";
  };
  return (
    <Confirm
      title="Delete instance"
      message={
        <>
          Remove “{props.inst.name}” from MeiliOps.
          <label class="inline-label" style={{ display: "flex", "margin-top": "10px" }}>
            <input type="checkbox" checked={wipe()} onChange={(e) => setWipe(e.currentTarget.checked)} /> Also delete its {where()} (all indexes, dumps and snapshots)
          </label>
        </>
      }
      typeToConfirm={wipe() ? props.inst.name : undefined}
      onClose={props.onClose}
      onConfirm={() => deleteInstance(props.inst.id, wipe())}
    />
  );
}
