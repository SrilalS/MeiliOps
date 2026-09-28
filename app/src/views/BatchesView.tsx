import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { api, notifyError } from "../state/app";
import VirtualTable, { Column } from "../components/VirtualTable";
import JsonEditor from "../components/JsonEditor";
import { formatDate, formatNumber, pretty } from "../components/ui";

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
  const timer = setInterval(() => batches().length <= 200 && load(), 3000);
  onCleanup(() => clearInterval(timer));

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
        <span class="grow" />
        <button onClick={load}>↻</button>
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
                ✕
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
