import { For, Show, createSignal } from "solid-js";
import { activeConnection, activity, runningActivities, server, setView } from "../state/app";
import { StatusPill } from "../components/ui";

export default function StatusBar() {
  const [open, setOpen] = createSignal(false);
  return (
    <footer class="statusbar">
      <span class="dot" style={{ background: activeConnection()?.color }} />
      <span>{activeConnection()?.name}</span>
      <span class="muted">{activeConnection()?.url}</span>
      <span class="muted">Meilisearch {server().version?.pkgVersion}</span>
      <Show when={server().status === "lost"}>
        <span class="pill status-enqueued">reconnecting</span>
      </Show>
      <span class="grow" />
      <button class="link" onClick={() => setOpen(!open())}>
        <Show when={runningActivities() > 0} fallback={<>Activity ({activity.length})</>}>
          <span class="spinner tiny" /> {runningActivities()} running
        </Show>
      </button>
      <Show when={open()}>
        <div class="activity-pop">
          <div class="activity-head">
            <b>Recent activity</b>
            <button class="link" onClick={() => setView({ kind: "tasks" })}>
              All tasks →
            </button>
          </div>
          <For each={activity} fallback={<div class="muted pad">Nothing yet</div>}>
            {(a) => (
              <div class="activity-row">
                <StatusPill status={a.status} />
                <span class="grow ellipsis" title={a.error ?? a.label}>
                  {a.label}
                </span>
                <Show when={a.taskUid !== undefined}>
                  <span class="muted small">#{a.taskUid}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </footer>
  );
}
