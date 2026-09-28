import { For, Show, createSignal, onMount } from "solid-js";
import { isTauri } from "../../lib/platform";
import { connect } from "../../state/app";
import { Confirm, Empty, StatusPill, formatBytes } from "../../components/ui";
import {
  Instance,
  Release,
  binary,
  deleteInstance,
  installBinary,
  instances,
  latestRelease,
  newInstanceTemplate,
  refreshBinary,
  rt,
  startInstance,
  stopInstance,
} from "../../state/instances";
import { notify, notifyError } from "../../state/app";
import InstanceDialog from "./InstanceDialog";

export default function InstancesView() {
  if (!isTauri)
    return (
      <Empty title="Local instances">
        Running Meilisearch locally needs the desktop app (<code>npm run tauri dev</code>).
      </Empty>
    );

  const [release, setRelease] = createSignal<Release>();
  const [checking, setChecking] = createSignal(false);
  const [progress, setProgress] = createSignal<{ phase: string; done: number; total: number }>();
  const [editing, setEditing] = createSignal<{ inst: Instance; isNew: boolean }>();
  const [deleting, setDeleting] = createSignal<Instance>();
  const [logsFor, setLogsFor] = createSignal<string>();
  let logBox: HTMLDivElement | undefined;

  const check = async () => {
    setChecking(true);
    try {
      setRelease(await latestRelease());
    } catch (e) {
      notifyError(e, "Checking for releases");
    } finally {
      setChecking(false);
    }
  };
  onMount(() => {
    if (!binary().checked) refreshBinary();
    check();
  });

  const install = async () => {
    const rel = release();
    if (!rel) return;
    try {
      await installBinary(rel, (phase, done, total) => setProgress({ phase, done, total }));
      notify("success", `Meilisearch ${rel.version} installed`);
    } catch (e) {
      notifyError(e, "Install failed");
    } finally {
      setProgress(undefined);
    }
  };

  const updateAvailable = () => release() && binary().version && release()!.version !== binary().version;

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
        <span class="muted small">Run and manage Meilisearch on this computer.</span>
        <span class="grow" />
        <button class="primary" disabled={!binary().path} onClick={() => setEditing({ inst: newInstanceTemplate(), isNew: true })}>
          + New instance
        </button>
      </div>

      <div class="card">
        <div class="row">
          <div class="grow">
            <b>Meilisearch binary</b>
            <div class="muted small">
              <Show when={binary().checked} fallback="Checking…">
                <Show when={binary().version} fallback="Not installed">
                  Installed: <b>v{binary().version}</b> <span class="mono">{binary().path}</span>
                </Show>
              </Show>
            </div>
            <Show when={release()}>
              <div class="muted small">
                Latest stable: <b>{release()!.tag}</b> · {new Date(release()!.publishedAt).toLocaleDateString()} · {formatBytes(release()!.size)} ·{" "}
                {release()!.sha256 ? "SHA-256 verified on download" : "no checksum published"} · Community edition (MIT)
              </div>
            </Show>
          </div>
          <button onClick={check} disabled={checking()}>
            {checking() ? "Checking…" : "Check for updates"}
          </button>
          <Show when={release() && (!binary().version || updateAvailable())}>
            <button class="primary" disabled={!!progress()} onClick={install}>
              {binary().version ? `Update to ${release()!.tag}` : `Install ${release()!.tag}`}
            </button>
          </Show>
        </div>
        <Show when={progress()}>
          <div class="progress" style={{ "margin-top": "8px" }}>
            <span class="progress-bar" style={{ width: `${progress()!.total ? (progress()!.done / progress()!.total) * 100 : 0}%` }} />
            <span class="progress-label">
              {progress()!.phase} · {formatBytes(progress()!.done)} / {formatBytes(progress()!.total)}
            </span>
          </div>
        </Show>
        <Show when={updateAvailable()}>
          <div class="warn small">Updating stops nothing automatically. Stop running instances first. Each instance's database is upgraded in place (--upgrade-db) on its next start.</div>
        </Show>
      </div>

      <table class="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Status</th>
            <th>Env</th>
            <th>Flags</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={instances} fallback={<tr><td colspan="6" class="muted">No instances yet{binary().path ? "" : ". Install the binary first"}.</td></tr>}>
            {(inst) => {
              const r = () => rt(inst.id);
              const live = () => r().status === "running" || r().status === "starting" || r().status === "stopping";
              return (
                <tr classList={{ selected: logsFor() === inst.id }}>
                  <td>
                    <b>{inst.name}</b>
                    <Show when={inst.upgradeOnNextStart}>
                      <span class="pill status-enqueued" title="Database will be upgraded with --upgrade-db on next start">
                        upgrade pending
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
                    <Show when={!live()} fallback={<button onClick={() => stopInstance(inst.id)}>■ Stop</button>}>
                      <button class="primary" disabled={!binary().path} onClick={() => start(inst.id)}>
                        ▶ Start
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

      <Show when={logsFor()}>
        {(id) => (
          <div class="log-panel">
            <div class="side-head">
              <b>Logs — {instances.find((i) => i.id === id())?.name}</b>
              <span class="grow" />
              <button class="icon-btn" onClick={() => setLogsFor(undefined)}>
                ✕
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
        <InstanceDialog initial={editing()!.inst} isNew={editing()!.isNew} onClose={() => setEditing(undefined)} />
      </Show>
      <Show when={deleting()}>
        <DeleteInstance inst={deleting()!} onClose={() => setDeleting(undefined)} />
      </Show>
    </div>
  );
}

function DeleteInstance(props: { inst: Instance; onClose: () => void }) {
  const [wipe, setWipe] = createSignal(false);
  return (
    <Confirm
      title="Delete instance"
      message={
        <>
          Remove “{props.inst.name}” from MeiliOps.
          <label class="inline-label" style={{ display: "flex", "margin-top": "10px" }}>
            <input type="checkbox" checked={wipe()} onChange={(e) => setWipe(e.currentTarget.checked)} /> Also delete its data directory (all indexes, dumps and snapshots)
          </label>
        </>
      }
      typeToConfirm={wipe() ? props.inst.name : undefined}
      onClose={props.onClose}
      onConfirm={() => deleteInstance(props.inst.id, wipe())}
    />
  );
}
