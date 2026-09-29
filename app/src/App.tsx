import { Component, For, Match, Show, Switch, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import Sidebar from "./views/Sidebar";
import TitleBar from "./views/TitleBar";
import StatusBar from "./views/StatusBar";
import { Toasts, Empty, Spinner, ViewBoundary } from "./components/ui";
import { View, connect, connections, loadConnections, server, setView, view } from "./state/app";
import ConnectionForm from "./views/ConnectionForm";
import OverviewView from "./views/OverviewView";
import IndexView from "./views/IndexView";
import TasksView from "./views/TasksView";
import BatchesView from "./views/BatchesView";
import KeysView from "./views/KeysView";
import ExperimentalView from "./views/ExperimentalView";
import WebhooksView from "./views/WebhooksView";
import ConsoleView from "./views/ConsoleView";
import MultiSearchView from "./views/MultiSearchView";
import LogsView from "./views/LogsView";
import MetricsView from "./views/MetricsView";
import ExportView from "./views/ExportView";
import ChatsView from "./views/ChatsView";
import SearchRulesView from "./views/SearchRulesView";
import InstancesView from "./views/instances/InstancesView";
import { loadInstances, stopAllOnExit } from "./state/instances";
import { trimMemoryWhenMinimized } from "./lib/platform";
import "./fonts.css";
import "./styles.css";
import { loadTheme } from "./state/theme";
import { IconPlus, IconServer } from "./components/icons";

/** Server-level screens that need an active connection. */
const CONNECTED_VIEWS: Partial<Record<View["kind"], Component>> = {
  overview: OverviewView,
  tasks: TasksView,
  batches: BatchesView,
  keys: KeysView,
  webhooks: WebhooksView,
  experimental: ExperimentalView,
  console: ConsoleView,
  "multi-search": MultiSearchView,
  logs: LogsView,
  metrics: MetricsView,
  export: ExportView,
  chats: ChatsView,
  "search-rules": SearchRulesView,
};

export default function App() {
  onMount(() => {
    loadTheme();
    loadConnections();
    loadInstances();
    stopAllOnExit();
    trimMemoryWhenMinimized();
  });

  const connected = () => server().status === "ready";

  return (
    <div class="app">
      <TitleBar />
      <Sidebar />
      <main class="main">
        <Switch>
          <Match when={view().kind === "connection-form"}>
            <ConnectionForm id={(view() as { id?: string }).id} />
          </Match>
          <Match when={view().kind === "instances"}>
            <InstancesView />
          </Match>
          <Match when={server().status === "connecting"}>
            <Empty title="Connecting…">
              <Spinner />
            </Empty>
          </Match>
          <Match when={server().status === "error"}>
            <Empty title="Connection failed">
              <p>{server().error}</p>
              <button onClick={() => setView({ kind: "welcome" })}>Back</button>
            </Empty>
          </Match>
          <Match when={!connected()}>
            <Welcome />
          </Match>
          <Match when={view().kind === "index" && (view() as { uid: string }).uid}>
            {(uid) => (
              <ViewBoundary>
                <IndexView uid={uid()} />
              </ViewBoundary>
            )}
          </Match>
          <Match when={CONNECTED_VIEWS[view().kind]} keyed>
            {(c) => (
              <ViewBoundary>
                <Dynamic component={c} />
              </ViewBoundary>
            )}
          </Match>
        </Switch>
      </main>
      <Show when={connected()}>
        <StatusBar />
      </Show>
      <Toasts />
    </div>
  );
}

function Welcome() {
  return (
    <div class="welcome">
      <img class="welcome-logo" src="/icon.svg" alt="" />
      <h1>MeiliOps</h1>
      <p class="muted">A fast, native admin app for Meilisearch.</p>
      <Show when={connections.length > 0}>
        <div class="welcome-conns">
          <For each={connections}>
            {(c) => (
              <button class="welcome-conn" onClick={() => connect(c.id)}>
                <span class="dot" style={{ background: c.color }} />
                <span class="grow ellipsis">
                  <b>{c.name}</b>
                  <span class="popover-sub">{c.url}</span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="row">
        <button class="primary" onClick={() => setView({ kind: "connection-form" })}>
          <IconPlus /> New connection
        </button>
        <button onClick={() => setView({ kind: "instances" })}>
          <IconServer /> Run Meilisearch locally
        </button>
      </div>
    </div>
  );
}
