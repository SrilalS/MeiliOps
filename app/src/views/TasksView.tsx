import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Task } from "../api/meili";
import { api, indexes, notifyError, refreshIndexes, trackTask } from "../state/app";
import VirtualTable, { Column } from "../components/VirtualTable";
import JsonEditor from "../components/JsonEditor";
import { Confirm, StatusPill, formatDate, formatNumber, pretty } from "../components/ui";

const STATUSES = ["enqueued", "processing", "succeeded", "failed", "canceled"];

export default function TasksView() {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [total, setTotal] = createSignal<number>();
  const [next, setNext] = createSignal<number | null>(null);
  const [status, setStatus] = createSignal("");
  const [type, setType] = createSignal("");
  const [index, setIndex] = createSignal("");
  const [auto, setAuto] = createSignal(true);
  const [selected, setSelected] = createSignal<number>();
  const [payload, setPayload] = createSignal<string>();
  const [confirm, setConfirm] = createSignal<"cancel" | "delete">();
  let loadingMore = false;

  const filters = () => ({ statuses: status() || undefined, types: type() || undefined, indexUids: index() || undefined });

  const load = async () => {
    try {
      const r = await api().req<{ results: Task[]; total: number; next: number | null }>("GET", "/tasks", { query: { ...filters(), limit: 200 } });
      setTasks(r.results);
      setTotal(r.total);
      setNext(r.next);
    } catch (e) {
      notifyError(e, "Failed to load tasks");
    }
  };

  const loadMore = async () => {
    if (loadingMore || next() === null) return;
    loadingMore = true;
    try {
      const r = await api().req<{ results: Task[]; next: number | null }>("GET", "/tasks", { query: { ...filters(), limit: 200, from: next() } });
      setTasks((t) => [...t, ...r.results]);
      setNext(r.next);
    } finally {
      loadingMore = false;
    }
  };

  onMount(load);
  const timer = setInterval(() => auto() && !loadingMore && tasks().length <= 200 && load(), 2000);
  onCleanup(() => clearInterval(timer));

  const columns: Column<Task>[] = [
    { key: "uid", title: "UID", width: 80 },
    { key: "status", title: "Status", width: 110, render: (t) => <StatusPill status={t.status} /> },
    { key: "type", title: "Type", width: 220 },
    { key: "indexUid", title: "Index", width: 160 },
    { key: "batchUid", title: "Batch", width: 70 },
    { key: "enqueuedAt", title: "Enqueued", width: 180, render: (t) => formatDate(t.enqueuedAt) },
    { key: "duration", title: "Duration", width: 130, render: (t) => t.duration ?? "—" },
    { key: "error", title: "Error", width: 400, render: (t) => <span class="err">{t.error?.message ?? ""}</span> },
  ];

  const task = () => (selected() === undefined ? undefined : tasks()[selected()!]);

  const loadPayload = async () => {
    const t = task();
    if (!t) return;
    try {
      const res = await api().req<Response>("GET", "/tasks/{task_id}/documents", { path: { task_id: t.uid }, raw: true });
      const text = await res.text();
      setPayload(text.length > 2_000_000 ? text.slice(0, 2_000_000) + "\n… (truncated)" : text);
    } catch (e) {
      notifyError(e, "Task payload");
    }
  };

  const filterQuery = () => {
    const f = filters();
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v) q[k] = v;
    return q;
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Tasks</h2>
        <span class="muted">{formatNumber(total())} total</span>
        <span class="grow" />
        <label class="inline-label">
          <input type="checkbox" checked={auto()} onChange={(e) => setAuto(e.currentTarget.checked)} /> live
        </label>
        <button onClick={load}>↻</button>
      </div>
      <div class="toolbar">
        <select value={status()} onChange={(e) => (setStatus(e.currentTarget.value), load())}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option value={s}>{s}</option>
          ))}
        </select>
        <input placeholder="types (comma separated)" value={type()} onChange={(e) => (setType(e.currentTarget.value), load())} />
        <select value={index()} onChange={(e) => (setIndex(e.currentTarget.value), load())}>
          <option value="">All indexes</option>
          {indexes().map((i) => (
            <option value={i.uid}>{i.uid}</option>
          ))}
        </select>
        <span class="grow" />
        <button onClick={() => setConfirm("cancel")}>Cancel matching…</button>
        <button class="danger" onClick={() => setConfirm("delete")}>
          Delete matching…
        </button>
      </div>
      <div class="split">
        <div class="split-main">
          <VirtualTable
            count={tasks().length}
            columns={columns}
            row={(i) => tasks()[i]}
            selected={selected()}
            onRowClick={(i) => (setSelected(i), setPayload(undefined))}
            onRange={(_, end) => end > tasks().length - 20 && loadMore()}
            empty="No tasks"
          />
        </div>
        <Show when={task()}>
          <div class="split-side">
            <div class="side-head">
              <b>Task {task()!.uid}</b>
              <span class="grow" />
              <Show when={task()!.status === "enqueued" || task()!.status === "processing"}>
                <button onClick={() => trackTask(api().req("POST", "/tasks/cancel", { query: { uids: task()!.uid } }), `Cancel task ${task()!.uid}`).then(load)}>Cancel task</button>
              </Show>
              <button onClick={loadPayload}>Payload</button>
              <button class="icon-btn" onClick={() => setSelected(undefined)}>
                ✕
              </button>
            </div>
            <JsonEditor value={payload() ?? pretty(task())} readOnly class="grow" />
          </div>
        </Show>
      </div>
      <Show when={confirm()}>
        <Confirm
          title={confirm() === "cancel" ? "Cancel tasks" : "Delete tasks"}
          message={
            <>
              {confirm() === "cancel" ? "Cancel" : "Delete from history"} every task matching the current filters
              {Object.keys(filterQuery()).length ? <code> {new URLSearchParams(filterQuery()).toString()}</code> : " (no filter: ALL tasks)"}?
              {confirm() === "delete" ? " Only finished tasks can be deleted." : ""}
            </>
          }
          confirmText={confirm() === "cancel" ? "Cancel tasks" : "Delete tasks"}
          onClose={() => setConfirm(undefined)}
          onConfirm={async () => {
            // Meilisearch requires at least one filter; use a statuses filter when none is set.
            const q = Object.keys(filterQuery()).length ? filterQuery() : { statuses: confirm() === "cancel" ? "enqueued,processing" : "succeeded,failed,canceled" };
            const t = confirm() === "cancel" ? await trackTask(api().req("POST", "/tasks/cancel", { query: q }), "Cancel tasks") : await trackTask(api().req("DELETE", "/tasks", { query: q }), "Delete tasks");
            if (t) {
              load();
              refreshIndexes();
            }
          }}
        />
      </Show>
    </div>
  );
}
