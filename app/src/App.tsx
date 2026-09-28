import { Match, Show, Switch, onMount } from "solid-js";
import Sidebar from "./views/Sidebar";
import StatusBar from "./views/StatusBar";
import { Toasts, Empty, Spinner } from "./components/ui";
import { loadConnections, server, setView, view } from "./state/app";
import ConnectionForm from "./views/ConnectionForm";
import OverviewView from "./views/OverviewView";
import IndexView from "./views/IndexView";
import TasksView from "./views/TasksView";
import BatchesView from "./views/BatchesView";
import KeysView from "./views/KeysView";
import ExperimentalView from "./views/ExperimentalView";
import WebhooksView from "./views/WebhooksView";
import ConsoleView from "./views/ConsoleView";
import "./styles.css";

export default function App() {
  onMount(loadConnections);

  const connected = () => server().status === "ready";

  return (
    <div class="app">
      <Sidebar />
      <main class="main">
        <Switch>
          <Match when={view().kind === "connection-form"}>
            <ConnectionForm id={(view() as { id?: string }).id} />
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
          <Match when={view().kind === "overview"}>
            <OverviewView />
          </Match>
          <Match when={view().kind === "index" && (view() as { uid: string }).uid}>
            {(uid) => <IndexView uid={uid()} />}
          </Match>
          <Match when={view().kind === "tasks"}>
            <TasksView />
          </Match>
          <Match when={view().kind === "batches"}>
            <BatchesView />
          </Match>
          <Match when={view().kind === "keys"}>
            <KeysView />
          </Match>
          <Match when={view().kind === "webhooks"}>
            <WebhooksView />
          </Match>
          <Match when={view().kind === "experimental"}>
            <ExperimentalView />
          </Match>
          <Match when={view().kind === "console"}>
            <ConsoleView />
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
      <p>Pick a connection on the left, or add a new one.</p>
      <button class="primary" onClick={() => setView({ kind: "connection-form" })}>
        + New connection
      </button>
    </Empty>
  );
}
