import { For, Show, createResource, createSignal } from "solid-js";
import { api, notify, notifyError } from "../state/app";
import { ApiError, Confirm, Modal, Spinner, pretty } from "../components/ui";
import JsonEditor from "../components/JsonEditor";
import { IconPlus, IconRefresh } from "../components/icons";

interface Webhook {
  uuid: string;
  url: string;
  headers: Record<string, string>;
  isEditable: boolean;
}

export default function WebhooksView() {
  const [hooks, { refetch }] = createResource(() => api().req<{ results: Webhook[] }>("GET", "/webhooks").then((r) => r.results));
  const [editing, setEditing] = createSignal<{ uuid?: string; text: string }>();
  const [deleting, setDeleting] = createSignal<Webhook>();

  const open = async (w?: Webhook) => {
    if (!w) return setEditing({ text: pretty({ url: "https://example.com/meilisearch-webhook", headers: { Authorization: "Bearer …" } }) });
    try {
      const full = await api().req<Webhook>("GET", "/webhooks/{uuid}", { path: { uuid: w.uuid } });
      setEditing({ uuid: w.uuid, text: pretty({ url: full.url, headers: full.headers }) });
    } catch (e) {
      notifyError(e);
    }
  };

  const save = async () => {
    const e = editing()!;
    try {
      const body = JSON.parse(e.text);
      if (e.uuid) await api().req("PATCH", "/webhooks/{uuid}", { path: { uuid: e.uuid }, body });
      else await api().req("POST", "/webhooks", { body });
      notify("success", "Webhook saved");
      setEditing(undefined);
      refetch();
    } catch (err) {
      notifyError(err, "Save webhook");
    }
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Webhooks</h2>
        <span class="muted small">Meilisearch calls these URLs when tasks finish.</span>
        <span class="grow" />
        <button class="square" onClick={refetch} title="Refresh">
          <IconRefresh />
        </button>
        <button class="primary" onClick={() => open()}>
          <IconPlus /> New webhook
        </button>
      </div>
      <Show when={!hooks.error} fallback={<ApiError error={hooks.error} />}>
        <Show when={hooks()} fallback={<Spinner />}>
          <table class="grid">
            <thead>
              <tr>
                <th>URL</th>
                <th>Headers</th>
                <th>UUID</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={hooks()} fallback={<tr><td colspan="4" class="muted">No webhooks</td></tr>}>
                {(w) => (
                  <tr>
                    <td class="mono small">{w.url}</td>
                    <td class="small">{Object.keys(w.headers ?? {}).join(", ") || "—"}</td>
                    <td class="mono small muted">{w.uuid}</td>
                    <td class="nowrap">
                      <Show when={w.isEditable} fallback={<span class="muted small">set by CLI</span>}>
                        <button class="link small" onClick={() => open(w)}>
                          edit
                        </button>{" "}
                        <button class="link small err" onClick={() => setDeleting(w)}>
                          delete
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
      <Show when={editing()}>
        <Modal
          title={editing()!.uuid ? "Edit webhook" : "New webhook"}
          onClose={() => setEditing(undefined)}
          wide
          actions={
            <>
              <button onClick={() => setEditing(undefined)}>Cancel</button>
              <button class="primary" onClick={save}>
                Save
              </button>
            </>
          }
        >
          <div class="editor-box">
            <JsonEditor value={editing()!.text} onChange={(t) => setEditing({ ...editing()!, text: t })} onSubmit={save} />
          </div>
        </Modal>
      </Show>
      <Show when={deleting()}>
        <Confirm
          title="Delete webhook"
          message={<>Delete webhook to {deleting()!.url}?</>}
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            try {
              await api().req("DELETE", "/webhooks/{uuid}", { path: { uuid: deleting()!.uuid } });
              refetch();
            } catch (e) {
              notifyError(e);
            }
          }}
        />
      </Show>
    </div>
  );
}
