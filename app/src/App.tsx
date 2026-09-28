import { Component, Match, Show, Switch, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import Sidebar from "./views/Sidebar";
import StatusBar from "./views/StatusBar";
import { Toasts, Empty, Spinner, ViewBoundary } from "./components/ui";
import { View, loadConnections, server, setView, view } from "./state/app";
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
import "./styles.css";

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
    loadConnections();
    loadInstances();
    stopAllOnExit();
  });

  const connected = () => server().status === "ready";

  return (
    <div class="app">
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
    <Empty title="MeiliOps">
      <p>A native admin app for Meilisearch.</p>
      <p>Pick a connection on the left, add a new one, or run Meilisearch locally.</p>
      <div class="row">
        <button class="primary" onClick={() => setView({ kind: "connection-form" })}>
          + New connection
        </button>
        <button onClick={() => setView({ kind: "instances" })}>Local instances</button>
      </div>
    </Empty>
  );
}
