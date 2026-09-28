import { For, Show, createResource } from "solid-js";
import { api, notify, notifyError } from "../state/app";
import { ApiError, Spinner } from "../components/ui";

export default function ExperimentalView() {
  const [features, { mutate }] = createResource(() => api().req<Record<string, unknown>>("GET", "/experimental-features"));

  const toggle = async (name: string, value: boolean) => {
    try {
      const updated = await api().req<Record<string, unknown>>("PATCH", "/experimental-features", { body: { [name]: value } });
      mutate(updated);
      notify("success", `${name} ${value ? "enabled" : "disabled"}`);
    } catch (e) {
      notifyError(e, name);
    }
  };

  return (
    <div class="page narrow">
      <div class="page-head">
        <h2>Experimental features</h2>
      </div>
      <p class="muted small">Runtime feature flags. Experimental APIs can change or disappear between Meilisearch releases. Some flags can only be set at launch (CLI / env).</p>
      <Show when={!features.error} fallback={<ApiError error={features.error} />}>
        <Show when={features()} fallback={<Spinner />}>
          <div class="flag-list">
            <For each={Object.entries(features()!).sort(([a], [b]) => a.localeCompare(b))}>
              {([name, value]) => (
                <label class="flag">
                  <Show when={typeof value === "boolean"} fallback={<code class="small">{JSON.stringify(value)}</code>}>
                    <input type="checkbox" checked={value as boolean} onChange={(e) => toggle(name, e.currentTarget.checked)} />
                  </Show>
                  <code>{name}</code>
                </label>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
