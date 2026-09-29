import { For, Show, createResource, createSignal } from "solid-js";
import { api, indexes, notify, notifyError } from "../state/app";
import { ApiError, Confirm, Modal, Spinner, formatDate, pretty } from "../components/ui";
import JsonEditor from "../components/JsonEditor";
import { copyText } from "../lib/platform";
import { signTenantToken } from "../lib/tenantToken";
import { IconClipboard, IconEye, IconEyeOff, IconInfo, IconPencil, IconPlus, IconRefresh, IconTicket, IconTrash } from "../components/icons";

interface ApiKey {
  uid: string;
  key: string;
  name: string | null;
  description: string | null;
  actions: string[];
  indexes: string[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const KEY_ACTIONS = [
  "*", "search",
  "documents.*", "documents.add", "documents.get", "documents.delete",
  "indexes.*", "indexes.create", "indexes.get", "indexes.update", "indexes.delete", "indexes.swap", "indexes.compact",
  "tasks.*", "tasks.get", "tasks.cancel", "tasks.delete", "tasks.compact",
  "settings.*", "settings.get", "settings.update",
  "stats.*", "stats.get", "metrics.*", "metrics.get",
  "dumps.*", "dumps.create", "snapshots.*", "snapshots.create",
  "version", "keys.create", "keys.get", "keys.update", "keys.delete",
  "experimental.get", "experimental.update", "export", "network.get", "network.update",
  "chatCompletions", "chats.*", "chats.get", "chats.delete", "chatsSettings.*", "chatsSettings.get", "chatsSettings.update",
  "*.get", "webhooks.*", "webhooks.get", "webhooks.create", "webhooks.update", "webhooks.delete",
  "fields.post", "dynamicSearchRules.*", "dynamicSearchRules.get", "dynamicSearchRules.create", "dynamicSearchRules.update", "dynamicSearchRules.delete",
];

export default function KeysView() {
  const [keys, { refetch }] = createResource(async () => {
    const all: ApiKey[] = [];
    for (let offset = 0; ; offset += 100) {
      const r = await api().req<{ results: ApiKey[]; total: number }>("GET", "/keys", { query: { offset, limit: 100 } });
      all.push(...r.results);
      if (all.length >= r.total || !r.results.length) break;
    }
    return all;
  });
  const [dialog, setDialog] = createSignal<{ kind: "create" } | { kind: "edit" | "delete" | "token" | "view"; key: ApiKey }>();
  const [reveal, setReveal] = createSignal<Record<string, boolean>>({});

  return (
    <div class="page">
      <div class="page-head">
        <h2>API keys</h2>
        <span class="grow" />
        <button class="square" onClick={refetch} title="Refresh">
          <IconRefresh />
        </button>
        <button class="primary" onClick={() => setDialog({ kind: "create" })}>
          <IconPlus /> New key
        </button>
      </div>
      <Show when={!keys.error} fallback={<ApiError error={keys.error} />}>
        <Show when={keys()} fallback={<Spinner />}>
          <table class="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Actions</th>
                <th>Indexes</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={keys()}>
                {(k) => (
                  <tr>
                    <td>
                      <b>{k.name ?? <span class="muted">(unnamed)</span>}</b>
                      <div class="muted small">{k.description}</div>
                    </td>
                    <td class="nowrap">
                      <span class="key-cell">
                        <code>{reveal()[k.uid] ? k.key : k.key.slice(0, 8) + "••••••••"}</code>
                        <button class="icon-btn" title={reveal()[k.uid] ? "Hide key" : "Show key"} onClick={() => setReveal({ ...reveal(), [k.uid]: !reveal()[k.uid] })}>
                          <Show when={reveal()[k.uid]} fallback={<IconEye />}>
                            <IconEyeOff />
                          </Show>
                        </button>
                        <button class="icon-btn" title="Copy key" onClick={() => copyText(k.key).then(() => notify("info", "Key copied"))}>
                          <IconClipboard />
                        </button>
                      </span>
                    </td>
                    <td class="small">{k.actions.join(", ")}</td>
                    <td class="small">{k.indexes.join(", ")}</td>
                    <td class="small">{k.expiresAt ? formatDate(k.expiresAt) : <span class="muted">never</span>}</td>
                    <td class="nowrap row-actions">
                      <button class="icon-btn" title="Details" onClick={() => setDialog({ kind: "view", key: k })}>
                        <IconInfo />
                      </button>
                      <button class="icon-btn" title="Edit" onClick={() => setDialog({ kind: "edit", key: k })}>
                        <IconPencil />
                      </button>
                      <Show when={k.actions.includes("search") || k.actions.includes("*")}>
                        <button class="icon-btn" title="Generate a tenant token" onClick={() => setDialog({ kind: "token", key: k })}>
                          <IconTicket />
                        </button>
                      </Show>
                      <button class="icon-btn danger" title="Delete" onClick={() => setDialog({ kind: "delete", key: k })}>
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>

      <Show when={dialog()?.kind === "create"}>
        <CreateKeyDialog onClose={() => setDialog(undefined)} onDone={refetch} />
      </Show>
      <Show when={dialog()?.kind === "edit" && (dialog() as { key: ApiKey }).key} keyed>
        {(k) => <EditKeyDialog k={k} onClose={() => setDialog(undefined)} onDone={refetch} />}
      </Show>
      <Show when={dialog()?.kind === "view" && (dialog() as { key: ApiKey }).key} keyed>
        {(k) => <ViewKeyDialog k={k} onClose={() => setDialog(undefined)} />}
      </Show>
      <Show when={dialog()?.kind === "token" && (dialog() as { key: ApiKey }).key} keyed>
        {(k) => <TenantTokenDialog k={k} onClose={() => setDialog(undefined)} />}
      </Show>
      <Show when={dialog()?.kind === "delete" && (dialog() as { key: ApiKey }).key} keyed>
        {(k) => (
          <Confirm
            title="Delete API key"
            message={<>Delete key “{k.name ?? k.uid}”? Any app using it stops working immediately.</>}
            onClose={() => setDialog(undefined)}
            onConfirm={async () => {
              try {
                await api().req("DELETE", "/keys/{key}", { path: { key: k.uid } });
                notify("success", "Key deleted");
                refetch();
              } catch (e) {
                notifyError(e);
              }
            }}
          />
        )}
      </Show>
    </div>
  );
}

function ViewKeyDialog(props: { k: ApiKey; onClose: () => void }) {
  const [detail] = createResource(() => api().req("GET", "/keys/{key}", { path: { key: props.k.uid } }));
  return (
    <Modal title={props.k.name ?? props.k.uid} onClose={props.onClose} wide>
      <div class="editor-box">
        <JsonEditor value={pretty(detail() ?? props.k)} readOnly />
      </div>
    </Modal>
  );
}

function CreateKeyDialog(props: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [actions, setActions] = createSignal<string[]>(["search"]);
  const [idx, setIdx] = createSignal("*");
  const [expires, setExpires] = createSignal("");
  const toggle = (a: string) => setActions(actions().includes(a) ? actions().filter((x) => x !== a) : [...actions(), a]);

  const create = async () => {
    try {
      const k = await api().req<ApiKey>("POST", "/keys", {
        body: {
          name: name() || null,
          description: description() || null,
          actions: actions(),
          indexes: idx()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expiresAt: expires() ? new Date(expires()).toISOString() : null,
        },
      });
      await copyText(k.key).catch(() => undefined);
      notify("success", "Key created and copied to clipboard");
      props.onDone();
      props.onClose();
    } catch (e) {
      notifyError(e, "Create key");
    }
  };

  return (
    <Modal
      title="New API key"
      onClose={props.onClose}
      wide
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!actions().length} onClick={create}>
            Create
          </button>
        </>
      }
    >
      <div class="row wrap">
        <label class="field grow">
          <span>Name</span>
          <input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Expires (optional)</span>
          <input type="datetime-local" value={expires()} onInput={(e) => setExpires(e.currentTarget.value)} />
        </label>
      </div>
      <label class="field">
        <span>Description</span>
        <input value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Indexes (comma separated, * for all, wildcards like movies_* allowed)</span>
        <input value={idx()} onInput={(e) => setIdx(e.currentTarget.value)} list="index-names" />
        <datalist id="index-names">
          <For each={indexes()}>{(i) => <option value={i.uid} />}</For>
        </datalist>
      </label>
      <div class="field">
        <span>Actions</span>
        <div class="checks">
          <For each={KEY_ACTIONS}>
            {(a) => (
              <label class="check">
                <input type="checkbox" checked={actions().includes(a)} onChange={() => toggle(a)} /> {a}
              </label>
            )}
          </For>
        </div>
      </div>
    </Modal>
  );
}

function EditKeyDialog(props: { k: ApiKey; onClose: () => void; onDone: () => void }) {
  const [name, setName] = createSignal(props.k.name ?? "");
  const [description, setDescription] = createSignal(props.k.description ?? "");
  const save = async () => {
    try {
      await api().req("PATCH", "/keys/{key}", { path: { key: props.k.uid }, body: { name: name() || null, description: description() || null } });
      notify("success", "Key updated");
      props.onDone();
      props.onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal
      title="Edit API key"
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p class="muted small">Only name and description can be changed. Actions, indexes and expiry are immutable.</p>
      <label class="field">
        <span>Name</span>
        <input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Description</span>
        <input value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>
    </Modal>
  );
}

function TenantTokenDialog(props: { k: ApiKey; onClose: () => void }) {
  const [rules, setRules] = createSignal(pretty({ "*": { filter: null } }));
  const [expires, setExpires] = createSignal("");
  const [token, setToken] = createSignal("");
  const generate = async () => {
    try {
      const searchRules = JSON.parse(rules());
      setToken(await signTenantToken(props.k.key, props.k.uid, searchRules, expires() ? new Date(expires()) : undefined));
    } catch (e) {
      notifyError(e, "Tenant token");
    }
  };
  return (
    <Modal title={`Tenant token — ${props.k.name ?? props.k.uid}`} onClose={props.onClose} wide>
      <p class="muted small">Signed locally with this key (HS256). The key never leaves this computer. Search rules restrict which indexes and documents the token can see.</p>
      <div class="field">
        <span>searchRules</span>
        <div class="editor-box short">
          <JsonEditor value={rules()} onChange={setRules} />
        </div>
      </div>
      <label class="field">
        <span>Expires (recommended)</span>
        <input type="datetime-local" value={expires()} onInput={(e) => setExpires(e.currentTarget.value)} />
      </label>
      <button class="primary" onClick={generate}>
        Generate token
      </button>
      <Show when={token()}>
        <textarea class="mono token-out" readOnly rows={5} value={token()} />
        <button onClick={() => copyText(token()).then(() => notify("info", "Token copied"))}>Copy token</button>
      </Show>
    </Modal>
  );
}
