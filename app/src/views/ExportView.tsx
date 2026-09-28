import { For, createSignal } from "solid-js";
import { api, connections, activeId, getConnectionKey, indexes, trackTask } from "../state/app";

interface Row {
  pattern: string;
  filter: string;
  overrideSettings: boolean;
}

export default function ExportView() {
  const [url, setUrl] = createSignal("");
  const [key, setKey] = createSignal("");
  const [payloadSize, setPayloadSize] = createSignal("");
  const [rows, setRows] = createSignal<Row[]>([{ pattern: "*", filter: "", overrideSettings: false }]);

  const others = () => connections.filter((c) => c.id !== activeId());

  const useConnection = async (id: string) => {
    const c = connections.find((x) => x.id === id);
    if (!c) return;
    setUrl(c.url);
    setKey(c.hasKey ? ((await getConnectionKey(c.id)) ?? "") : "");
  };

  const update = (i: number, patch: Partial<Row>) => setRows(rows().map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = () => {
    const idx: Record<string, { filter: string | null; overrideSettings: boolean }> = {};
    for (const r of rows()) if (r.pattern.trim()) idx[r.pattern.trim()] = { filter: r.filter.trim() || null, overrideSettings: r.overrideSettings };
    trackTask(
      api().req("POST", "/export", { body: { url: url().trim(), apiKey: key() || null, payloadSize: payloadSize() || null, indexes: idx } }),
      `Export to ${url()}`,
    );
  };

  return (
    <div class="page narrow">
      <div class="page-head">
        <h2>Export to another Meilisearch</h2>
      </div>
      <p class="muted small">The server pushes documents (and optionally settings) straight to the destination instance. No dump files involved. Runs as a task.</p>
      <div class="form">
        <label class="field">
          <span>Destination</span>
          <div class="row">
            <input class="grow" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://other-instance:7700" />
            <select onChange={(e) => useConnection(e.currentTarget.value)} value="">
              <option value="">Fill from a saved connection…</option>
              <For each={others()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
            </select>
          </div>
        </label>
        <label class="field">
          <span>Destination API key</span>
          <input type="password" class="mono" value={key()} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
        </label>
        <label class="field">
          <span>Payload size per request (optional)</span>
          <input value={payloadSize()} onInput={(e) => setPayloadSize(e.currentTarget.value)} placeholder="e.g. 24MiB" />
        </label>
        <div class="field">
          <span>Indexes (patterns like * or movies_*)</span>
          <For each={rows()}>
            {(r, i) => (
              <div class="row">
                <input class="mono" style={{ width: "180px" }} value={r.pattern} onInput={(e) => update(i(), { pattern: e.currentTarget.value })} list="export-index-names" />
                <input class="mono grow" value={r.filter} onInput={(e) => update(i(), { filter: e.currentTarget.value })} placeholder="filter (optional)" />
                <label class="inline-label">
                  <input type="checkbox" checked={r.overrideSettings} onChange={(e) => update(i(), { overrideSettings: e.currentTarget.checked })} /> override settings
                </label>
                <button class="icon-btn" onClick={() => setRows(rows().filter((_, j) => j !== i()))}>
                  ✕
                </button>
              </div>
            )}
          </For>
          <datalist id="export-index-names">
            <For each={indexes()}>{(i) => <option value={i.uid} />}</For>
          </datalist>
          <div>
            <button onClick={() => setRows([...rows(), { pattern: "", filter: "", overrideSettings: false }])}>+ Add pattern</button>
          </div>
        </div>
        <div class="row form-actions">
          <span class="grow" />
          <button class="primary" disabled={!url().trim()} onClick={submit}>
            Start export
          </button>
        </div>
      </div>
    </div>
  );
}
