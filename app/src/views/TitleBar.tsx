// Custom title bar (Zed / VS Code style). On Windows and Linux the native frame is off
// (`decorations: false`) and we draw the window controls; on macOS the native traffic lights
// overlay the left edge (`titleBarStyle: "Overlay"` in tauri.macos.conf.json).
//
// Empty areas carry `data-tauri-drag-region`: drag to move, double-click to maximize.

import { For, JSX, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { activeConnection, activeId, connect, connected, connections, disconnect, openConnectionForm, server, setView, view } from "../state/app";
import { runningCount } from "../state/instances";
import { ThemeMode, setThemeMode, themeMode } from "../state/theme";
import { isTauri } from "../lib/platform";
import {
  IconCheck,
  IconChevronDown,
  IconMaximize,
  IconMinimize,
  IconMonitor,
  IconMoon,
  IconPencil,
  IconPlus,
  IconRestore,
  IconServer,
  IconSun,
  IconUnplug,
  IconX,
} from "../components/icons";

const isMac = /Mac/.test(navigator.userAgent);

const VIEW_TITLES: Record<string, string> = {
  overview: "Overview",
  tasks: "Tasks",
  batches: "Batches",
  metrics: "Metrics",
  logs: "Logs",
  "multi-search": "Multi-search",
  "search-rules": "Search rules",
  chats: "Chats",
  keys: "API keys",
  webhooks: "Webhooks",
  export: "Export",
  experimental: "Experimental",
  console: "API console",
  instances: "Local instances",
  "connection-form": "Connection",
};

const THEMES: { id: ThemeMode; label: string; icon: typeof IconSun }[] = [
  { id: "system", label: "System", icon: IconMonitor },
  { id: "light", label: "Light", icon: IconSun },
  { id: "dark", label: "Dark", icon: IconMoon },
];

export default function TitleBar() {
  const crumb = () => {
    const v = view();
    // Server pages only have a location while connected (not during connecting / error).
    if (!connected() && v.kind !== "instances" && v.kind !== "connection-form") return undefined;
    if (v.kind === "index") return v.uid;
    return VIEW_TITLES[v.kind];
  };

  return (
    <header class="titlebar" classList={{ mac: isMac }} data-tauri-drag-region>
      <img class="titlebar-logo" src="/icon.svg" alt="" data-tauri-drag-region />
      <span class="titlebar-app" data-tauri-drag-region>
        MeiliOps
      </span>
      <ConnectionPicker />
      <Show when={crumb()}>
        <span class="titlebar-sep" data-tauri-drag-region>
          /
        </span>
        <span class="titlebar-crumb ellipsis" data-tauri-drag-region>
          {crumb()}
        </span>
      </Show>
      <span class="grow" data-tauri-drag-region />
      <ThemePicker />
      <Show when={isTauri && !isMac}>
        <WindowControls />
      </Show>
    </header>
  );
}

/** A title-bar button that opens a popover; closes on outside click and Escape. */
function Popover(props: { button: (open: boolean) => JSX.Element; title: string; class?: string; align?: "left" | "right"; children: (close: () => void) => JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  const onDoc = (e: MouseEvent) => open() && !root.contains(e.target as Node) && setOpen(false);
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
  onMount(() => {
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("keydown", onKey);
  });
  return (
    <div class="popover-root" ref={root}>
      <button class={`titlebar-btn ${props.class ?? ""}`} classList={{ open: open() }} title={props.title} onClick={() => setOpen(!open())}>
        {props.button(open())}
      </button>
      <Show when={open()}>
        <div class="popover" classList={{ right: props.align === "right" }}>
          {props.children(() => setOpen(false))}
        </div>
      </Show>
    </div>
  );
}

function ConnectionPicker() {
  const label = () => (server().status === "idle" ? "No connection" : (activeConnection()?.name ?? "No connection"));
  return (
    <Popover
      title="Switch connection"
      class="conn-picker"
      button={() => (
        <>
          <span class="dot" style={{ background: activeConnection()?.color ?? "var(--fg-3)" }} />
          <span class="ellipsis">{label()}</span>
          <Show when={server().status === "connecting"}>
            <span class="spinner tiny" />
          </Show>
          <Show when={server().status === "error"}>
            <span class="pill status-failed">offline</span>
          </Show>
          <Show when={server().status === "lost"}>
            <span class="pill status-enqueued">reconnecting</span>
          </Show>
          <IconChevronDown class="chev" />
        </>
      )}
    >
      {(close) => (
        <>
          <div class="popover-title">Connections</div>
          <For each={connections} fallback={<div class="popover-empty">No saved connections</div>}>
            {(c) => (
              <div
                class="popover-item"
                onClick={() => {
                  close();
                  // Already connected to it: nothing to do (don't reset the page).
                  if (activeId() === c.id && server().status === "ready") return;
                  connect(c.id);
                }}
              >
                <span class="dot" style={{ background: c.color }} />
                <span class="grow ellipsis">
                  {c.name}
                  <span class="popover-sub">{c.url}</span>
                </span>
                <Show when={activeId() === c.id}>
                  <IconCheck class="popover-check" />
                </Show>
                <button
                  class="icon-btn"
                  title="Edit connection"
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    openConnectionForm(c.id);
                  }}
                >
                  <IconPencil />
                </button>
              </div>
            )}
          </For>
          <div class="popover-divider" />
          <div
            class="popover-item"
            onClick={() => {
              close();
              openConnectionForm();
            }}
          >
            <IconPlus class="popover-icon" />
            <span class="grow">New connection…</span>
          </div>
          <div
            class="popover-item"
            onClick={() => {
              close();
              setView({ kind: "instances" });
            }}
          >
            <IconServer class="popover-icon" />
            <span class="grow">Local instances</span>
            <Show when={runningCount() > 0}>
              <span class="pill status-succeeded">{runningCount()} running</span>
            </Show>
          </div>
          <Show when={activeId()}>
            <div
              class="popover-item"
              onClick={() => {
                close();
                disconnect();
              }}
            >
              <IconUnplug class="popover-icon" />
              <span class="grow">Disconnect</span>
            </div>
          </Show>
        </>
      )}
    </Popover>
  );
}

