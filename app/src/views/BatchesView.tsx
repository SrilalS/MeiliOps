import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { api, notifyError, online } from "../state/app";
import VirtualTable, { Column } from "../components/VirtualTable";
import JsonEditor from "../components/JsonEditor";
import { formatDate, formatNumber, pretty } from "../components/ui";
import { liveSse, streamSse } from "../lib/sse";
import { IconRefresh, IconX } from "../components/icons";

interface Batch {
  uid: number;
  progress: unknown | null;
  details: Record<string, unknown>;
  stats: { totalNbTasks: number; status: Record<string, number>; types: Record<string, number>; indexUids: Record<string, number>; progressTrace?: Record<string, string> };
  duration: string | null;
  startedAt: string;
  finishedAt: string | null;
  batchStrategy?: string;
}

export default function BatchesView() {
  const [batches, setBatches] = createSignal<Batch[]>([]);
  const [total, setTotal] = createSignal<number>();
  const [next, setNext] = createSignal<number | null>(null);
  const [selected, setSelected] = createSignal<number>();
  const [detail, setDetail] = createSignal<Batch>();
  let busy = false;

  const load = async () => {
    try {
      const r = await api().req<{ results: Batch[]; total: number; next: number | null }>("GET", "/batches", { query: { limit: 200 } });
      setBatches(r.results);
      setTotal(r.total);
      setNext(r.next);
    } catch (e) {
      notifyError(e, "Failed to load batches");
    }
  };
  const loadMore = async () => {
    if (busy || next() === null) return;
    busy = true;
    try {
      const r = await api().req<{ results: Batch[]; next: number | null }>("GET", "/batches", { query: { limit: 200, from: next() } });
      setBatches((b) => [...b, ...r.results]);
      setNext(r.next);
    } finally {
      busy = false;
    }
  };
  onMount(load);
  const [mode, setMode] = createSignal<"stream" | "polling">("stream");
  const upsert = (b: Batch) => {
    setBatches((list) => {
      const i = list.findIndex((x) => x.uid === b.uid);
      if (i < 0) return [b, ...list];
      const copy = list.slice();
      copy[i] = b;
      return copy;
    });
    if (detail()?.uid === b.uid) setDetail(b);
  };
  const stop = liveSse(
    (signal) => streamSse(api(), "GET", "/batches/stream", { onData: (d) => upsert(JSON.parse(d)) }, { signal }),
    () => setMode("polling"),
  );
  const timer = setInterval(() => online() && mode() === "polling" && batches().length <= 200 && load(), 3000);
  onCleanup(() => {
    stop();
    clearInterval(timer);
  });

  const select = async (i: number) => {
    setSelected(i);
    try {
      setDetail(await api().req<Batch>("GET", "/batches/{batch_id}", { path: { batch_id: batches()[i].uid } }));
    } catch (e) {
      notifyError(e);
    }
  };

  const columns: Column<Batch>[] = [
    { key: "uid", title: "UID", width: 80 },
    { key: "tasks", title: "Tasks", width: 80, render: (b) => formatNumber(b.stats?.totalNbTasks) },
    {
      key: "progress",
      title: "Progress",
      width: 220,
      render: (b) => {
        const p = b.progress as { percentage: number; steps: { currentStep: string }[] } | null;
        if (!p) return b.finishedAt ? <span class="muted">done</span> : <span class="muted">—</span>;
        return (
          <span class="progress" title={p.steps.map((s) => s.currentStep).join(" › ")}>
            <span class="progress-bar" style={{ width: `${p.percentage}%` }} />
            <span class="progress-label">
              {p.percentage.toFixed(0)}% · {p.steps[p.steps.length - 1]?.currentStep}
            </span>
          </span>
        );
      },
    },
    { key: "status", title: "Status", width: 200, render: (b) => fmtCounts(b.stats?.status) },
    { key: "types", title: "Types", width: 280, render: (b) => fmtCounts(b.stats?.types) },
    { key: "indexes", title: "Indexes", width: 200, render: (b) => fmtCounts(b.stats?.indexUids) },
    { key: "startedAt", title: "Started", width: 180, render: (b) => formatDate(b.startedAt) },
    { key: "duration", title: "Duration", width: 130, render: (b) => b.duration ?? (b.progress ? "running…" : "—") },
    { key: "batchStrategy", title: "Why batched", width: 360 },
  ];

  return (
    <div class="page">
      <div class="page-head">
        <h2>Batches</h2>
        <span class="muted">{formatNumber(total())} total</span>
        <span class="muted small">{mode() === "stream" ? "● streaming" : "○ polling"}</span>
        <span class="grow" />
        <button class="square" onClick={load} title="Refresh">
          <IconRefresh />
        </button>
      </div>
      <div class="split">
        <div class="split-main">
          <VirtualTable count={batches().length} columns={columns} row={(i) => batches()[i]} selected={selected()} onRowClick={select} onRange={(_, end) => end > batches().length - 20 && loadMore()} />
        </div>
        <Show when={detail()}>
          <div class="split-side">
            <div class="side-head">
              <b>Batch {detail()!.uid}</b>
              <span class="grow" />
              <button class="icon-btn" onClick={() => (setSelected(undefined), setDetail(undefined))}>
                <IconX />
              </button>
            </div>
            <JsonEditor value={pretty(detail())} readOnly class="grow" />
          </div>
        </Show>
      </div>
    </div>
  );
}

function fmtCounts(m?: Record<string, number>) {
  return m
    ? Object.entries(m)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "—";
}
