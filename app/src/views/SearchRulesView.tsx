import { For, Show, createResource, createSignal } from "solid-js";
import { api, notifyError, trackTask } from "../state/app";
import JsonEditor from "../components/JsonEditor";
import { ApiError, Confirm, Modal, formatDate, formatNumber, pretty } from "../components/ui";
import { IconPlus, IconRefresh } from "../components/icons";
import Requires from "../components/Requires";
import { needs } from "../lib/compat";

interface Rule {
  uid: string;
  description?: string | null;
  precedence?: number | null;
  active?: boolean | null;
  lastUpdatedAt?: string | null;
  conditions?: unknown;
  actions?: unknown;
  needsProcessing?: boolean | null;
}

interface RulePage {
  results: Rule[];
  total: number;
  // Only with showTarget (Enterprise Edition).
  totalRuleCount?: number | null;
  targetTotalRuleCount?: number | null;
  needsProcessing?: boolean | null;
  taskUids?: number[] | null;
}

interface RuleTarget {
  current?: Record<string, unknown> | null;
  target?: Record<string, unknown> | null;
  taskUids: number[];
  needsProcessing: boolean;
}

// `target` only lists the fields pending tasks will change, so overlay it on `current`.
const targetState = (t: RuleTarget) => (t.target === null ? null : { ...(t.current ?? {}), ...(t.target ?? {}) });

const TEMPLATE = {
  description: "Pin a promoted product for 'black friday' searches",
  precedence: 10,
  active: true,
  conditions: { query: { words: "black friday" }, time: { start: null, end: null } },
  actions: { pin: [{ id: "1", position: 0 }], scale: [] },
};

const PAGE = 50;

export default function SearchRulesView() {
  return (
    <Requires op="POST /dynamic-search-rules" feature="Search rules">
      <SearchRules />
    </Requires>
  );
}

function SearchRules() {
  const [query, setQuery] = createSignal("");
  const [activeOnly, setActiveOnly] = createSignal<"" | "true" | "false">("");
  const [offset, setOffset] = createSignal(0);
  const [editing, setEditing] = createSignal<{ uid: string; isNew: boolean; text: string }>();
  const [confirm, setConfirm] = createSignal<{ kind: "one"; uid: string } | { kind: "all" }>();
  const [showTarget, setShowTarget] = createSignal(false);
  const [target, setTarget] = createSignal<{ uid: string; data: RuleTarget }>();

  const [page, { refetch }] = createResource(
    () => ({ q: query(), a: activeOnly(), o: offset(), t: showTarget() }),
    ({ q, a, o, t }) =>
      api().req<RulePage>("POST", "/dynamic-search-rules", {
        body: { offset: o, limit: PAGE, filter: q || a ? { query: q || null, active: a ? a === "true" : null } : null, ...(t ? { showTarget: true } : {}) },
      }),
  );

  const openTarget = async (uid: string) => {
    try {
      setTarget({ uid, data: await api().req<RuleTarget>("GET", "/dynamic-search-rules/{uid}/target", { path: { uid } }) });
    } catch (e) {
      notifyError(e);
    }
  };

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
        <button class="square" onClick={refetch} title="Refresh">
          <IconRefresh />
        </button>
        <button class="danger" disabled={!!needs("DELETE /dynamic-search-rules")} title={needs("DELETE /dynamic-search-rules")} onClick={() => setConfirm({ kind: "all" })}>
          Delete all…
        </button>
        <button class="primary" onClick={() => open()}>
          <IconPlus /> New rule
        </button>
      </div>
      <div class="toolbar">
        <input placeholder="Rule name pattern, e.g. promo*" value={query()} onInput={(e) => (setOffset(0), setQuery(e.currentTarget.value))} />
        <select value={activeOnly()} onChange={(e) => (setOffset(0), setActiveOnly(e.currentTarget.value as "" | "true" | "false"))}>
          <option value="">Active + inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
        {/* showTarget shipped with the target route (1.57). */}
        <label class="check" title={needs("GET /dynamic-search-rules/{uid}/target") ?? "Include the effect of pending rule tasks (showTarget). Requires the Enterprise Edition."}>
          <input type="checkbox" disabled={!!needs("GET /dynamic-search-rules/{uid}/target")} checked={showTarget()} onChange={(e) => (setOffset(0), setShowTarget(e.currentTarget.checked))} /> Show pending
        </label>
        <span class="grow" />
        <Show when={showTarget() && !page.error && page()}>
          {(p) => (
            <span class="muted small" title={p().taskUids?.length ? `Pending tasks: ${p().taskUids!.join(", ")}` : undefined}>
              <Show when={p().needsProcessing} fallback="no pending tasks">
                <span class="pill status-enqueued">{formatNumber(p().taskUids?.length ?? 0)} pending</span>{" "}
                {formatNumber(p().totalRuleCount ?? undefined)} → {formatNumber(p().targetTotalRuleCount ?? undefined)} rules ·
              </Show>
            </span>
          )}
        </Show>
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
                  <td class="mono">
                    {r.uid}
                    <Show when={r.needsProcessing}>
                      {" "}
                      <span class="pill status-enqueued" title="Pending tasks will change this rule">pending</span>
                    </Show>
                  </td>
                  <td>{r.description}</td>
                  <td class="num">{r.precedence ?? "—"}</td>
                  <td>{r.active === false ? <span class="muted">no</span> : "yes"}</td>
                  <td class="small">{formatDate(r.lastUpdatedAt)}</td>
                  <td class="nowrap">
                    <button
                      class="link small"
                      disabled={!!needs("GET /dynamic-search-rules/{uid}/target")}
                      title={needs("GET /dynamic-search-rules/{uid}/target") ?? "State after all pending tasks for this rule are processed. Requires the Enterprise Edition."}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTarget(r.uid);
                      }}
                    >
                      target
                    </button>{" "}
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
      <Show when={target()}>
        {(t) => (
          <Modal title={`Target state of ${t().uid}`} onClose={() => setTarget(undefined)} wide actions={<button onClick={() => setTarget(undefined)}>Close</button>}>
            <p class="muted small">
              <Show when={t().data.needsProcessing} fallback="No pending tasks: the target state is the current state.">
                Pending tasks {t().data.taskUids.join(", ")} will change this rule.{" "}
                {t().data.current === null ? "The rule doesn't exist yet. " : ""}
                {t().data.target === null ? "The rule will be deleted." : "Highlighted lines are the changes."}
              </Show>
            </p>
            <div class="editor-box">
              <JsonEditor value={pretty(targetState(t().data))} original={pretty(t().data.current ?? null)} readOnly />
            </div>
          </Modal>
        )}
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
