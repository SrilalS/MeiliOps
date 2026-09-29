import { Component, For, Show, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { activeId, connect, connected, connections, indexes, openConnectionForm, refreshIndexes, setView, view, View } from "../state/app";
import { formatNumber } from "../components/ui";
import CreateIndexDialog from "./CreateIndexDialog";
import { runningCount } from "../state/instances";
import {
  IconActivity,
  IconDatabase,
  IconExport,
  IconFlask,
  IconKey,
  IconLayers,
  IconLogs,
  IconMessages,
  IconOverview,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconRules,
  IconSearch,
  IconServer,
  IconTasks,
  IconTerminal,
  IconWebhook,
} from "../components/icons";

type NavItem = { kind: View["kind"]; label: string; icon: Component<{ class?: string }> };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Server",
    items: [
      { kind: "overview", label: "Overview", icon: IconOverview },
      { kind: "tasks", label: "Tasks", icon: IconTasks },
      { kind: "batches", label: "Batches", icon: IconLayers },
      { kind: "metrics", label: "Metrics", icon: IconActivity },
      { kind: "logs", label: "Logs", icon: IconLogs },
    ],
  },
  {
    group: "Search",
    items: [
      { kind: "multi-search", label: "Multi-search", icon: IconSearch },
      { kind: "search-rules", label: "Search rules", icon: IconRules },
      { kind: "chats", label: "Chats", icon: IconMessages },
    ],
  },
  {
    group: "Admin",
    items: [
      { kind: "keys", label: "API keys", icon: IconKey },
      { kind: "webhooks", label: "Webhooks", icon: IconWebhook },
      { kind: "export", label: "Export", icon: IconExport },
      { kind: "experimental", label: "Experimental", icon: IconFlask },
      { kind: "console", label: "API console", icon: IconTerminal },
    ],
  },
];

export default function Sidebar() {
  const [filter, setFilter] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const filtered = () => indexes().filter((i) => i.uid.toLowerCase().includes(filter().toLowerCase()));

  return (
    <aside class="sidebar">
      {/* Disconnected: pick a connection here. Connected: the title bar switches connections. */}
      <Show when={!connected()}>
        <div class="sidebar-section">
          <div class="sidebar-title">
            <span>Connections</span>
            <button class="icon-btn" title="New connection" onClick={() => openConnectionForm()}>
              <IconPlus />
            </button>
          </div>
          <For each={connections} fallback={<div class="muted small pad">No connections yet</div>}>
            {(c) => (
              <div class="nav-item conn-item" classList={{ active: activeId() === c.id }} onClick={() => connect(c.id)} title={c.url}>
                <span class="nav-icon">
                  <span class="dot" style={{ background: c.color }} />
                </span>
                <span class="grow ellipsis">{c.name}</span>
                <button
                  class="icon-btn subtle"
                  title="Edit connection"
                  onClick={(e) => {
                    e.stopPropagation();
                    openConnectionForm(c.id);
                  }}
                >
                  <IconPencil />
                </button>
              </div>
            )}
          </For>
          <div class="nav-item" classList={{ active: view().kind === "instances" }} onClick={() => setView({ kind: "instances" })} title="Run Meilisearch on this computer">
            <IconServer class="nav-icon" />
            <span class="grow">Local instances</span>
            <Show when={runningCount() > 0}>
              <span class="pill status-succeeded">{runningCount()}</span>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={connected()}>
        <nav class="sidebar-section">
          <For each={NAV}>
            {(g) => (
              <>
                <div class="nav-group">{g.group}</div>
                <For each={g.items}>
                  {(n) => (
                    <div class="nav-item" classList={{ active: view().kind === n.kind }} onClick={() => setView({ kind: n.kind } as View)}>
                      <Dynamic component={n.icon} class="nav-icon" />
                      <span class="grow ellipsis">{n.label}</span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </nav>

        <div class="sidebar-section">
          <div class="sidebar-title">
            <span>
              Indexes <span class="count">{indexes().length}</span>
            </span>
            <span class="row gap-2">
              <button class="icon-btn" title="Refresh" onClick={refreshIndexes}>
                <IconRefresh />
              </button>
              <button class="icon-btn" title="Create index" onClick={() => setCreating(true)}>
                <IconPlus />
              </button>
            </span>
          </div>
          <Show when={indexes().length > 6}>
            <input class="sidebar-filter" placeholder="Filter indexes…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          </Show>
          <For each={filtered()} fallback={<div class="muted small pad">No indexes</div>}>
            {(i) => {
              const v = view();
              return (
                <div
                  class="nav-item"
                  classList={{ active: view().kind === "index" && (view() as { uid: string }).uid === i.uid }}
                  onClick={() => setView({ kind: "index", uid: i.uid, tab: v.kind === "index" ? v.tab : "documents" })}
                  title={i.uid}
                >
                  <IconDatabase class="nav-icon" />
                  <span class="grow ellipsis">{i.uid}</span>
                  <Show when={i.isIndexing}>
                    <span class="spinner tiny" title="Indexing" />
                  </Show>
                  <span class="nav-count">{formatNumber(i.numberOfDocuments)}</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={creating()}>
        <CreateIndexDialog onClose={() => setCreating(false)} />
      </Show>
    </aside>
  );
}
