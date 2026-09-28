import { For, Show, createResource, createSignal } from "solid-js";
import { api, notifyError, trackTask } from "../state/app";
import JsonEditor from "../components/JsonEditor";
import { ApiError, Confirm, Modal, formatDate, formatNumber, pretty } from "../components/ui";

interface Rule {
  uid: string;
  description?: string | null;
  precedence?: number | null;
  active?: boolean | null;
  lastUpdatedAt?: string | null;
  conditions?: unknown;
  actions?: unknown;
}

const TEMPLATE = {
  description: "Pin a promoted product for 'black friday' searches",
  precedence: 10,
  active: true,
  conditions: { query: { words: "black friday" }, time: { start: null, end: null } },
  actions: { pin: [{ id: "1", position: 0 }], scale: [] },
};

const PAGE = 50;

export default function SearchRulesView() {
  const [query, setQuery] = createSignal("");
  const [activeOnly, setActiveOnly] = createSignal<"" | "true" | "false">("");
  const [offset, setOffset] = createSignal(0);
  const [editing, setEditing] = createSignal<{ uid: string; isNew: boolean; text: string }>();
  const [confirm, setConfirm] = createSignal<{ kind: "one"; uid: string } | { kind: "all" }>();

  const [page, { refetch }] = createResource(
    () => ({ q: query(), a: activeOnly(), o: offset() }),
    ({ q, a, o }) =>
      api().req<{ results: Rule[]; total: number }>("POST", "/dynamic-search-rules", {
        body: { offset: o, limit: PAGE, filter: q || a ? { query: q || null, active: a ? a === "true" : null } : null },
      }),
  );

  const open = async (uid?: string) => {
    if (!uid) return setEditing({ uid: "", isNew: true, text: pretty(TEMPLATE) });
    try {
      const { uid: _u, lastUpdatedAt: _l, ...rest } = await api().req<Rule>("GET", "/dynamic-search-rules/{uid}", { path: { uid } });
      setEditing({ uid, isNew: false, text: pretty(rest) });
    } catch (e) {
      notifyError(e);
    }
  };

  const save = async () => {
    const e = editing()!;
    let body: unknown;
    try {
      body = JSON.parse(e.text);
    } catch (err) {
      return notifyError(err, "Invalid JSON");
    }
    setEditing(undefined);
    const t = await trackTask(api().req("PATCH", "/dynamic-search-rules/{uid}", { path: { uid: e.uid }, body }), `Save search rule ${e.uid}`);
    if (t?.status === "succeeded") refetch();
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Search rules</h2>
        <span class="muted small">Dynamic search rules pin, boost or demote documents when conditions match. Experimental API.</span>
        <span class="grow" />
        <button onClick={refetch}>↻</button>
        <button class="danger" onClick={() => setConfirm({ kind: "all" })}>
          Delete all…
        </button>
        <button class="primary" onClick={() => open()}>
          + New rule
        </button>
      </div>
      <div class="toolbar">
        <input placeholder="Rule name pattern, e.g. promo*" value={query()} onInput={(e) => (setOffset(0), setQuery(e.currentTarget.value))} />
        <select value={activeOnly()} onChange={(e) => (setOffset(0), setActiveOnly(e.currentTarget.value as "" | "true" | "false"))}>
          <option value="">Active + inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
        <span class="grow" />
        <span class="muted small">{formatNumber(page.error ? undefined : page()?.total)} rules</span>
        <button disabled={offset() === 0} onClick={() => setOffset(Math.max(0, offset() - PAGE))}>
          ‹
        </button>
        <button disabled={!!page.error || !page() || offset() + PAGE >= page()!.total} onClick={() => setOffset(offset() + PAGE)}>
          ›
        </button>
      </div>
      <Show when={!page.error} fallback={<ApiError error={page.error} />}>
        <table class="grid">
          <thead>
            <tr>
              <th>UID</th>
              <th>Description</th>
              <th class="num">Precedence</th>
              <th>Active</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={page()?.results ?? []} fallback={<tr><td colspan="6" class="muted">No rules</td></tr>}>
              {(r) => (
                <tr class="clickable" onClick={() => open(r.uid)}>
                  <td class="mono">{r.uid}</td>
                  <td>{r.description}</td>
                  <td class="num">{r.precedence ?? "—"}</td>
                  <td>{r.active === false ? <span class="muted">no</span> : "yes"}</td>
                  <td class="small">{formatDate(r.lastUpdatedAt)}</td>
                  <td>
                    <button
                      class="link small err"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirm({ kind: "one", uid: r.uid });
                      }}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <Show when={editing()}>
        <Modal
          title={editing()!.isNew ? "New search rule" : `Edit rule ${editing()!.uid}`}
          onClose={() => setEditing(undefined)}
          wide
          actions={
            <>
              <button onClick={() => setEditing(undefined)}>Cancel</button>
              <button class="primary" disabled={!editing()!.uid.trim()} onClick={save}>
                Save
              </button>
            </>
          }
        >
          <Show when={editing()!.isNew}>
            <label class="field">
              <span>Rule UID</span>
              <input value={editing()!.uid} onInput={(e) => setEditing({ ...editing()!, uid: e.currentTarget.value })} autofocus />
            </label>
          </Show>
          <div class="editor-box">
            <JsonEditor value={editing()!.text} onChange={(t) => setEditing({ ...editing()!, text: t })} onSubmit={save} />
          </div>
          <p class="muted small">
            conditions: query (words, isEmpty) · time (start, end) · filter. actions: pin [{"{"}id, position, indexUid?{"}"}] · scale [{"{"}weight, ids? | filter?{"}"}] (weight &gt;1 boosts, &lt;1 demotes, 0 hides).
          </p>
        </Modal>
      </Show>
      <Show when={confirm()}>
        <Confirm
          title={confirm()!.kind === "all" ? "Delete all search rules" : "Delete search rule"}
          message={confirm()!.kind === "all" ? <>Delete every dynamic search rule on this server?</> : <>Delete rule {(confirm() as { uid: string }).uid}?</>}
          typeToConfirm={confirm()!.kind === "all" ? "delete all" : undefined}
          onClose={() => setConfirm(undefined)}
          onConfirm={async () => {
            const c = confirm()!;
            const t =
              c.kind === "all"
                ? await trackTask(api().req("DELETE", "/dynamic-search-rules"), "Delete all search rules")
                : await trackTask(api().req("DELETE", "/dynamic-search-rules/{uid}", { path: { uid: c.uid } }), `Delete rule ${c.uid}`);
            if (t) refetch();
          }}
        />
      </Show>
    </div>
  );
}
