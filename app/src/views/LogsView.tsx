import { For, Show, createSignal, onCleanup } from "solid-js";
import { api, notify, notifyError } from "../state/app";
import { errorMessage } from "../api/meili";
import { downloadText, isTauri } from "../lib/platform";

const MAX_LINES = 5000;

export default function LogsView() {
  // "info" is nearly silent for normal traffic; "debug" shows every HTTP request and task step.
  const [target, setTarget] = createSignal("debug");
  const [mode, setMode] = createSignal<"human" | "json" | "profile">("human");
  const [lines, setLines] = createSignal<string[]>([]);
  const [running, setRunning] = createSignal(false);
  const [follow, setFollow] = createSignal(true);
  const [filter, setFilter] = createSignal("");
  const [stderrTarget, setStderrTarget] = createSignal("info");
  const [err, setErr] = createSignal<string>();
  let ctrl: AbortController | undefined;
  let box!: HTMLDivElement;

  const start = async () => {
    stop(false);
    ctrl = new AbortController();
    setErr(undefined);
    setRunning(true);
    try {
      // Meilisearch Brotli-compresses this stream when the client accepts it, and the
      // compressor holds small log chunks back indefinitely. Browsers can't opt out of
      // compression, so in the desktop app we use Tauri's native HTTP client with
      // Accept-Encoding: identity. (A plain browser gets nothing until the buffer fills.)
      const nativeFetch = isTauri ? (await import("@tauri-apps/plugin-http")).fetch : undefined;
      const res = await api().req<Response>("POST", "/logs/stream", {
        body: { target: target(), mode: mode() },
        raw: true,
        signal: ctrl.signal,
        fetch: nativeFetch as typeof fetch | undefined,
        headers: nativeFetch ? { "Accept-Encoding": "identity" } : undefined,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parts = (rest + dec.decode(value, { stream: true })).split("\n");
        rest = parts.pop() ?? "";
        if (parts.length) {
          setLines((l) => {
            const next = l.concat(parts.map(stripAnsi));
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
          if (follow()) queueMicrotask(() => (box.scrollTop = box.scrollHeight));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  /** Only one log stream can be open per server, so always release it. */
  const stop = async (release = true) => {
    ctrl?.abort();
    ctrl = undefined;
    if (release) await api().req("DELETE", "/logs/stream").catch(() => undefined);
  };
  onCleanup(() => stop());

  const setStderr = async () => {
    try {
      await api().req("POST", "/logs/stderr", { body: { target: stderrTarget() } });
      notify("success", `Console log level set to "${stderrTarget()}"`);
    } catch (e) {
      notifyError(e, "stderr log level");
    }
  };

  const visible = () => {
    const f = filter().toLowerCase();
    return f ? lines().filter((l) => l.toLowerCase().includes(f)) : lines();
  };

  return (
    <div class="page">
      <div class="page-head">
        <h2>Logs</h2>
        <span class="muted small">Requires launching Meilisearch with --experimental-enable-logs-route.</span>
        <Show when={!isTauri}>
          <span class="warn small">In a plain browser the stream is held back by server-side compression. Use the desktop app.</span>
        </Show>
      </div>
      <div class="toolbar">
        <input class="mono grow" list="log-targets" value={target()} onInput={(e) => setTarget(e.currentTarget.value)} placeholder="target, e.g. info or milli=trace,actix_web=off" title="Log target filter" />
        <datalist id="log-targets">
          <option value="debug">every request and task step</option>
          <option value="info">quiet: startup, errors, warnings</option>
          <option value="index_scheduler=debug,milli=info">indexing pipeline</option>
          <option value="meilisearch::search=debug">search queries</option>
          <option value="trace">everything (very noisy)</option>
        </datalist>
        <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as "human" | "json" | "profile")}>
          <option value="human">human</option>
          <option value="json">json</option>
          <option value="profile">profile (Firefox profiler)</option>
        </select>
        <Show when={!running()} fallback={<button onClick={() => stop()}>■ Stop</button>}>
          <button class="primary" onClick={start}>
            ▶ Stream
          </button>
        </Show>
        <button onClick={() => setLines([])}>Clear</button>
        <button disabled={!lines().length} onClick={() => downloadText(`meilisearch-${mode() === "profile" ? "profile.json" : "logs.txt"}`, lines().join("\n"), "text/plain")}>
          Save
        </button>
        <label class="inline-label">
          <input type="checkbox" checked={follow()} onChange={(e) => setFollow(e.currentTarget.checked)} /> follow
        </label>
      </div>
      <div class="toolbar">
        <input placeholder="Filter lines…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        <span class="grow" />
        <span class="muted small">Server console (stderr) level</span>
        <input class="mono" value={stderrTarget()} onInput={(e) => setStderrTarget(e.currentTarget.value)} />
        <button onClick={setStderr}>Apply</button>
      </div>
      <Show when={err()}>
        <div class="err">{err()}</div>
      </Show>
      <div class="log-box" ref={box}>
        <For each={visible()}>{(l) => <div class={`log-line ${levelClass(l)}`}>{l}</div>}</For>
        <Show when={!lines().length}>
          <div class="muted pad">{running() ? "Waiting for log lines…" : "Press Stream to start."}</div>
        </Show>
      </div>
      <div class="muted small">
        {lines().length.toLocaleString()} lines (last {MAX_LINES.toLocaleString()} kept)
      </div>
    </div>
  );
}

function stripAnsi(s: string) {
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function levelClass(l: string) {
  if (/\bERROR\b|"level":"ERROR"/.test(l)) return "err";
  if (/\bWARN\b|"level":"WARN"/.test(l)) return "warn";
  if (/\b(DEBUG|TRACE)\b/.test(l)) return "muted";
  return "";
}
