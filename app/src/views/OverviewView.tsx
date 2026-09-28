import { For, Show, createResource } from "solid-js";
import { api, refreshIndexes, server, setView, trackTask } from "../state/app";
import { Spinner, Stat, formatBytes, formatDate, formatNumber } from "../components/ui";

interface GlobalStats {
  databaseSize: number;
  usedDatabaseSize?: number;
  lastUpdate: string | null;
  indexes: Record<string, { numberOfDocuments: number; isIndexing: boolean; fieldDistribution: Record<string, number>; numberOfEmbeddedDocuments?: number; numberOfEmbeddings?: number }>;
}

export default function OverviewView() {
  const [health] = createResource(() => api().req("GET", "/health").catch((e) => ({ status: String(e.message ?? e) })));
  const [stats, { refetch }] = createResource(() => api().req<GlobalStats>("GET", "/stats"));

  const snapshot = () => trackTask(api().req("POST", "/snapshots"), "Create snapshot");
  const dump = () => trackTask(api().req("POST", "/dumps"), "Create dump");

  return (
    <div class="page">
      <div class="page-head">
        <h2>Overview</h2>
        <span class="grow" />
        <button
          onClick={() => {
            refetch();
            refreshIndexes();
          }}
        >
          ↻ Refresh
        </button>
        <button onClick={dump}>Create dump</button>
        <button onClick={snapshot}>Create snapshot</button>
      </div>

      <div class="stats-row">
        <Stat label="Health" value={<span class={health()?.status === "available" ? "ok" : "err"}>{health()?.status ?? "…"}</span>} />
        <Stat label="Version" value={server().version?.pkgVersion ?? "—"} />
        <Stat label="Indexes" value={formatNumber(stats() ? Object.keys(stats()!.indexes).length : undefined)} />
        <Stat label="Documents" value={formatNumber(stats() ? Object.values(stats()!.indexes).reduce((s, i) => s + i.numberOfDocuments, 0) : undefined)} />
        <Stat label="Database size" value={formatBytes(stats()?.databaseSize)} />
        <Stat label="Used DB size" value={formatBytes(stats()?.usedDatabaseSize)} />
        <Stat label="Last update" value={<span class="small">{formatDate(stats()?.lastUpdate)}</span>} />
      </div>

      <div class="muted small">
        Commit {server().version?.commitSha?.slice(0, 10)} · {formatDate(server().version?.commitDate)}
      </div>

      <h3>Indexes</h3>
      <Show when={!stats.loading} fallback={<Spinner />}>
        <Show when={!stats.error} fallback={<div class="err">{String(stats.error?.message ?? stats.error)}</div>}>
          <table class="grid">
            <thead>
              <tr>
                <th>Index</th>
                <th class="num">Documents</th>
                <th class="num">Fields</th>
                <th class="num">Embeddings</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <For each={Object.entries(stats()?.indexes ?? {}).sort(([a], [b]) => a.localeCompare(b))}>
                {([uid, s]) => (
                  <tr class="clickable" onClick={() => setView({ kind: "index", uid, tab: "documents" })}>
                    <td>{uid}</td>
                    <td class="num">{formatNumber(s.numberOfDocuments)}</td>
                    <td class="num">{Object.keys(s.fieldDistribution ?? {}).length}</td>
                    <td class="num">{formatNumber(s.numberOfEmbeddings)}</td>
                    <td>{s.isIndexing ? <span class="warn">indexing…</span> : <span class="muted">idle</span>}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}
