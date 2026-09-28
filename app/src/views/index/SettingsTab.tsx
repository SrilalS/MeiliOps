import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { ApiPath } from "../../api/meili";
import { api, notify, trackTask } from "../../state/app";
import JsonEditor from "../../components/JsonEditor";
import { ApiError, Confirm, Spinner, pretty } from "../../components/ui";
import { SETTINGS, SettingDef } from "./settingsCatalog";
import RenderTemplateDialog from "./RenderTemplateDialog";

const ALL: SettingDef = { key: "*", slug: "", method: "PATCH", group: "", label: "All settings (JSON)", help: "The full settings object. Only changed keys are sent (PATCH)." };

export default function SettingsTab(props: { uid: string }) {
  const [current, setCurrent] = createSignal<SettingDef>(SETTINGS[0]);
  const [confirm, setConfirm] = createSignal<"reset" | "reset-all">();
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [templateTest, setTemplateTest] = createSignal(false);

  const path = (s: SettingDef) => (s.key === "*" ? "/indexes/{index_uid}/settings" : `/indexes/{index_uid}/settings/${s.slug}`) as ApiPath;

  // Each setting is fetched through its own sub-route so every GET is exercised.
  const [server, { refetch }] = createResource(current, async (s) => {
    const v = await api().req("GET", path(s), { path: { index_uid: props.uid } });
    setText(pretty(v));
    return pretty(v);
  });

  const dirty = createMemo(() => server() !== undefined && normalize(text()) !== normalize(server()!));
  const groups = createMemo(() => {
    const m = new Map<string, SettingDef[]>();
    for (const s of SETTINGS) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  });

  const apply = async () => {
    const s = current();
    let value: unknown;
    try {
      value = JSON.parse(text());
    } catch (e) {
      return notify("error", `Invalid JSON: ${(e as Error).message}`);
    }
    if (s.key === "*") value = diffObject(JSON.parse(server()!), value as Record<string, unknown>);
    setBusy(true);
    try {
      const t = await trackTask(api().req(s.method, path(s), { path: { index_uid: props.uid }, body: value }), `Update ${s.label} on ${props.uid}`);
      if (t?.status === "succeeded") refetch();
    } finally {
      setBusy(false);
    }
  };

  const reset = async (s: SettingDef) => {
    const t = await trackTask(api().req("DELETE", path(s), { path: { index_uid: props.uid } }), `Reset ${s.label} on ${props.uid}`);
    if (t?.status === "succeeded") refetch();
  };

  const select = (s: SettingDef) => {
    if (dirty() && !window.confirm("Discard unsaved changes?")) return;
    setCurrent(s);
  };

  return (
    <div class="settings-tab">
      <nav class="settings-nav">
        <div class="settings-item" classList={{ active: current().key === "*" }} onClick={() => select(ALL)}>
          All settings (JSON)
        </div>
        <For each={groups()}>
          {([group, items]) => (
            <>
              <div class="settings-group">{group}</div>
              <For each={items}>
                {(s) => (
                  <div class="settings-item" classList={{ active: current().key === s.key }} onClick={() => select(s)}>
                    {s.label}
                    <Show when={s.experimental}>
                      <span class="pill exp">exp</span>
                    </Show>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </nav>
      <section class="settings-body">
        <div class="settings-head">
          <div>
            <h3>{current().label}</h3>
            <div class="muted small">
              {current().help} <code>{current().method} {path(current())}</code>
            </div>
            <Show when={current().reindex}>
              <div class="warn small">⚠ Changing this triggers a re-index of all documents in {props.uid}.</div>
            </Show>
          </div>
        </div>
        <Show when={!server.loading || server()} fallback={<Spinner />}>
          <Show when={!server.error} fallback={<ApiError error={server.error} />}>
            <div class="editor-box fill">
              <JsonEditor value={text()} onChange={setText} original={server()} onSubmit={apply} />
            </div>
          </Show>
        </Show>
        <div class="row">
          <button class="primary" disabled={!dirty() || busy()} onClick={apply} title="Ctrl+Enter">
            {busy() ? "Applying…" : "Apply changes"}
          </button>
          <button disabled={!dirty()} onClick={() => setText(server() ?? "")}>
            Discard
          </button>
          <span class="grow" />
          <Show when={dirty()}>
            <span class="warn small">Unsaved changes (highlighted)</span>
          </Show>
          <Show when={current().key === "embedders" || current().key === "chat"}>
            <button onClick={() => setTemplateTest(true)}>Test template…</button>
          </Show>
          <button class="danger" onClick={() => setConfirm(current().key === "*" ? "reset-all" : "reset")}>
            {current().key === "*" ? "Reset ALL settings" : "Reset to default"}
          </button>
        </div>
      </section>
      <Show when={templateTest()}>
        <RenderTemplateDialog
          uid={props.uid}
          kind={current().key === "chat" ? "chatDocumentTemplate" : "documentTemplate"}
          embedder={current().key === "embedders" ? firstKey(server()) : undefined}
          onClose={() => setTemplateTest(false)}
        />
      </Show>
      <Show when={confirm() === "reset"}>
        <Confirm
          title={`Reset ${current().label}`}
          message={<>Reset {current().label} on {props.uid} to its default value?</>}
          confirmText="Reset"
          onClose={() => setConfirm(undefined)}
          onConfirm={() => reset(current())}
        />
      </Show>
      <Show when={confirm() === "reset-all"}>
        <Confirm
          title="Reset all settings"
          message={<>Reset every setting on {props.uid} to defaults. This re-indexes all documents.</>}
          typeToConfirm={props.uid}
          confirmText="Reset all"
          onClose={() => setConfirm(undefined)}
          onConfirm={() => reset(ALL)}
        />
      </Show>
    </div>
  );
}

function firstKey(json: string | undefined): string | undefined {
  try {
    return Object.keys(JSON.parse(json ?? "{}"))[0];
  } catch {
    return undefined;
  }
}

function normalize(s: string) {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return s;
  }
}

/** Only send top-level keys that changed. */
function diffObject(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) if (JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = v;
  return out;
}
