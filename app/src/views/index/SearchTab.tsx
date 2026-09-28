import { For, JSX, Show, createEffect, createResource, createSignal, on, onCleanup } from "solid-js";
import { api } from "../../state/app";
import { errorMessage } from "../../api/meili";
import JsonEditor from "../../components/JsonEditor";
import { Tabs, formatNumber, pretty } from "../../components/ui";

// Private-use markers so highlighted text can be rendered without innerHTML
// (document content is untrusted).
const PRE = "";
const POST = "";

type Hit = Record<string, any> & { _formatted?: Record<string, any>; _rankingScore?: number; _rankingScoreDetails?: unknown };

interface SearchResponse {
  hits: Hit[];
  query: string;
  processingTimeMs: number;
  estimatedTotalHits?: number;
  totalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
  facetStats?: Record<string, { min: number; max: number }>;
  semanticHitCount?: number;
  performanceDetails?: unknown;
}

export default function SearchTab(props: { uid: string }) {
  const [q, setQ] = createSignal("");
  const [filter, setFilter] = createSignal("");
  const [sort, setSort] = createSignal("");
  const [facets, setFacets] = createSignal("");
  const [limit, setLimit] = createSignal(20);
  const [offset, setOffset] = createSignal(0);
  const [matching, setMatching] = createSignal("last");
  const [scores, setScores] = createSignal(true);
  const [perf, setPerf] = createSignal(false);
  const [embedder, setEmbedder] = createSignal("");
  const [ratio, setRatio] = createSignal(0.5);
  const [mode, setMode] = createSignal<"form" | "json">("form");
  const [jsonBody, setJsonBody] = createSignal("");
  const [view, setView] = createSignal<"hits" | "raw">("hits");
  const [res, setRes] = createSignal<SearchResponse>();
  const [err, setErr] = createSignal<string>();
  const [expanded, setExpanded] = createSignal<number>();
  const [similar, setSimilar] = createSignal<{ id: unknown; hits?: Hit[]; error?: string }>();

  const [embedders] = createResource(() =>
    api()
      .req<Record<string, unknown>>("GET", "/indexes/{index_uid}/settings/embedders", { path: { index_uid: props.uid } })
      .catch(() => ({})),
  );
  const [primaryKey] = createResource(() => api().req("GET", "/indexes/{index_uid}", { path: { index_uid: props.uid } }).then((i) => i.primaryKey as string | null));

  const formBody = () => {
    const b: Record<string, unknown> = {
      q: q(),
      limit: limit(),
      offset: offset(),
      matchingStrategy: matching(),
      attributesToHighlight: ["*"],
      highlightPreTag: PRE,
      highlightPostTag: POST,
      showRankingScore: scores(),
      showRankingScoreDetails: scores(),
    };
    if (filter().trim()) b.filter = filter().trim();
    if (sort().trim()) b.sort = splitList(sort());
    if (facets().trim()) b.facets = splitList(facets());
    if (perf()) b.showPerformanceDetails = true;
    if (embedder()) b.hybrid = { embedder: embedder(), semanticRatio: ratio() };
    return b;
  };

  let ctrl: AbortController | undefined;
  let timer: number | undefined;
  const run = () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      let body: unknown;
      try {
        body = mode() === "json" ? JSON.parse(jsonBody()) : formBody();
      } catch (e) {
        return setErr(`Invalid JSON: ${(e as Error).message}`);
      }
      try {
        const r = await api().req<SearchResponse>("POST", "/indexes/{index_uid}/search", { path: { index_uid: props.uid }, body, signal: ctrl.signal });
        setRes(r);
        setErr(undefined);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr(errorMessage(e));
      }
    }, 120);
  };
  onCleanup(() => {
    clearTimeout(timer);
    ctrl?.abort();
  });

  // Search-as-you-type in form mode.
  createEffect(on([q, filter, sort, facets, limit, offset, matching, scores, perf, embedder, ratio], () => mode() === "form" && run()));

  const switchMode = (m: "form" | "json") => {
    if (m === "json") setJsonBody(pretty({ ...formBody(), highlightPreTag: undefined, highlightPostTag: undefined }));
    setMode(m);
  };

  const findSimilar = async (hit: Hit) => {
    const pk = primaryKey();
    if (!pk) return;
    const id = hit[pk];
    setSimilar({ id });
    try {
      const r = await api().req<{ hits: Hit[] }>("POST", "/indexes/{index_uid}/similar", {
        path: { index_uid: props.uid },
        body: { id, embedder: embedder() || Object.keys(embedders() ?? {})[0], limit: 10 },
      });
      setSimilar({ id, hits: r.hits });
    } catch (e) {
      setSimilar({ id, error: errorMessage(e) });
    }
  };

  return (
    <div class="search-tab">
      <div class="toolbar">
        <input class="grow search-box" placeholder="Search…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} autofocus />
        <Tabs
          tabs={[
            { id: "form", label: "Form" },
            { id: "json", label: "JSON body" },
          ]}
          value={mode()}
          onChange={switchMode}
        />
      </div>

      <Show
        when={mode() === "form"}
        fallback={
          <div class="editor-box short">
            <JsonEditor value={jsonBody()} onChange={setJsonBody} onSubmit={run} />
            <div class="row">
              <button class="primary" onClick={run}>
                Run search (Ctrl+Enter)
              </button>
              <span class="muted small">Every search parameter is available here — see the Meilisearch search reference.</span>
            </div>
          </div>
        }
      >
        <div class="search-params">
          <input class="mono grow" placeholder="filter" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          <input class="mono" placeholder="sort (a:asc, b:desc)" value={sort()} onInput={(e) => setSort(e.currentTarget.value)} />
          <input class="mono" placeholder="facets (genres, year)" value={facets()} onInput={(e) => setFacets(e.currentTarget.value)} />
          <label class="inline-label">
            limit <input type="number" class="num-input" min="0" value={limit()} onInput={(e) => setLimit(+e.currentTarget.value || 0)} />
          </label>
          <label class="inline-label">
            offset <input type="number" class="num-input" min="0" value={offset()} onInput={(e) => setOffset(+e.currentTarget.value || 0)} />
          </label>
          <label class="inline-label">
            matching
            <select value={matching()} onChange={(e) => setMatching(e.currentTarget.value)}>
              <option value="last">last</option>
              <option value="all">all</option>
              <option value="frequency">frequency</option>
            </select>
          </label>
          <label class="inline-label">
            <input type="checkbox" checked={scores()} onChange={(e) => setScores(e.currentTarget.checked)} /> scores
          </label>
          <label class="inline-label">
            <input type="checkbox" checked={perf()} onChange={(e) => setPerf(e.currentTarget.checked)} /> perf details
          </label>
          <Show when={Object.keys(embedders() ?? {}).length > 0}>
            <label class="inline-label">
              hybrid
              <select value={embedder()} onChange={(e) => setEmbedder(e.currentTarget.value)}>
                <option value="">off (keyword)</option>
                <For each={Object.keys(embedders() ?? {})}>{(n) => <option value={n}>{n}</option>}</For>
              </select>
            </label>
            <Show when={embedder()}>
              <label class="inline-label">
                semantic {ratio().toFixed(2)}
                <input type="range" min="0" max="1" step="0.05" value={ratio()} onInput={(e) => setRatio(+e.currentTarget.value)} />
              </label>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="result-meta">
        <Show when={err()}>
          <span class="err">{err()}</span>
        </Show>
        <Show when={res() && !err()}>
          <span>
            <b>{formatNumber(res()!.totalHits ?? res()!.estimatedTotalHits)}</b> hits{res()!.totalHits === undefined ? " (estimated)" : ""} in{" "}
            <b>{res()!.processingTimeMs} ms</b>
            <Show when={res()!.semanticHitCount !== undefined}> · {res()!.semanticHitCount} semantic</Show>
          </span>
        </Show>
        <span class="grow" />
        <Tabs
          tabs={[
            { id: "hits", label: "Hits" },
            { id: "raw", label: "Raw response" },
          ]}
          value={view()}
          onChange={setView}
        />
      </div>

      <div class="split">
        <div class="split-main scroll">
          <Show
            when={view() === "hits"}
            fallback={
              <div class="editor-box fill">
                <JsonEditor value={pretty(res() ?? {})} readOnly />
              </div>
            }
          >
            <For each={res()?.hits ?? []}>
              {(hit, i) => (
                <div class="hit">
                  <div class="hit-head">
                    <span class="muted small">#{offset() + i() + 1}</span>
                    <Show when={primaryKey() && hit[primaryKey()!] !== undefined}>
                      <code class="small">{String(hit[primaryKey()!])}</code>
                    </Show>
                    <Show when={hit._rankingScore !== undefined}>
                      <span class="pill score" title="_rankingScore">
                        {hit._rankingScore!.toFixed(4)}
                      </span>
                    </Show>
                    <span class="grow" />
                    <Show when={Object.keys(embedders() ?? {}).length > 0}>
                      <button class="link small" onClick={() => findSimilar(hit)}>
                        Similar
                      </button>
                    </Show>
                    <button class="link small" onClick={() => setExpanded(expanded() === i() ? undefined : i())}>
                      {expanded() === i() ? "Hide JSON" : "JSON & scoring"}
                    </button>
                  </div>
                  <HitFields hit={hit} />
                  <Show when={expanded() === i()}>
                    <div class="editor-box short">
                      <JsonEditor value={pretty(stripFormatted(hit))} readOnly />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>
        <Show when={res()?.facetDistribution && Object.keys(res()!.facetDistribution!).length}>
          <div class="split-side facets">
            <For each={Object.entries(res()!.facetDistribution!)}>
              {([facet, values]) => <FacetBlock uid={props.uid} facet={facet} values={values} stats={res()!.facetStats?.[facet]} onPick={(v) => setFilter(addFilter(filter(), facet, v))} />}
            </For>
          </div>
        </Show>
      </div>

      <Show when={similar()}>
        <div class="similar-panel">
          <div class="side-head">
            <b>Similar to {String(similar()!.id)}</b>
            <span class="grow" />
            <button class="icon-btn" onClick={() => setSimilar(undefined)}>
              ✕
            </button>
          </div>
          <Show when={similar()!.error}>
            <div class="err pad">{similar()!.error}</div>
          </Show>
          <For each={similar()!.hits ?? []}>{(h) => <div class="similar-row ellipsis">{summary(h)}</div>}</For>
        </div>
      </Show>
    </div>
  );
}

function HitFields(props: { hit: Hit }) {
  const fields = () => Object.entries(props.hit._formatted ?? props.hit).filter(([k]) => !k.startsWith("_"));
  return (
    <div class="hit-fields">
      <For each={fields().slice(0, 8)}>
        {([k, v]) => (
          <div class="hit-field">
            <span class="hit-key">{k}</span>
            <span class="hit-val">{renderHighlighted(v)}</span>
          </div>
        )}
      </For>
    </div>
  );
}

function FacetBlock(props: { uid: string; facet: string; values: Record<string, number>; stats?: { min: number; max: number }; onPick: (v: string) => void }) {
  const [fq, setFq] = createSignal("");
  const [found] = createResource(fq, (facetQuery) =>
    api()
      .req<{ facetHits: { value: string; count: number }[] }>("POST", "/indexes/{index_uid}/facet-search", {
        path: { index_uid: props.uid },
        body: { facetName: props.facet, facetQuery },
      })
      .then((r) => r.facetHits)
      .catch(() => []),
  );
  const list = () => (fq() ? (found() ?? []).map((h) => [h.value, h.count] as const) : Object.entries(props.values));
  return (
    <div class="facet">
      <div class="facet-title">
        {props.facet}
        <Show when={props.stats}>
          <span class="muted small">
            {" "}
            {props.stats!.min} – {props.stats!.max}
          </span>
        </Show>
      </div>
      <input class="facet-search" placeholder="search values…" value={fq()} onInput={(e) => setFq(e.currentTarget.value)} />
      <For each={list().slice(0, 30)}>
        {([v, n]) => (
          <div class="facet-row" onClick={() => props.onPick(v)} title="Add to filter">
            <span class="grow ellipsis">{v}</span>
            <span class="muted small">{formatNumber(n)}</span>
          </div>
        )}
      </For>
    </div>
  );
}

function renderHighlighted(v: unknown): JSX.Element {
  if (v === null || v === undefined) return <span class="muted">{String(v)}</span>;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const short = s.length > 400 ? s.slice(0, 400) + "…" : s;
  const parts: JSX.Element[] = [];
  let rest = short;
  while (rest.length) {
    const a = rest.indexOf(PRE);
    if (a < 0) {
      parts.push(rest);
      break;
    }
    const b = rest.indexOf(POST, a);
    parts.push(rest.slice(0, a));
    parts.push(<mark>{rest.slice(a + 1, b < 0 ? undefined : b)}</mark>);
    rest = b < 0 ? "" : rest.slice(b + 1);
  }
  return <>{parts}</>;
}

function stripFormatted(hit: Hit) {
  const { _formatted, ...rest } = hit;
  return rest;
}

function summary(h: Hit): string {
  const title = h.title ?? h.name ?? Object.values(h).find((v) => typeof v === "string");
  return String(title ?? JSON.stringify(h).slice(0, 120));
}

function splitList(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function addFilter(current: string, facet: string, value: string) {
  const clause = `${facet} = ${JSON.stringify(value)}`;
  return current.trim() ? `${current.trim()} AND ${clause}` : clause;
}
