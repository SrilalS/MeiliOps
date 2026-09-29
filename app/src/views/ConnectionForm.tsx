import { Show, createSignal, onMount } from "solid-js";
import { Meili, errorMessage } from "../api/meili";
import { activeId, closeConnectionForm, connect, connections, deleteConnection, getConnectionKey, newConnectionColor, notify, saveConnection } from "../state/app";
import { Confirm, Spinner } from "../components/ui";

export default function ConnectionForm(props: { id?: string }) {
  const existing = () => connections.find((c) => c.id === props.id);
  const [name, setName] = createSignal(existing()?.name ?? "Local");
  const [url, setUrl] = createSignal(existing()?.url ?? "http://127.0.0.1:7700");
  const [color, setColor] = createSignal(existing()?.color ?? newConnectionColor());
  const [key, setKey] = createSignal("");
  const [keyDirty, setKeyDirty] = createSignal(false);
  const [showKey, setShowKey] = createSignal(false);
  const [test, setTest] = createSignal<{ busy?: boolean; ok?: boolean; text?: string }>({});
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  onMount(async () => {
    const e = existing();
    if (e?.hasKey) setKey((await getConnectionKey(e.id)) ?? "");
  });

  const runTest = async () => {
    setTest({ busy: true });
    try {
      const m = new Meili(url(), key() || undefined);
      const health = await m.req("GET", "/health");
      const version = await m.req("GET", "/version");
      setTest({ ok: true, text: `${health.status} · Meilisearch ${version.pkgVersion}` });
    } catch (e) {
      setTest({ ok: false, text: errorMessage(e) });
    }
  };

  const save = async (andConnect: boolean) => {
    if (!name().trim() || !url().trim()) return notify("error", "Name and URL are required");
    const before = existing();
    const conn = await saveConnection({ id: props.id, name: name().trim(), url: url().trim(), color: color() }, props.id && !keyDirty() ? undefined : key());
    notify("success", "Connection saved");
    // Editing the live connection's URL or key: the open client still uses the old ones.
    const liveChanged = conn.id === activeId() && (before?.url !== conn.url || keyDirty());
    if (andConnect) return connect(conn.id);
    closeConnectionForm();
    if (liveChanged) await connect(conn.id);
  };

  return (
    <div class="page narrow">
      <div class="page-head">
        <h2>{props.id ? "Edit connection" : "New connection"}</h2>
      </div>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <label class="field">
          <span>Name</span>
          <input value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
        </label>
        <label class="field">
          <span>URL</span>
          <input value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="http://127.0.0.1:7700" />
        </label>
        <label class="field">
          <span>API key</span>
          <div class="row">
            <input
              class="grow mono"
              type={showKey() ? "text" : "password"}
              value={key()}
              onInput={(e) => {
                setKey(e.currentTarget.value);
                setKeyDirty(true);
              }}
              placeholder="Master key or admin API key (optional)"
              autocomplete="off"
            />
            <button type="button" onClick={() => setShowKey(!showKey())}>
              {showKey() ? "Hide" : "Show"}
            </button>
          </div>
          <small class="muted">Stored in the OS credential store, never in a config file.</small>
        </label>
        <label class="field">
          <span>Color</span>
          <input type="color" value={color()} onInput={(e) => setColor(e.currentTarget.value)} />
        </label>
        <div class="row">
          <button type="button" onClick={runTest} disabled={test().busy}>
            Test connection
          </button>
          <Show when={test().busy}>
            <Spinner />
          </Show>
          <Show when={test().text}>
            <span classList={{ ok: test().ok, err: !test().ok }}>{test().text}</span>
          </Show>
        </div>
        <div class="row form-actions">
          <Show when={props.id}>
            <button type="button" class="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          </Show>
          <span class="grow" />
          <button type="button" onClick={closeConnectionForm}>
            Cancel
          </button>
          <button type="button" onClick={() => save(false)}>
            Save
          </button>
          <button type="submit" class="primary">
            Save & connect
          </button>
        </div>
      </form>
      <Show when={confirmDelete()}>
        <Confirm
          title="Delete connection"
          message={<>Remove “{name()}” and its stored key from this computer? The server is not affected.</>}
          onConfirm={async () => {
            await deleteConnection(props.id!, { navigate: false });
            closeConnectionForm();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      </Show>
    </div>
  );
}
