import { Component, For, Match, Show, Switch, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import Sidebar from "./views/Sidebar";
import TitleBar from "./views/TitleBar";
import StatusBar from "./views/StatusBar";
import { Toasts, Empty, Spinner, ViewBoundary } from "./components/ui";
import { View, activeConnection, activeId, connect, connected, connections, disconnect, loadConnections, openConnectionForm, retryNow, server, setView, view } from "./state/app";
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
import { IconPencil, IconPlus, IconRefresh, IconServer, IconUnplug } from "./components/icons";

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

  return (
    <div class="app">
      <TitleBar />
      <Sidebar />
      <main class="main">
        <Show when={server().status === "lost" && view().kind !== "connection-form" && view().kind !== "instances"}>
          <div class="lost-banner">
            <span class="spinner tiny" />
            <span class="grow">
              <b>{server().error}</b> <span class="muted">Retrying every few seconds. Your page is kept.</span>
            </span>
            <button onClick={retryNow}>
              <IconRefresh /> Retry now
            </button>
            <button onClick={() => disconnect()}>
              <IconUnplug /> Disconnect
            </button>
          </div>
        </Show>
        <Switch>
          {/* Keyed on the view object: opening another connection's form remounts it with that connection's fields. */}
          <Match when={view().kind === "connection-form" && (view() as { kind: "connection-form"; id?: string })} keyed>
            {(v) => <ConnectionForm id={v.id} />}
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
            <Empty title={`Couldn't connect to ${activeConnection()?.name ?? "server"}`}>
              <p class="muted">{server().error}</p>
              <div class="row">
                <button class="primary" onClick={() => connect(activeId()!)}>
                  <IconRefresh /> Retry
                </button>
                <button onClick={() => openConnectionForm(activeId())}>
                  <IconPencil /> Edit connection
                </button>
                <button onClick={() => disconnect()}>Back</button>
              </div>
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
          {/* Any other view while connected (e.g. "welcome") shows the Overview instead of a blank page. */}
          <Match when={CONNECTED_VIEWS[view().kind] ?? OverviewView} keyed>
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
        <button class="primary" onClick={() => openConnectionForm()}>
          <IconPlus /> New connection
        </button>
        <button onClick={() => setView({ kind: "instances" })}>
          <IconServer /> Run Meilisearch locally
        </button>
      </div>
    </div>
  );
}
