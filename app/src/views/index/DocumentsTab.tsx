import { Show, createMemo, createSignal, onMount } from "solid-js";
import { api, indexes, notifyError, refreshIndexes, trackTask } from "../../state/app";
import VirtualTable, { Column } from "../../components/VirtualTable";
import JsonEditor from "../../components/JsonEditor";
import { Confirm, Spinner, formatNumber, pretty } from "../../components/ui";
import { copyText, downloadText } from "../../lib/platform";
import AddDocumentsDialog from "./AddDocumentsDialog";
import DeleteByIdsDialog from "./DeleteByIdsDialog";
import EditByFunctionDialog from "./EditByFunctionDialog";

const PAGE = 100;
const MAX_COLS = 40;

type Doc = Record<string, unknown>;

export default function DocumentsTab(props: { uid: string }) {
  const primaryKey = () => indexes().find((i) => i.uid === props.uid)?.primaryKey ?? undefined;

  const [filterInput, setFilterInput] = createSignal("");
  const [sortInput, setSortInput] = createSignal("");
  const [query, setQuery] = createSignal({ filter: "", sort: "" });
  const [total, setTotal] = createSignal<number>();
  const [error, setError] = createSignal<string>();
  const [version, setVersion] = createSignal(0);
  const [columnKeys, setColumnKeys] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal<number>();
  const [editText, setEditText] = createSignal("");
  const [dialog, setDialog] = createSignal<"add" | "edit-fn" | "delete-ids" | "delete-filter" | "delete-all" | "delete-one">();
  const [exporting, setExporting] = createSignal(false);

  // Page cache. `generation` invalidates in-flight requests when the query changes.
  let pages = new Map<number, Doc[]>();
  let inflight = new Set<number>();
  let generation = 0;

  const body = (offset: number, limit: number) => {
    const q = query();
    const b: Record<string, unknown> = { offset, limit };
    if (q.filter.trim()) b.filter = q.filter.trim();
    if (q.sort.trim())
      b.sort = q.sort
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return b;
  };

  async function loadPage(p: number) {
    if (pages.has(p) || inflight.has(p)) return;
    const gen = generation;
    inflight.add(p);
    try {
      const res = await api().req<{ results: Doc[]; total: number }>("POST", "/indexes/{index_uid}/documents/fetch", {
        path: { index_uid: props.uid },
        body: body(p * PAGE, PAGE),
      });
      if (gen !== generation) return;
      pages.set(p, res.results);
      setTotal(res.total);
      setError(undefined);
      if (columnKeys().length === 0 && res.results.length) setColumnKeys(inferColumns(res.results, primaryKey()));
      setVersion((v) => v + 1);
    } catch (e) {
      if (gen === generation) setError(String((e as Error).message ?? e));
    } finally {
      inflight.delete(p);
    }
  }

  function reload(resetColumns = false) {
    generation++;
    pages = new Map();
    inflight = new Set();
    if (resetColumns) setColumnKeys([]);
    setSelected(undefined);
    setTotal(undefined);
    setVersion((v) => v + 1);
    loadPage(0);
  }

  onMount(() => loadPage(0));

  const row = (i: number): Doc | undefined => {
    version();
    return pages.get(Math.floor(i / PAGE))?.[i % PAGE];
  };

  const onRange = (start: number, end: number) => {
    for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
  };

  const columns = createMemo<Column<Doc>[]>(() =>
    columnKeys().map((k) => ({ key: k, title: k, width: k === primaryKey() ? 120 : widthFor(k) })),
  );

  const selectedDoc = createMemo(() => {
    const i = selected();
    return i === undefined ? undefined : row(i);
  });

  const selectRow = (i: number) => {
    setSelected(i);
    const d = row(i);
    if (d) setEditText(pretty(d));
  };

  const docId = () => {
    const d = selectedDoc();
    const pk = primaryKey();
    return d && pk ? (d[pk] as string | number) : undefined;
  };

  const afterWrite = async (t: { status: string } | undefined) => {
    if (t?.status === "succeeded") {
      reload();
      refreshIndexes();
    }
  };

  const saveDoc = async () => {
    let doc: Doc;
    try {
      doc = JSON.parse(editText());
    } catch (e) {
      return notifyError(e, "Invalid JSON");
    }
    await afterWrite(
      await trackTask(
        api().req("PUT", "/indexes/{index_uid}/documents", { path: { index_uid: props.uid }, body: [doc] }),
        `Update document ${docId() ?? ""} in ${props.uid}`,
      ),
    );
  };

  const reloadDoc = async () => {
    try {
      const d = await api().req<Doc>("GET", "/indexes/{index_uid}/documents/{document_id}", { path: { index_uid: props.uid, document_id: docId()! } });
      setEditText(pretty(d));
    } catch (e) {
      notifyError(e, "Reload document");
    }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const out: Doc[] = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await api().req<{ results: Doc[]; total: number }>("POST", "/indexes/{index_uid}/documents/fetch", {
          path: { index_uid: props.uid },
          body: body(offset, 1000),
        });
        out.push(...res.results);
        if (res.results.length < 1000) break;
      }
      downloadText(`${props.uid}.json`, JSON.stringify(out));
    } catch (e) {
      notifyError(e, "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const apply = () => {
    setQuery({ filter: filterInput(), sort: sortInput() });
    reload();
  };

  return (
    <div class="docs-tab">
      <div class="toolbar">
        <input
          class="grow mono"
          placeholder='Filter, e.g. genres = "Drama" AND release_date > 946684800'
          value={filterInput()}
          onInput={(e) => setFilterInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <input
          class="mono sort-input"
          placeholder="Sort, e.g. release_date:desc"
          value={sortInput()}
          onInput={(e) => setSortInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
        <button onClick={apply}>Apply</button>
        <button onClick={() => reload(true)} title="Reload">
          ↻
        </button>
        <span class="sep" />
        <button class="primary" onClick={() => setDialog("add")}>
          + Add documents
        </button>
        <button onClick={exportAll} disabled={exporting()}>
          {exporting() ? "Exporting…" : "Export JSON"}
        </button>
        <details class="menu">
          <summary>More ▾</summary>
          <div class="menu-items">
            <button onClick={() => setDialog("edit-fn")}>Edit with function… (experimental)</button>
            <button onClick={() => setDialog("delete-ids")}>Delete by IDs…</button>
            <button disabled={!query().filter.trim()} onClick={() => setDialog("delete-filter")}>
              Delete matching current filter…
            </button>
            <button class="danger" onClick={() => setDialog("delete-all")}>
              Delete ALL documents…
            </button>
          </div>
        </details>
      </div>

      <div class="muted small toolbar-info">
        <Show when={total() !== undefined} fallback={<Spinner />}>
          {formatNumber(total())} documents{query().filter ? " match the filter" : ""}
        </Show>
        <Show when={error()}>
          <span class="err"> · {error()}</span>
        </Show>
      </div>

      <div class="split">
        <div class="split-main">
          <VirtualTable
            count={total() ?? 0}
            columns={columns()}
            row={row}
            onRange={onRange}
            onRowClick={selectRow}
            selected={selected()}
            empty={total() === undefined ? "Loading…" : "No documents"}
          />
        </div>
        <Show when={selected() !== undefined}>
          <div class="split-side">
            <div class="side-head">
              <b class="ellipsis">Document {String(docId() ?? "")}</b>
              <span class="grow" />
              <button class="icon-btn" onClick={() => setSelected(undefined)} title="Close">
                ✕
              </button>
            </div>
            <JsonEditor value={editText()} onChange={setEditText} onSubmit={saveDoc} class="grow" />
            <div class="side-actions">
              <button class="primary" onClick={saveDoc} title="Ctrl+Enter">
                Save
              </button>
              <button onClick={() => copyText(editText())}>Copy</button>
              <button disabled={docId() === undefined} onClick={reloadDoc} title="Fetch this document again from the server">
                Reload
              </button>
              <span class="grow" />
              <button class="danger" disabled={docId() === undefined} onClick={() => setDialog("delete-one")}>
                Delete
              </button>
            </div>
          </div>
        </Show>
      </div>

      <Show when={dialog() === "add"}>
        <AddDocumentsDialog uid={props.uid} onClose={() => setDialog(undefined)} onDone={afterWrite} />
      </Show>
      <Show when={dialog() === "edit-fn"}>
        <EditByFunctionDialog uid={props.uid} filter={query().filter} onClose={() => setDialog(undefined)} onDone={afterWrite} />
      </Show>
      <Show when={dialog() === "delete-ids"}>
        <DeleteByIdsDialog uid={props.uid} onClose={() => setDialog(undefined)} onDone={afterWrite} />
      </Show>
      <Show when={dialog() === "delete-one"}>
        <Confirm
          title="Delete document"
          message={<>Delete document <code>{String(docId())}</code> from {props.uid}?</>}
          onClose={() => setDialog(undefined)}
          onConfirm={async () => {
            await afterWrite(
              await trackTask(
                api().req("DELETE", "/indexes/{index_uid}/documents/{document_id}", { path: { index_uid: props.uid, document_id: docId()! } }),
                `Delete document ${docId()}`,
              ),
            );
          }}
        />
      </Show>
      <Show when={dialog() === "delete-filter"}>
        <Confirm
          title="Delete by filter"
          message={
            <>
              Delete all {formatNumber(total())} documents matching <code>{query().filter}</code>?
            </>
          }
          onClose={() => setDialog(undefined)}
          onConfirm={async () => {
            await afterWrite(
              await trackTask(
                api().req("POST", "/indexes/{index_uid}/documents/delete", { path: { index_uid: props.uid }, body: { filter: query().filter } }),
                `Delete by filter in ${props.uid}`,
              ),
            );
          }}
        />
      </Show>
      <Show when={dialog() === "delete-all"}>
        <Confirm
          title="Delete all documents"
          message={<>This removes every document in {props.uid}. Settings are kept.</>}
          typeToConfirm={props.uid}
          confirmText="Delete all"
          onClose={() => setDialog(undefined)}
          onConfirm={async () => {
            await afterWrite(await trackTask(api().req("DELETE", "/indexes/{index_uid}/documents", { path: { index_uid: props.uid } }), `Delete all documents in ${props.uid}`));
          }}
        />
      </Show>
    </div>
  );
}

function inferColumns(docs: Doc[], pk?: string): string[] {
  const seen = new Set<string>();
  if (pk) seen.add(pk);
  for (const d of docs.slice(0, 50)) for (const k of Object.keys(d)) if (k !== "_vectors") seen.add(k);
  return [...seen].slice(0, MAX_COLS);
}

function widthFor(key: string) {
  if (/overview|description|body|content|text/i.test(key)) return 360;
  if (/title|name/i.test(key)) return 240;
  return 160;
}
