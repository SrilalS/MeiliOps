import { For, Show, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { Modal } from "../../components/ui";
import { MANAGED_FLAGS } from "../../lib/meiliHelp";
import { secrets } from "../../lib/platform";
import { Instance, findFreePort, flagDefs, generateMasterKey, instances, portInUse, saveInstance } from "../../state/instances";
import { notify } from "../../state/app";

export default function InstanceDialog(props: { initial: Instance; isNew: boolean; onClose: () => void }) {
  const [inst, setInst] = createSignal<Instance>(props.initial);
  const [key, setKey] = createSignal(props.isNew ? generateMasterKey() : "");
  const [showKey, setShowKey] = createSignal(false);
  const [flagFilter, setFlagFilter] = createSignal("");
  const [onlySet, setOnlySet] = createSignal(false);
  const [envText, setEnvText] = createSignal(
    Object.entries(props.initial.envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );

  const [portBusy, setPortBusy] = createSignal(false);
  onMount(async () => {
    if (!props.isNew && props.initial.hasKey) setKey((await secrets.get(`instance:${props.initial.id}`)) ?? "");
    if (props.isNew) patch({ port: await findFreePort(props.initial.port) });
  });
  createEffect(
    on(
      () => inst().port,
      async (port) => setPortBusy(await portInUse(port)),
    ),
  );

  const patch = (p: Partial<Instance>) => setInst({ ...inst(), ...p });
  const setFlag = (name: string, value: string | boolean | undefined) => {
    const flags = { ...inst().flags };
    if (value === undefined || value === false) delete flags[name];
    else flags[name] = value;
    patch({ flags });
  };

  const defs = createMemo(() => {
    const q = flagFilter().toLowerCase();
    return flagDefs()
      .filter((f) => !MANAGED_FLAGS.has(f.name))
      .filter((f) => !onlySet() || f.name in inst().flags)
      .filter((f) => !q || f.name.includes(q) || f.description.toLowerCase().includes(q));
  });

  const portClash = () => instances.some((i) => i.id !== inst().id && i.port === inst().port);

  const save = async () => {
    if (inst().env === "production" && key().length < 16) return notify("error", "Production mode requires a master key of at least 16 bytes.");
    const envVars: Record<string, string> = {};
    for (const line of envText().split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=(.*)$/);
      if (m) envVars[m[1]] = m[2];
    }
    await saveInstance({ ...inst(), envVars }, key());
    props.onClose();
  };

  return (
    <Modal
      title={props.isNew ? "New local instance" : `Edit ${props.initial.name}`}
      onClose={props.onClose}
      wide
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button class="primary" disabled={!inst().name.trim() || portClash()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div class="row wrap">
        <label class="field grow">
          <span>Name</span>
          <input value={inst().name} onInput={(e) => patch({ name: e.currentTarget.value })} />
        </label>
        <label class="field">
          <span>Port</span>
          <input type="number" class="num-input" style={{ width: "100px" }} value={inst().port} onInput={(e) => patch({ port: +e.currentTarget.value })} />
          <Show when={portClash()}>
            <small class="err">Port used by another instance</small>
          </Show>
          <Show when={!portClash() && portBusy()}>
            <small class="warn">Something is already listening on this port</small>
          </Show>
        </label>
        <label class="field">
          <span>Environment</span>
          <select value={inst().env} onChange={(e) => patch({ env: e.currentTarget.value as Instance["env"] })}>
            <option value="development">development</option>
            <option value="production">production</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>Master key (stored in the OS keychain, passed via MEILI_MASTER_KEY)</span>
        <div class="row">
          <input class="grow mono" type={showKey() ? "text" : "password"} value={key()} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
          <button onClick={() => setShowKey(!showKey())}>{showKey() ? "Hide" : "Show"}</button>
          <button onClick={() => setKey(generateMasterKey())}>Generate</button>
        </div>
      </label>

      <div class="field">
        <span>Launch flags ({flagDefs().length} from `meilisearch --help`)</span>
        <div class="row">
          <input class="grow" placeholder="Search flags…" value={flagFilter()} onInput={(e) => setFlagFilter(e.currentTarget.value)} />
          <label class="inline-label">
            <input type="checkbox" checked={onlySet()} onChange={(e) => setOnlySet(e.currentTarget.checked)} /> only set
          </label>
        </div>
        <div class="flag-editor">
          <For each={defs()}>
            {(f) => {
              const on = () => f.name in inst().flags;
              return (
                <div class="flag-row" classList={{ on: on() }}>
                  <label class="flag-name">
                    <input type="checkbox" checked={on()} onChange={(e) => setFlag(f.name, e.currentTarget.checked ? (f.value ? (f.default ?? "") : true) : undefined)} />
                    <code>--{f.name}</code>
                    <Show when={f.experimental}>
                      <span class="pill exp">exp</span>
                    </Show>
                  </label>
                  <Show when={f.value && on()}>
                    <Show
                      when={f.possible}
                      fallback={<input class="mono flag-value" value={String(inst().flags[f.name] ?? "")} placeholder={f.default ?? f.value} onInput={(e) => setFlag(f.name, e.currentTarget.value)} />}
                    >
                      <select class="flag-value" value={String(inst().flags[f.name] ?? "")} onChange={(e) => setFlag(f.name, e.currentTarget.value)}>
                        <For each={f.possible}>{(v) => <option value={v}>{v}</option>}</For>
                      </select>
                    </Show>
                  </Show>
                  <div class="muted small flag-desc">
                    {f.description}
                    <Show when={f.default}> Default: {f.default}.</Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <label class="field">
        <span>Extra environment variables (KEY=value per line)</span>
        <textarea class="mono" rows={3} value={envText()} onInput={(e) => setEnvText(e.currentTarget.value)} placeholder="MEILI_EXPERIMENTAL_REST_EMBEDDER_TIMEOUT_SECONDS=30" />
      </label>
    </Modal>
  );
}
