import { For, Show, createSignal } from "solid-js";
import { activeId, connect, connections, indexes, refreshIndexes, server, setView, view, View } from "../state/app";
import { formatNumber } from "../components/ui";
import CreateIndexDialog from "./CreateIndexDialog";

const NAV: { kind: View["kind"]; label: string; icon: string }[] = [
  { kind: "overview", label: "Overview", icon: "◎" },
  { kind: "tasks", label: "Tasks", icon: "⏱" },
  { kind: "batches", label: "Batches", icon: "▤" },
  { kind: "keys", label: "API keys", icon: "⚿" },
  { kind: "webhooks", label: "Webhooks", icon: "↗" },
  { kind: "experimental", label: "Experimental", icon: "⚗" },
  { kind: "console", label: "API console", icon: "›_" },
];

export default function Sidebar() {
  const [filter, setFilter] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const connected = () => server().status === "ready";
  const filtered = () => indexes().filter((i) => i.uid.toLowerCase().includes(filter().toLowerCase()));

  return (
    <aside class="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-title">
          <span>Connections</span>
          <button class="icon-btn" title="New connection" onClick={() => setView({ kind: "connection-form" })}>
            +
          </button>
        </div>
        <For each={connections} fallback={<div class="muted small pad">No connections yet</div>}>
          {(c) => (
            <div class="conn-item" classList={{ active: activeId() === c.id }} onClick={() => connect(c.id)} title={c.url}>
              <span class="dot" style={{ background: c.color }} />
              <span class="grow ellipsis">{c.name}</span>
              <button
                class="icon-btn subtle"
                title="Edit connection"
                onClick={(e) => {
                  e.stopPropagation();
                  setView({ kind: "connection-form", id: c.id });
                }}
              >
                ✎
              </button>
            </div>
          )}
        </For>
      </div>

      <Show when={connected()}>
        <div class="sidebar-section">
          <For each={NAV}>
            {(n) => (
              <div class="nav-item" classList={{ active: view().kind === n.kind }} onClick={() => setView({ kind: n.kind } as View)}>
                <span class="nav-icon">{n.icon}</span>
                {n.label}
              </div>
            )}
          </For>
        </div>

        <div class="sidebar-section grow-section">
          <div class="sidebar-title">
            <span>Indexes ({indexes().length})</span>
            <span>
              <button class="icon-btn" title="Refresh" onClick={refreshIndexes}>
                ↻
              </button>
              <button class="icon-btn" title="Create index" onClick={() => setCreating(true)}>
                +
              </button>
            </span>
          </div>
          <input class="sidebar-filter" placeholder="Filter indexes…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          <div class="index-list">
            <For each={filtered()}>
              {(i) => {
                const v = view();
                return (
                  <div
                    class="index-item"
                    classList={{ active: view().kind === "index" && (view() as { uid: string }).uid === i.uid }}
                    onClick={() => setView({ kind: "index", uid: i.uid, tab: v.kind === "index" ? v.tab : "documents" })}
                    title={i.uid}
                  >
                    <span class="grow ellipsis">{i.uid}</span>
                    <Show when={i.isIndexing}>
                      <span class="spinner tiny" title="Indexing" />
                    </Show>
                    <span class="muted small">{formatNumber(i.numberOfDocuments)}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
      <Show when={creating()}>
        <CreateIndexDialog onClose={() => setCreating(false)} />
      </Show>
    </aside>
  );
}
