import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { api, indexes, notifyError, setView, trackTask } from "../../state/app";
import { ApiError, Confirm, Spinner, formatNumber } from "../../components/ui";
import { IconChevronRight } from "../../components/icons";
import { FieldStats, SchemaAnalyzer, SchemaResult, ValueType, filterFor, isUnique, looksCategorical, topValues } from "../../lib/schema";

type Doc = Record<string, unknown>;

interface FieldCaps {
  name: string;
  searchable?: { enabled: boolean };
  sortable?: { enabled: boolean };
  displayed?: { enabled: boolean };
  filterable?: { enabled: boolean; facetSearch?: boolean; comparison?: boolean };
  distinct?: { enabled: boolean };
}

interface FacetResult {
  distribution: [string, number][];
  stats?: { min: number; max: number };
  hits: number;
}

const SAMPLE_SIZES = [1000, 5000, 20000];
const BATCH = 1000;

export default function SchemaTab(props: { uid: string }) {
  const total = () => indexes().find((i) => i.uid === props.uid)?.numberOfDocuments;

  const [sampleSize, setSampleSize] = createSignal(SAMPLE_SIZES[0]);
  const [result, setResult] = createSignal<SchemaResult>();
  const [loaded, setLoaded] = createSignal(0);
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const [open, setOpen] = createSignal<string>();
  const [search, setSearch] = createSignal("");
  const [makeFilterable, setMakeFilterable] = createSignal<string>();

  const [caps, { refetch: refetchCaps }] = createResource(async () => {
    const out = new Map<string, FieldCaps>();
    for (let offset = 0; ; offset += 1000) {
      const res = await api().req<{ results: FieldCaps[]; total: number }>("POST", "/indexes/{index_uid}/fields", {
        path: { index_uid: props.uid },
        body: { offset, limit: 1000 },
      });
      for (const f of res.results) out.set(f.name, f);
      if (offset + res.results.length >= res.total || res.results.length === 0) break;
    }
    return out;
  });

  // Each run bumps the generation, so a newer run (or leaving the tab) stops an older one.
  let generation = 0;
  onCleanup(() => generation++);

  async function analyze() {
    const gen = ++generation;
    const analyzer = new SchemaAnalyzer();
    setRunning(true);
    setError(undefined);
    setLoaded(0);
    try {
      const want = Math.min(sampleSize(), total() ?? sampleSize());
      for (let offset = 0; offset < want; offset += BATCH) {
        const res = await api().req<{ results: Doc[]; total: number }>("POST", "/indexes/{index_uid}/documents/fetch", {
          path: { index_uid: props.uid },
          body: { offset, limit: Math.min(BATCH, want - offset) },
        });
        if (gen !== generation) return;
        analyzer.add(res.results);
        setLoaded(offset + res.results.length);
        setResult(analyzer.result());
        if (res.results.length < BATCH) break;
      }
    } catch (e) {
      if (gen === generation) setError(e);
    } finally {
      if (gen === generation) setRunning(false);
    }
  }
  analyze();

  const fields = createMemo(() => {
    const q = search().trim().toLowerCase();
    const all = result()?.fields ?? [];
    return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  });

  const openDocs = (filter: string) => setView({ kind: "index", uid: props.uid, tab: "documents", filter });

  return (
    <div class="page-body schema-tab">
      <div class="toolbar">
        <input class="grow" placeholder="Find field…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        <label class="inline-label">
          Sample
          <select value={sampleSize()} onChange={(e) => setSampleSize(Number(e.currentTarget.value))}>
            <For each={SAMPLE_SIZES}>{(n) => <option value={n}>{formatNumber(n)} documents</option>}</For>
          </select>
        </label>
        <button onClick={analyze} disabled={running()}>
          {running() ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      <div class="muted small toolbar-info">
        <Show when={result()} fallback={<Spinner />}>
          {formatNumber(result()!.fields.length)} fields in {formatNumber(loaded())} of {formatNumber(total())} documents
          {loaded() < (total() ?? 0) ? " (the first documents by internal order, not a random sample)" : ""}. Click a field for its values.
        </Show>
      </div>

      <Show when={error()}>
        <ApiError error={error()} onRetry={analyze} />
      </Show>
      <Show when={caps.error}>
        <ApiError error={caps.error} onRetry={refetchCaps} />
      </Show>

      <div class="scroll-pane">
        <table class="grid schema-grid">
          <thead>
            <tr>
              <th>Field</th>
              <th class="schema-presence">Present</th>
              <th>Types</th>
              <th>Values</th>
              <th>Index</th>
            </tr>
          </thead>
          <tbody>
            <For each={fields()}>
              {(f) => {
                const cap = () => caps()?.get(f.path);
                const isOpen = () => open() === f.path;
                return (
                  <>
                    <tr class="clickable" classList={{ selected: isOpen() }} onClick={() => setOpen(isOpen() ? undefined : f.path)}>
                      <td class="mono nowrap" style={{ "padding-left": `${8 + f.depth * 16}px` }}>
                        <span class="schema-name">
                          <IconChevronRight class={isOpen() ? "schema-chev open" : "schema-chev"} />
                          {f.depth ? f.path.slice(f.path.lastIndexOf(".") + 1) : f.path}
                        </span>
                      </td>
                      <td>
                        <Presence value={f.present} of={result()!.sampled} />
                      </td>
                      <td>
                        <TypePills f={f} />
                      </td>
                      <td class="small ellipsis schema-summary">{summary(f)}</td>
                      <td>
                        <CapPills cap={cap()} f={f} />
                      </td>
                    </tr>
                    <Show when={isOpen()}>
                      <tr class="schema-detail">
                        <td colspan={5}>
                          <FieldDetail
                            uid={props.uid}
                            f={f}
                            cap={cap()}
                            sampled={result()!.sampled}
                            onFilter={openDocs}
                            onMakeFilterable={() => setMakeFilterable(f.path)}
                          />
                        </td>
                      </tr>
                    </Show>
                  </>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={makeFilterable()}>
        <Confirm
          title="Make field filterable"
          message={
            <>
              Add <code>{makeFilterable()}</code> to <code>filterableAttributes</code>? Meilisearch re-indexes {props.uid}, which can take a while on large indexes.
            </>
          }
          confirmText="Add and re-index"
          onClose={() => setMakeFilterable(undefined)}
          onConfirm={async () => {
            const path = makeFilterable()!;
            try {
              const current = await api().req<unknown[]>("GET", "/indexes/{index_uid}/settings/filterable-attributes", { path: { index_uid: props.uid } });
              const t = await trackTask(
                api().req("PUT", "/indexes/{index_uid}/settings/filterable-attributes", { path: { index_uid: props.uid }, body: [...(current ?? []), path] }),
                `Make ${path} filterable in ${props.uid}`,
              );
              if (t?.status === "succeeded") refetchCaps();
            } catch (e) {
              notifyError(e, "Update filterable attributes");
            }
          }}
        />
      </Show>
    </div>
  );
}

function Presence(props: { value: number; of: number }) {
  const pct = () => (props.of ? (props.value / props.of) * 100 : 0);
  return (
    <span class="progress" title={`${formatNumber(props.value)} of ${formatNumber(props.of)}`}>
      <span class="progress-bar" style={{ width: `${pct()}%` }} />
      <span class="progress-label">{pct() >= 99.95 ? "100%" : `${pct().toFixed(pct() < 10 ? 1 : 0)}%`}</span>
    </span>
  );
}

function TypePills(props: { f: FieldStats }) {
  const entries = () => {
    const e = Object.entries(props.f.types) as [ValueType, number][];
    const sum = e.reduce((a, [, n]) => a + n, 0);
    return e.sort((a, b) => b[1] - a[1]).map(([t, n]) => [t, Math.round((n / sum) * 100)] as const);
  };
  return (
    <span class="row gap-4 wrap">
      <For each={entries()}>
        {([t, pct]) => (
          <span class={`pill type-${t}`} title={`${pct}% of values`}>
            {t}
            {entries().length > 1 ? ` ${pct}%` : ""}
          </span>
        )}
      </For>
    </span>
  );
}

function CapPills(props: { cap?: FieldCaps; f: FieldStats }) {
  return (
    <span class="row gap-4 wrap">
      <Show when={props.cap?.filterable?.enabled}>
        <span class="pill cap" title="Filterable (facets, filters)">filter</span>
      </Show>
      <Show when={props.cap?.sortable?.enabled}>
        <span class="pill cap" title="Sortable">sort</span>
      </Show>
      <Show when={props.cap?.searchable?.enabled}>
        <span class="pill cap" title="Searchable">search</span>
      </Show>
      <Show when={props.cap && !props.cap.displayed?.enabled}>
        <span class="pill" title="Not in displayedAttributes: hidden from search results">hidden</span>
      </Show>
      <Show when={!props.cap?.filterable?.enabled && looksCategorical(props.f)}>
        <span class="pill hint" title="Few distinct short values: a good filter or facet">facet candidate</span>
      </Show>
    </span>
  );
}

function summary(f: FieldStats): string {
  const parts: string[] = [];
  if (f.min !== undefined) parts.push(f.min === f.max ? `= ${f.min}` : `${f.min} … ${f.max}`);
  if (f.maxItems !== undefined) parts.push(`≤ ${f.maxItems} items`);
  if (f.isText) parts.push(`text, ${f.minLen}–${f.maxLen} chars`);
  else if (isUnique(f) && !f.types.number) parts.push(`unique in sample${f.maxLen !== undefined ? `, ${f.minLen}–${f.maxLen} chars` : ""}`);
  else if (f.values.size && (f.types.string || f.types.boolean || f.types.array)) {
    const distinct = f.valuesCapped ? `${formatNumber(f.values.size)}+ distinct` : `${formatNumber(f.values.size)} distinct`;
    const top = topValues(f, 3)
      .map(([v]) => v)
      .join(", ");
    parts.push(`${distinct}: ${top}`);
  }
  return parts.join(" · ");
}

function FieldDetail(props: {
  uid: string;
  f: FieldStats;
  cap?: FieldCaps;
  sampled: number;
  onFilter: (filter: string) => void;
  onMakeFilterable: () => void;
}) {
  const filterable = () => !!props.cap?.filterable?.enabled;
  const valueType = () => {
    const t = props.f.types;
    return (["number", "boolean", "string"] as const).find((k) => t[k]) ?? (t.array ? undefined : "string");
  };
  const [exact, setExact] = createSignal<FacetResult>();
  const [loadingExact, setLoadingExact] = createSignal(false);

  const loadExact = async () => {
    setLoadingExact(true);
    try {
      const res = await api().req<{
        facetDistribution?: Record<string, Record<string, number>>;
        facetStats?: Record<string, { min: number; max: number }>;
        estimatedTotalHits?: number;
      }>("POST", "/indexes/{index_uid}/search", { path: { index_uid: props.uid }, body: { q: "", limit: 0, facets: [props.f.path] } });
      const dist = Object.entries(res.facetDistribution?.[props.f.path] ?? {}).sort((a, b) => b[1] - a[1]);
      setExact({ distribution: dist, stats: res.facetStats?.[props.f.path], hits: res.estimatedTotalHits ?? 0 });
    } catch (e) {
      notifyError(e, "Facet distribution");
    } finally {
      setLoadingExact(false);
    }
  };

  const sampleTop = () => (props.f.isText || isUnique(props.f) ? [] : topValues(props.f, 15));
  const bars = () => exact()?.distribution.slice(0, 50) ?? sampleTop();
  const barMax = () => bars().reduce((m, [, n]) => Math.max(m, n), 1);

  return (
    <div class="schema-detail-body">
      <div class="row wrap gap-4 small">
        <Show when={props.f.min !== undefined}>
          <span>
            Range in sample: <b>{props.f.min}</b> … <b>{props.f.max}</b>
          </span>
        </Show>
        <Show when={exact()?.stats}>
          <span>
            · Whole index: <b>{exact()!.stats!.min}</b> … <b>{exact()!.stats!.max}</b>
          </span>
        </Show>
        <Show when={props.f.maxLen !== undefined}>
          <span>
            String length {props.f.minLen}–{props.f.maxLen}
          </span>
        </Show>
        <Show when={props.f.maxItems !== undefined}>
          <span>Arrays of up to {props.f.maxItems} items</span>
        </Show>
        <span class="grow" />
        <Show
          when={filterable()}
          fallback={
            <>
              <span class="muted">Not filterable: counts below are from the sample only.</span>
              <button onClick={props.onMakeFilterable}>Make filterable…</button>
            </>
          }
        >
          <button onClick={() => props.onFilter(`${fieldRef(props.f.path)} EXISTS`)}>Documents with this field</button>
          <button onClick={() => props.onFilter(`${fieldRef(props.f.path)} NOT EXISTS`)}>Documents without it</button>
          <button class="primary" onClick={loadExact} disabled={loadingExact()}>
            {loadingExact() ? "Counting…" : exact() ? "Recount" : "Exact counts (whole index)"}
          </button>
        </Show>
      </div>

      <Show when={bars().length} fallback={<div class="muted small">No value counts: free text, objects, or every value is different.</div>}>
        <div class="muted small schema-bars-title">
          {exact()
            ? `Whole index · top ${bars().length} of ${formatNumber(exact()!.distribution.length)} values (capped by the maxValuesPerFacet setting)`
            : `Sample · top ${bars().length} of ${formatNumber(props.f.values.size)}${props.f.valuesCapped ? "+" : ""} values`}
        </div>
        <div class="schema-bars">
          <For each={bars()}>
            {([value, n]) => (
              <button
                class="schema-bar"
                disabled={!filterable()}
                title={filterable() ? "Show matching documents" : "Make the field filterable to open matching documents"}
                onClick={() => props.onFilter(filterFor(props.f.path, value, valueType()))}
              >
                <span class="schema-bar-fill" style={{ width: `${(n / barMax()) * 100}%` }} />
                <span class="schema-bar-value ellipsis">{value === "" ? <i class="muted">(empty)</i> : value}</span>
                <span class="schema-bar-count num">{formatNumber(n)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function fieldRef(path: string) {
  return /^[A-Za-z0-9_.]+$/.test(path) ? path : JSON.stringify(path);
}
