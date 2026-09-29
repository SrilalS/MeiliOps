import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { api } from "../state/app";
import { ApiError, Stat, formatBytes, formatNumber } from "../components/ui";
import { IconRefresh } from "../components/icons";

interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}
interface Family {
  name: string;
  help: string;
  type: string;
  samples: Sample[];
}

/** Parse the Prometheus text exposition format. */
export function parsePrometheus(text: string): Family[] {
  const fams = new Map<string, Family>();
  const fam = (name: string) => {
    let f = fams.get(name);
    if (!f) fams.set(name, (f = { name, help: "", type: "untyped", samples: [] }));
    return f;
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^# HELP (\S+) (.*)$/))) fam(m[1]).help = m[2];
    else if ((m = line.match(/^# TYPE (\S+) (\S+)$/))) fam(m[1]).type = m[2];
    else if (!line.startsWith("#") && (m = line.match(/^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/))) {
      const labels: Record<string, string> = {};
      for (const l of (m[2] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2];
      const base = m[1].replace(/_(bucket|sum|count)$/, "");
      const f = fams.get(m[1]) ?? fams.get(base) ?? fam(m[1]);
      f.samples.push({ name: m[1], labels, value: Number(m[3]) });
    }
  }
  return [...fams.values()];
}

export default function MetricsView() {
  const [fams, setFams] = createSignal<Family[]>([]);
  const [err, setErr] = createSignal<unknown>();
  const [filter, setFilter] = createSignal("");
  const [auto, setAuto] = createSignal(true);

  const load = async () => {
    try {
      const res = await api().req<Response>("GET", "/metrics", { raw: true });
      setFams(parsePrometheus(await res.text()));
      setErr(undefined);
    } catch (e) {
      setErr(e);
    }
  };
  onMount(load);
  const timer = setInterval(() => auto() && !err() && load(), 5000);
  onCleanup(() => clearInterval(timer));

  const value = (name: string) => fams().find((f) => f.name === name)?.samples[0]?.value;
  const shown = createMemo(() => {
    const q = filter().toLowerCase();
    // Histogram buckets are noise in a table; keep sums and counts.
    return fams()
      .filter((f) => !q || f.name.includes(q) || f.help.toLowerCase().includes(q))
      .map((f) => ({ ...f, samples: f.samples.filter((s) => !s.name.endsWith("_bucket")) }));
  });

  return (
    <div class="page">
      <div class="page-head">
        <h2>Metrics</h2>
        <span class="muted small">Prometheus metrics. Requires --experimental-enable-metrics at launch.</span>
        <span class="grow" />
        <label class="inline-label">
          <input type="checkbox" checked={auto()} onChange={(e) => setAuto(e.currentTarget.checked)} /> refresh every 5 s
        </label>
        <button class="square" onClick={load} title="Refresh">
          <IconRefresh />
        </button>
      </div>
      <Show when={err()}>
        <ApiError error={err()} onRetry={load} />
      </Show>
      <div class="stats-row">
        <Stat label="DB size" value={formatBytes(value("meilisearch_db_size_bytes"))} />
        <Stat label="Used DB size" value={formatBytes(value("meilisearch_used_db_size_bytes"))} />
        <Stat label="Indexes" value={formatNumber(value("meilisearch_index_count"))} />
        <Stat label="Last update" value={value("meilisearch_last_update") ? new Date(value("meilisearch_last_update")! * 1000).toLocaleString() : "—"} />
        <Stat label="Searches running" value={formatNumber(value("meilisearch_searches_running"))} />
        <Stat label="Searches waiting" value={`${formatNumber(value("meilisearch_searches_waiting_to_be_processed"))} / ${formatNumber(value("meilisearch_search_queue_size"))}`} />
        <Stat label="Task queue used" value={`${formatBytes(value("meilisearch_task_queue_used_size"))} / ${formatBytes(value("meilisearch_task_queue_max_size"))}`} />
        <Stat label="Task queue latency" value={value("meilisearch_task_queue_latency_seconds") !== undefined ? `${value("meilisearch_task_queue_latency_seconds")!.toFixed(2)} s` : "—"} />
      </div>
      <input placeholder="Filter metrics…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      <table class="grid">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Labels</th>
            <th class="num">Value</th>
          </tr>
        </thead>
        <tbody>
          <For each={shown()}>
            {(f) => (
              <For each={f.samples}>
                {(s, i) => (
                  <tr>
                    <td title={f.help}>
                      <Show when={i() === 0} fallback={<span class="muted small">{s.name !== f.name ? s.name : ""}</span>}>
                        <code>{s.name}</code> <span class="pill">{f.type}</span>
                        <div class="muted small">{f.help}</div>
                      </Show>
                    </td>
                    <td class="small mono">
                      {Object.entries(s.labels)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("  ")}
                    </td>
                    <td class="num mono">{Number.isInteger(s.value) ? s.value.toLocaleString() : s.value.toPrecision(6)}</td>
                  </tr>
                )}
              </For>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
