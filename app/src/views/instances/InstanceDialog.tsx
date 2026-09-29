import { For, Show, createEffect, createMemo, createResource, createSignal, on, onMount } from "solid-js";
import { Modal } from "../../components/ui";
import { MANAGED_FLAGS } from "../../lib/meiliHelp";
import { secrets } from "../../lib/platform";
import {
  ENGINES,
  Engine,
  Instance,
  Release,
  engineLabel,
  engineOf,
  engineReady,
  engines,
  findFreePort,
  flagDefsFor,
  generateMasterKey,
  installedVersions,
  instances,
  portInUse,
  saveInstance,
  upgradePlan,
} from "../../state/instances";
import { notify } from "../../state/app";

export default function InstanceDialog(props: { initial: Instance; isNew: boolean; releases: Release[]; onClose: () => void }) {
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

  const engine = () => engineOf(inst());
  /**
   * Native: installed binaries. Containers: any release (pulled on first start), pulled ones first.
   * Plain strings so <For> keeps the <option>s (new objects would re-create them and reset the select).
   */
  const versionChoices = createMemo(() => {
    const e = engine();
    if (e === "native") return installedVersions();
    const pulled = engines[e]?.images ?? [];
    return [...pulled, ...props.releases.map((r) => r.version).filter((v) => !pulled.includes(v))];
  });
  const versionNote = (v: string) => {
    const e = engine();
    if (e !== "native" && engines[e]?.images.includes(v)) return " · pulled";
    return props.releases.find((r) => r.version === v)?.prerelease ? " (pre-release)" : "";
  };
  const setEngine = (e: Engine) => {
    const keep = e === "native" ? installedVersions().includes(inst().version ?? "") : true;
    patch({ engine: e, version: keep ? inst().version : installedVersions()[0] });
  };
  const plan = () => upgradePlan(inst());
  const movedData = () => !props.isNew && engineOf(props.initial) !== engine();

  const [flagDefs] = createResource(
    () => [engine(), inst().version] as const,
    ([e, v]) => flagDefsFor(e, v).catch(() => undefined),
  );
  /** Flags set earlier that this version doesn't know: Meilisearch refuses to start with them. */
  const unknownFlags = () => (flagDefs() ? Object.keys(inst().flags).filter((f) => !flagDefs()!.some((d) => d.name === f)) : []);
  const defs = createMemo(() => {
    const q = flagFilter().toLowerCase();
    return (flagDefs() ?? [])
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
          <button class="primary" disabled={!inst().name.trim() || !inst().version || portClash()} onClick={save}>
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
      <div class="row wrap">
        <label class="field">
          <span>Runs on</span>
          <select value={engine()} onChange={(e) => setEngine(e.currentTarget.value as Engine)}>
            <For each={ENGINES}>
              {(e) => (
                <option value={e} disabled={e !== "native" && !engines[e]}>
                  {engineLabel(e)}
                  {e === "native" ? "" : !engines[e] ? " (not found)" : !engineReady(e) ? " (not running)" : ""}
                </option>
              )}
            </For>
          </select>
        </label>
        <label class="field grow">
          <span>Meilisearch version</span>
          <select value={inst().version ?? ""} onChange={(e) => patch({ version: e.currentTarget.value || undefined })}>
            <Show when={!inst().version || !versionChoices().includes(inst().version!)}>
              <option value={inst().version ?? ""}>{inst().version ? `v${inst().version} (not available)` : "Pick a version…"}</option>
            </Show>
            <For each={versionChoices()}>
              {(v) => (
                <option value={v}>
                  v{v}
                  {versionNote(v)}
                </option>
              )}
            </For>
          </select>
          <Show when={engine() === "native" && !installedVersions().length}>
            <small class="warn">No native version installed. Install one on the Local instances page.</small>
          </Show>
        </label>
      </div>
      <Show when={movedData()}>
        <div class="warn small">Data doesn't move between engines. On {engineLabel(engine())} this instance uses its own storage, which starts empty the first time; the {engineLabel(props.initial.engine)} data is kept.</div>
      </Show>
      <Show when={plan().upgrade}>
        <div class="muted small">The data was last opened by v{inst().dataVersion?.[engine()]}; it's upgraded in place (--upgrade-db) on the next start. Take a dump or snapshot first if you may want to go back.</div>
      </Show>
      <Show when={plan().error}>
        <div class="err small">{plan().error}</div>
      </Show>

      <label class="field">
        <span>Master key (stored in the OS keychain, passed via MEILI_MASTER_KEY)</span>
        <div class="row">
          <input class="grow mono" type={showKey() ? "text" : "password"} value={key()} onInput={(e) => setKey(e.currentTarget.value)} autocomplete="off" />
          <button onClick={() => setShowKey(!showKey())}>{showKey() ? "Hide" : "Show"}</button>
          <button onClick={() => setKey(generateMasterKey())}>Generate</button>
        </div>
      </label>

      <div class="field">
        <span>
          <Show when={flagDefs()} fallback={flagDefs.loading ? "Launch flags (loading…)" : `Launch flags: available once v${inst().version ?? "?"} is installed or pulled`}>
            Launch flags ({flagDefs()!.length} from `meilisearch --help` of v{inst().version})
          </Show>
        </span>
        <div class="row">
          <input class="grow" placeholder="Search flags…" value={flagFilter()} onInput={(e) => setFlagFilter(e.currentTarget.value)} />
          <label class="inline-label">
            <input type="checkbox" checked={onlySet()} onChange={(e) => setOnlySet(e.currentTarget.checked)} /> only set
          </label>
        </div>
        <Show when={unknownFlags().length}>
          <div class="err small">
            v{inst().version} doesn't have {unknownFlags().map((f) => `--${f}`).join(", ")}.{" "}
            <button class="link" onClick={() => unknownFlags().forEach((f) => setFlag(f, undefined))}>
              Remove {unknownFlags().length > 1 ? "them" : "it"}
            </button>
          </div>
        </Show>
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
