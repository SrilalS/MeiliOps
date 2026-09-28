import { For, Show, createResource, createSignal } from "solid-js";
import { api, indexes, refreshIndexes, setView, trackTask } from "../../state/app";
import { Confirm, Modal, Spinner, Stat, formatBytes, formatDate, formatNumber } from "../../components/ui";

interface IndexStats {
  numberOfDocuments: number;
  indexSize?: number;
  usedIndexSize?: number;
  rawDocumentDbSize?: number;
  avgDocumentSize?: number;
  isIndexing: boolean;
  numberOfEmbeddings?: number;
  numberOfEmbeddedDocuments?: number;
  fieldDistribution: Record<string, number>;
}

interface FieldInfo {
  name: string;
  [k: string]: unknown;
}

export default function IndexOverviewTab(props: { uid: string }) {
  const info = () => indexes().find((i) => i.uid === props.uid);
  const [stats, { refetch }] = createResource(() => api().req<IndexStats>("GET", "/indexes/{index_uid}/stats", { path: { index_uid: props.uid } }));
  const [fields] = createResource(() =>
    api()
      .req<{ results: FieldInfo[]; total: number }>("POST", "/indexes/{index_uid}/fields", { path: { index_uid: props.uid }, body: { offset: 0, limit: 1000 } })
      .catch(() => undefined),
  );
  const [dialog, setDialog] = createSignal<"rename" | "pk" | "delete" | "swap" | "compact">();
  const [input, setInput] = createSignal("");

  const done = async (t: { status: string } | undefined, next?: () => void) => {
    if (t?.status === "succeeded") {
      await refreshIndexes();
      next ? next() : refetch();
    }
  };

  return (
    <div class="page-body">
      <div class="row wrap">
        <button
          onClick={() => {
            setInput(props.uid);
            setDialog("rename");
          }}
        >
          Rename
        </button>
        <button
          onClick={() => {
            setInput(info()?.primaryKey ?? "");
            setDialog("pk");
          }}
        >
          Change primary key
        </button>
        <button
          onClick={() => {
            setInput("");
            setDialog("swap");
          }}
        >
          Swap with…
        </button>
        <button onClick={() => setDialog("compact")}>Compact</button>
        <span class="grow" />
        <button class="danger" onClick={() => setDialog("delete")}>
          Delete index
        </button>
      </div>

      <Show when={stats()} fallback={<Spinner />}>
        <div class="stats-row">
          <Stat label="Documents" value={formatNumber(stats()!.numberOfDocuments)} />
          <Stat label="Index size" value={formatBytes(stats()!.indexSize)} />
          <Stat label="Used index size" value={formatBytes(stats()!.usedIndexSize)} />
          <Stat label="Raw doc DB size" value={formatBytes(stats()!.rawDocumentDbSize)} />
          <Stat label="Avg doc size" value={formatBytes(stats()!.avgDocumentSize)} />
          <Stat label="Embeddings" value={formatNumber(stats()!.numberOfEmbeddings)} />
          <Stat label="Embedded docs" value={formatNumber(stats()!.numberOfEmbeddedDocuments)} />
          <Stat label="Status" value={stats()!.isIndexing ? <span class="warn">indexing</span> : "idle"} />
        </div>
      </Show>
      <div class="muted small">
        Primary key <code>{info()?.primaryKey ?? "—"}</code> · created {formatDate(info()?.createdAt)} · updated {formatDate(info()?.updatedAt)}
      </div>

      <h3>Fields</h3>
      <table class="grid">
        <thead>
          <tr>
            <th>Field</th>
            <th class="num">Documents with field</th>
            <th>Capabilities</th>
          </tr>
        </thead>
        <tbody>
          <For each={Object.entries(stats()?.fieldDistribution ?? {}).sort((a, b) => b[1] - a[1])}>
            {([name, count]) => {
              const f = () => fields()?.results.find((x) => x.name === name);
              return (
                <tr>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td class="num">
                    {formatNumber(count)}
                    <span class="muted small"> ({stats()!.numberOfDocuments ? Math.round((count / stats()!.numberOfDocuments) * 100) : 0}%)</span>
                  </td>
                  <td class="small">{f() ? capabilities(f()!) : <span class="muted">—</span>}</td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>

      <Show when={dialog() === "rename"}>
        <Modal
          title="Rename index"
          onClose={() => setDialog(undefined)}
          actions={
            <button
              class="primary"
              disabled={!input() || input() === props.uid}
              onClick={async () => {
                const to = input();
                setDialog(undefined);
                await done(await trackTask(api().req("PATCH", "/indexes/{index_uid}", { path: { index_uid: props.uid }, body: { uid: to } }), `Rename ${props.uid} → ${to}`), () =>
                  setView({ kind: "index", uid: to, tab: "overview" }),
                );
              }}
            >
              Rename
            </button>
          }
        >
          <label class="field">
            <span>New UID</span>
            <input value={input()} onInput={(e) => setInput(e.currentTarget.value)} autofocus />
          </label>
        </Modal>
      </Show>
      <Show when={dialog() === "pk"}>
        <Modal
          title="Change primary key"
          onClose={() => setDialog(undefined)}
          actions={
            <button
              class="primary"
              onClick={async () => {
                const pk = input();
                setDialog(undefined);
                await done(await trackTask(api().req("PATCH", "/indexes/{index_uid}", { path: { index_uid: props.uid }, body: { primaryKey: pk } }), `Set primary key of ${props.uid}`));
              }}
            >
              Save
            </button>
          }
        >
          <p class="muted small">Only possible while the index has no documents.</p>
          <label class="field">
            <span>Primary key</span>
            <input value={input()} onInput={(e) => setInput(e.currentTarget.value)} autofocus />
          </label>
        </Modal>
      </Show>
      <Show when={dialog() === "swap"}>
        <Modal
          title={`Swap ${props.uid} with…`}
          onClose={() => setDialog(undefined)}
          actions={
            <button
              class="primary"
              disabled={!input()}
              onClick={async () => {
                const other = input();
                setDialog(undefined);
                await done(await trackTask(api().req("POST", "/swap-indexes", { body: [{ indexes: [props.uid, other] }] }), `Swap ${props.uid} ⇄ ${other}`));
              }}
            >
              Swap
            </button>
          }
        >
          <p class="muted small">Atomically exchanges documents, settings and task history between the two indexes.</p>
          <label class="field">
            <span>Other index</span>
            <select value={input()} onChange={(e) => setInput(e.currentTarget.value)}>
              <option value="">Select…</option>
              <For each={indexes().filter((i) => i.uid !== props.uid)}>{(i) => <option value={i.uid}>{i.uid}</option>}</For>
            </select>
          </label>
        </Modal>
      </Show>
      <Show when={dialog() === "compact"}>
        <Confirm
          title="Compact index"
          message={<>Defragment the on-disk database of {props.uid}. Improves performance after many updates; runs as a task.</>}
          confirmText="Compact"
          onClose={() => setDialog(undefined)}
          onConfirm={async () => done(await trackTask(api().req("POST", "/indexes/{index_uid}/compact", { path: { index_uid: props.uid } }), `Compact ${props.uid}`))}
        />
      </Show>
      <Show when={dialog() === "delete"}>
        <Confirm
          title="Delete index"
          message={<>Permanently delete {props.uid}, all its documents and settings.</>}
          typeToConfirm={props.uid}
          onClose={() => setDialog(undefined)}
          onConfirm={async () =>
            done(await trackTask(api().req("DELETE", "/indexes/{index_uid}", { path: { index_uid: props.uid } }), `Delete index ${props.uid}`), () => setView({ kind: "overview" }))
          }
        />
      </Show>
    </div>
  );
}

function capabilities(f: FieldInfo): string {
  const flags: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === "name") continue;
    if (v && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (v2 === true) flags.push(`${k}.${k2}`);
      if ((v as { enabled?: boolean }).enabled === true) flags.push(k);
    } else if (v === true) flags.push(k);
  }
  return [...new Set(flags)].join(", ") || "—";
}
