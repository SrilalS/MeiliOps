import { ErrorBoundary, For, JSX, ParentProps, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { dismissToast, setView, toasts } from "../state/app";
import { MeiliError, errorMessage } from "../api/meili";
import { IconX } from "./icons";

export function Modal(props: ParentProps<{ title: string; onClose: () => void; actions?: JSX.Element; wide?: boolean }>) {
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));
  return (
    <Portal>
      <div class="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="modal" classList={{ wide: props.wide }} role="dialog" aria-label={props.title}>
          <div class="modal-head">
            <h3>{props.title}</h3>
            <button class="icon-btn" onClick={props.onClose} aria-label="Close">
              <IconX />
            </button>
          </div>
          <div class="modal-body">{props.children}</div>
          <Show when={props.actions}>
            <div class="modal-actions">{props.actions}</div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}

/** Destructive confirmation. Optionally requires typing a name to enable the button. */
export function Confirm(props: { title: string; message: JSX.Element; confirmText?: string; typeToConfirm?: string; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const ok = () => !props.typeToConfirm || typed() === props.typeToConfirm;
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button
            class="danger"
            disabled={!ok() || busy()}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
                props.onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {props.confirmText ?? "Delete"}
          </button>
        </>
      }
    >
      <div class="confirm-message">{props.message}</div>
      <Show when={props.typeToConfirm}>
        <label class="field">
          <span>
            Type <code>{props.typeToConfirm}</code> to confirm
          </span>
          <input value={typed()} onInput={(e) => setTyped(e.currentTarget.value)} autofocus />
        </label>
      </Show>
    </Modal>
  );
}

export function Toasts() {
  return (
    <div class="toasts">
      <For each={toasts}>
        {(t) => (
          <div class={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * Renders an API error. "feature_not_enabled" gets a shortcut to the Experimental
 * screen (runtime flags) or a hint about launch flags (routes gated at startup).
 */
export function ApiError(props: { error: unknown; onRetry?: () => void }) {
  const e = () => props.error as MeiliError | Error;
  const code = () => (e() instanceof MeiliError ? (e() as MeiliError).code : undefined);
  const launchFlag = () => /--experimental-[\w-]+/.exec(e()?.message ?? "")?.[0];
  return (
    <div class="api-error">
      <div class="err">{errorMessage(props.error)}</div>
      <div class="row">
        <Show when={code() === "feature_not_enabled" && !launchFlag()}>
          <button class="primary" onClick={() => setView({ kind: "experimental" })}>
            Open Experimental features
          </button>
        </Show>
        <Show when={launchFlag()}>
          <span class="muted small">
            This route is enabled at launch with <code>{launchFlag()}</code>. For local instances, set it in the instance's launch flags.
          </span>
        </Show>
        <Show when={(e() as MeiliError)?.link}>
          <a class="small" href={(e() as MeiliError).link} target="_blank" rel="noreferrer">
            Docs
          </a>
        </Show>
        <Show when={props.onRetry}>
          <button onClick={props.onRetry}>Retry</button>
        </Show>
      </div>
    </div>
  );
}

/** Keeps one broken screen from taking down the app shell. */
export function ViewBoundary(props: ParentProps) {
  return <ErrorBoundary fallback={(err, reset) => <div class="page"><ApiError error={err} onRetry={reset} /></div>}>{props.children}</ErrorBoundary>;
}

export function Spinner() {
  return <span class="spinner" aria-label="Loading" />;
}

export function Empty(props: ParentProps<{ title: string }>) {
  return (
    <div class="empty">
      <h3>{props.title}</h3>
      <div class="muted">{props.children}</div>
    </div>
  );
}

export function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="stat">
      <div class="stat-value">{props.value}</div>
      <div class="stat-label">{props.label}</div>
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div class="tabs" role="tablist">
      <For each={props.tabs}>
        {(t) => (
          <button role="tab" classList={{ active: props.value === t.id }} aria-selected={props.value === t.id} onClick={() => props.onChange(t.id)}>
            {t.label}
          </button>
        )}
      </For>
    </div>
  );
}

export function StatusPill(props: { status: string }) {
  return <span class={`pill status-${props.status}`}>{props.status}</span>;
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString();
}

/** "5 min ago" style; falls back to the full date after a week. */
export function formatAgo(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (isNaN(sec)) return s;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} d ago`;
  return d.toLocaleDateString();
}

export function formatNumber(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString();
}

export function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}
