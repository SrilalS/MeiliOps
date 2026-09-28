import { Match, Switch } from "solid-js";
import { IndexTab, indexes, setView, view } from "../state/app";
import { Tabs, formatNumber } from "../components/ui";
import DocumentsTab from "./index/DocumentsTab";
import SearchTab from "./index/SearchTab";
import SettingsTab from "./index/SettingsTab";
import IndexOverviewTab from "./index/IndexOverviewTab";

const TABS: { id: IndexTab; label: string }[] = [
  { id: "documents", label: "Documents" },
  { id: "search", label: "Search" },
  { id: "settings", label: "Settings" },
  { id: "overview", label: "Index info" },
];

export default function IndexView(props: { uid: string }) {
  const tab = () => (view() as { tab: IndexTab }).tab ?? "documents";
  const info = () => indexes().find((i) => i.uid === props.uid);

  return (
    <div class="page index-page">
      <div class="page-head">
        <h2>{props.uid}</h2>
        <span class="muted">
          {formatNumber(info()?.numberOfDocuments)} documents · primary key <code>{info()?.primaryKey ?? "—"}</code>
        </span>
      </div>
      <Tabs tabs={TABS} value={tab()} onChange={(t) => setView({ kind: "index", uid: props.uid, tab: t })} />
      {/* Keyed on uid so every tab resets cleanly when switching indexes. */}
      <Switch>
        <Match when={tab() === "documents" && props.uid} keyed>
          {(uid) => <DocumentsTab uid={uid} />}
        </Match>
        <Match when={tab() === "search" && props.uid} keyed>
          {(uid) => <SearchTab uid={uid} />}
        </Match>
        <Match when={tab() === "settings" && props.uid} keyed>
          {(uid) => <SettingsTab uid={uid} />}
        </Match>
        <Match when={tab() === "overview" && props.uid} keyed>
          {(uid) => <IndexOverviewTab uid={uid} />}
        </Match>
      </Switch>
    </div>
  );
}
