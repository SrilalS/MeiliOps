import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { api, indexes } from "../state/app";
import JsonEditor from "../components/JsonEditor";
import { pretty } from "../components/ui";
import type { HttpMethod } from "../api/meili";

interface Param {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description: string;
  example?: unknown;
}
interface Op {
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description: string;
  params: Param[];
  body: { contentTypes: string[]; example: unknown } | null;
}

/**
 * Generic API console generated from the OpenAPI spec: every Meilisearch operation
 * is reachable here, including streaming (SSE) routes.
 */
export default function ConsoleView() {
  const [catalog] = createResource(() => import("../api/operations.json").then((m) => m.default as unknown as { version: string; ops: Op[] }));
  const [search, setSearch] = createSignal("");
  const [op, setOp] = createSignal<Op>();
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [body, setBody] = createSignal("");
  const [resp, setResp] = createSignal<{ status: number; ms: number; text: string; streaming?: boolean }>();
  let ctrl: AbortController | undefined;
  onCleanup(() => ctrl?.abort());

  const groups = createMemo(() => {
    const q = search().toLowerCase();
    const m = new Map<string, Op[]>();
    for (const o of catalog()?.ops ?? []) {
      if (q && !`${o.method} ${o.path} ${o.summary} ${o.tag}`.toLowerCase().includes(q)) continue;
      m.set(o.tag, [...(m.get(o.tag) ?? []), o]);
    }
    return [...m.entries()];
  });

  const select = (o: Op) => {
    setOp(o);
    const v: Record<string, string> = {};
    for (const p of o.params) if (p.in === "path" && p.name === "index_uid" && indexes()[0]) v[p.name] = indexes()[0].uid;
    setValues(v);
    setBody(o.body ? pretty(o.body.example ?? {}) : "");
    setResp(undefined);
  };

  const send = async () => {
    const o = op();
    if (!o) return;
    ctrl?.abort();
    ctrl = new AbortController();
    const m = api();
    const pathVals: Record<string, string> = {};
    const query: Record<string, string> = {};
    for (const p of o.params) {
      const v = values()[p.name];
      if (!v) continue;
      if (p.in === "path") pathVals[p.name] = v;
      else if (p.in === "query") query[p.name] = v;
    }
    const contentType = o.body?.contentTypes[0];
    const t0 = performance.now();
    try {
      const res = await fetch(m.resolve(o.path, { path: pathVals, query }), {
        method: o.method,
        headers: m.headers(o.body && body().trim() ? contentType : undefined),
        body: o.body && body().trim() ? body() : undefined,
        signal: ctrl.signal,
      });
      const ms = Math.round(performance.now() - t0);
      const ct = res.headers.get("content-type") ?? "";
      if (res.body && (ct.includes("text/event-stream") || ct.includes("ndjson") || o.path.includes("stream"))) {
        // Stream incrementally (logs, task/batch streams, chat completions).
        setResp({ status: res.status, ms, text: "", streaming: true });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += dec.decode(value, { stream: true });
          if (text.length > 1_000_000) text = text.slice(-500_000);
          setResp({ status: res.status, ms, text, streaming: true });
        }
        setResp({ status: res.status, ms, text, streaming: false });
      } else {
        const text = await res.text();
        let shown = text;
        try {
          shown = pretty(JSON.parse(text));
        } catch {
          /* not JSON (e.g. Prometheus metrics) */
        }
        setResp({ status: res.status, ms, text: shown });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") setResp((r) => (r ? { ...r, streaming: false } : r));
      else setResp({ status: 0, ms: Math.round(performance.now() - t0), text: String((e as Error).message ?? e) });
    }
  };

  return (
    <div class="console">
      <nav class="console-nav">
        <input class="sidebar-filter" placeholder={`Search ${catalog()?.ops.length ?? ""} operations…`} value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        <div class="console-list">
          <For each={groups()}>
            {([tag, list]) => (
              <>
                <div class="settings-group">{tag}</div>
                <For each={list}>
                  {(o) => (
                    <div class="console-op" classList={{ active: op() === o }} onClick={() => select(o)} title={o.summary}>
                      <span class={`method m-${o.method}`}>{o.method}</span>
                      <span class="ellipsis">{o.path}</span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
      </nav>
      <section class="console-body">
        <Show when={op()} fallback={<div class="empty muted">Pick an operation. Spec: Meilisearch {catalog()?.version}</div>}>
          {(o) => (
            <>
              <div class="console-head">
                <span class={`method m-${o().method}`}>{o().method}</span>
                <code class="grow">{o().path}</code>
                <button class="primary" onClick={send}>
                  Send (Ctrl+Enter)
                </button>
                <Show when={resp()?.streaming}>
                  <button onClick={() => ctrl?.abort()}>Stop</button>
                </Show>
              </div>
              <div class="muted small">{o().summary}</div>
              <Show when={o().params.length}>
                <div class="param-grid">
                  <For each={o().params.filter((p) => p.in !== "header")}>
                    {(p) => (
                      <label class="param" title={p.description}>
                        <span>
                          {p.name}
                          {p.required ? " *" : ""} <span class="muted small">({p.in})</span>
                        </span>
                        <input
                          class="mono"
                          value={values()[p.name] ?? ""}
                          placeholder={p.example !== undefined ? String(p.example) : ""}
                          onInput={(e) => setValues({ ...values(), [p.name]: e.currentTarget.value })}
                          onKeyDown={(e) => e.key === "Enter" && send()}
                        />
                      </label>
                    )}
                  </For>
                </div>
              </Show>
              <div class="console-io">
                <Show when={o().body}>
                  <div class="console-pane">
                    <div class="pane-title">Body ({o().body!.contentTypes.join(", ")})</div>
                    <JsonEditor value={body()} onChange={setBody} onSubmit={send} lint={o().body!.contentTypes[0] === "application/json"} class="grow" />
                  </div>
                </Show>
                <div class="console-pane">
                  <div class="pane-title">
                    Response{" "}
                    <Show when={resp()}>
                      <span classList={{ ok: resp()!.status >= 200 && resp()!.status < 300, err: resp()!.status >= 400 || resp()!.status === 0 }}>
                        {resp()!.status || "network error"}
                      </span>{" "}
                      <span class="muted">· {resp()!.ms} ms{resp()!.streaming ? " · streaming…" : ""}</span>
                    </Show>
                  </div>
                  <JsonEditor value={resp()?.text ?? ""} readOnly class="grow" />
                </div>
              </div>
            </>
          )}
        </Show>
      </section>
    </div>
  );
}
