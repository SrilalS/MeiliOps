import { For, Show, createSignal } from "solid-js";
import { api, indexes } from "../state/app";
import { errorMessage } from "../api/meili";
import JsonEditor from "../components/JsonEditor";
import { Tabs, formatNumber, pretty } from "../components/ui";

type Hit = Record<string, unknown> & { _federation?: { indexUid: string; queriesPosition: number; weightedRankingScore?: number } };

const template = (federated: boolean) => {
  const uids = indexes()
    .slice(0, 2)
    .map((i) => i.uid);
  const list = uids.length ? uids : ["movies"];
  // Federated queries take pagination only on `federation`; per-query weight goes in federationOptions.
  return pretty(
    federated
      ? { federation: { limit: 20, offset: 0 }, queries: list.map((indexUid) => ({ indexUid, q: "", federationOptions: { weight: 1 } })) }
      : { queries: list.map((indexUid) => ({ indexUid, q: "", limit: 5 })) },
  );
};

export default function MultiSearchView() {
  const [federated, setFederated] = createSignal(true);
  const [body, setBody] = createSignal(template(true));
  const [res, setRes] = createSignal<any>();
  const [err, setErr] = createSignal<string>();
  const [ms, setMs] = createSignal<number>();
  const [view, setView] = createSignal<"hits" | "raw">("hits");

  const run = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body());
    } catch (e) {
      return setErr(`Invalid JSON: ${(e as Error).message}`);
    }
    const t0 = performance.now();
    try {
      setRes(await api().req("POST", "/multi-search", { body: parsed }));
      setErr(undefined);
    } catch (e) {
      setErr(errorMessage(e));
    }
    setMs(Math.round(performance.now() - t0));
  };

  const switchMode = (fed: boolean) => {
    setFederated(fed);
    setBody(template(fed));
    setRes(undefined);
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Multi-search</h2>
        <span class="muted small">Run several queries in one request, or merge them across indexes (federated search).</span>
        <span class="grow" />
        <Tabs
          tabs={[
            { id: "fed", label: "Federated" },
            { id: "multi", label: "Separate results" },
          ]}
          value={federated() ? "fed" : "multi"}
          onChange={(v) => switchMode(v === "fed")}
        />
      </div>
      <div class="split">
        <div class="console-pane">
          <div class="pane-title">Request body</div>
          <JsonEditor value={body()} onChange={setBody} onSubmit={run} class="grow" />
          <div class="row">
            <button class="primary" onClick={run}>
              Run (Ctrl+Enter)
            </button>
            <Show when={err()}>
              <span class="err">{err()}</span>
            </Show>
            <Show when={ms() !== undefined && !err()}>
              <span class="muted small">{ms()} ms round trip</span>
            </Show>
          </div>
        </div>
        <div class="console-pane">
          <div class="row">
            <span class="pane-title grow">Response</span>
            <Tabs
              tabs={[
                { id: "hits", label: "Hits" },
                { id: "raw", label: "Raw" },
              ]}
              value={view()}
              onChange={setView}
            />
          </div>
          <Show when={view() === "hits"} fallback={<JsonEditor value={pretty(res() ?? {})} readOnly class="grow" />}>
            <div class="scroll-pane">
              <Show when={res()?.hits}>
                <div class="muted small pad">
                  {formatNumber(res().estimatedTotalHits ?? res().totalHits)} hits · {res().processingTimeMs} ms
                </div>
                <HitList hits={res().hits} />
              </Show>
              <Show when={res()?.results}>
                <For each={res().results as any[]}>
                  {(r) => (
                    <div class="result-group">
                      <div class="facet-title">
                        {r.indexUid} <span class="muted small">· {formatNumber(r.estimatedTotalHits ?? r.totalHits)} hits · {r.processingTimeMs} ms</span>
                      </div>
                      <HitList hits={r.hits} />
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function HitList(props: { hits: Hit[] }) {
  return (
    <For each={props.hits}>
      {(h) => (
        <div class="hit compact">
          <Show when={h._federation}>
            <span class="pill">{h._federation!.indexUid}</span>{" "}
            <Show when={h._federation!.weightedRankingScore !== undefined}>
              <span class="pill score">{h._federation!.weightedRankingScore!.toFixed(4)}</span>
            </Show>{" "}
          </Show>
          <span class="ellipsis">{summarize(h)}</span>
        </div>
      )}
    </For>
  );
}

function summarize(h: Hit) {
  const { _federation, _rankingScore, _formatted, ...rest } = h as any;
  const title = rest.title ?? rest.name;
  return title ? String(title) : JSON.stringify(rest).slice(0, 160);
}
