import { For, Show, createResource, createSignal } from "solid-js";
import { api, notify, refreshIndexes, server, setView, trackTask } from "../state/app";
import { errorMessage } from "../api/meili";
import { copyText } from "../lib/platform";
import { ApiError, Spinner, Stat, formatBytes, formatDate, formatNumber } from "../components/ui";

interface GlobalStats {
  databaseSize: number;
  usedDatabaseSize?: number;
  lastUpdate: string | null;
  indexes: Record<string, { numberOfDocuments: number; isIndexing: boolean; fieldDistribution: Record<string, number>; numberOfEmbeddedDocuments?: number; numberOfEmbeddings?: number }>;
}

/** The /mcp endpoint lets LLM clients (Claude, Cursor, …) use this server as a tool. */
function McpCard() {
  const [result, setResult] = createSignal<{ ok: boolean; text: string }>();
  const url = () => `${api().url}/mcp`;
  const test = async () => {
    try {
      const r = await api().req<Response>("POST", "/mcp", {
        raw: true,
        body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "MeiliOps", version: "0.1" } } },
      });
      const text = await r.text();
      const m = text.match(/"serverInfo"\s*:\s*\{[^}]*\}/);
      setResult({ ok: true, text: m ? m[0] : text.slice(0, 200) });
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    }
  };
  return (
    <div class="card">
      <div class="row">
        <div class="grow">
          <b>MCP endpoint</b> <code>{url()}</code>
          <div class="muted small">Point an MCP client (Streamable HTTP) at this URL with an API key as a Bearer token to let an LLM search and manage this instance.</div>
        </div>
        <button onClick={() => copyText(url()).then(() => notify("info", "MCP URL copied"))}>Copy URL</button>
        <button onClick={test}>Test</button>
      </div>
      <Show when={result()}>
        <div class={`small mono ${result()!.ok ? "ok" : "err"}`}>{result()!.text}</div>
      </Show>
    </div>
  );
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

      <McpCard />

      <h3>Indexes</h3>
      <Show when={!stats.loading} fallback={<Spinner />}>
        <Show when={!stats.error} fallback={<ApiError error={stats.error} />}>
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