function ThemePicker() {
  const current = () => THEMES.find((t) => t.id === themeMode()) ?? THEMES[0];
  return (
    <Popover title={`Theme: ${current().label}`} class="square" align="right" button={() => <Dynamic component={current().icon} />}>
      {(close) => (
        <>
          <div class="popover-title">Theme</div>
          <For each={THEMES}>
            {(t) => (
              <div
                class="popover-item"
                onClick={() => {
                  setThemeMode(t.id);
                  close();
                }}
              >
                <Dynamic component={t.icon} class="popover-icon" />
                <span class="grow">{t.label}</span>
                <Show when={themeMode() === t.id}>
                  <IconCheck class="popover-check" />
                </Show>
              </div>
            )}
          </For>
        </>
      )}
    </Popover>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = createSignal(false);
  let win: import("@tauri-apps/api/window").Window | undefined;
  let unlisten: (() => void) | undefined;
  onCleanup(() => unlisten?.());
  onMount(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    win = getCurrentWindow();
    setMaximized(await win.isMaximized());
    unlisten = await win.onResized(async () => setMaximized(await win!.isMaximized()));
  });
  return (
    <div class="window-controls">
      <button class="wc" title="Minimize" onClick={() => win?.minimize()}>
        <IconMinimize />
      </button>
      <button class="wc" title={maximized() ? "Restore" : "Maximize"} onClick={() => win?.toggleMaximize()}>
        <Show when={maximized()} fallback={<IconMaximize class="wc-max" />}>
          <IconRestore class="wc-max" />
        </Show>
      </button>
      <button class="wc close" title="Close" onClick={() => win?.close()}>
        <IconX />
      </button>
    </div>
  );
}
