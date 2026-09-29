// Theme: "system" follows the OS; "light" / "dark" pin it. The resolved theme is written to
// <html data-theme>, which styles.css keys all color tokens on.
//
// The choice is persisted with the other settings, and mirrored to localStorage so index.html
// can apply it before first paint (no flash of the wrong theme on startup).

import { createEffect, createRoot, createSignal } from "solid-js";
import { loadSetting, saveSetting } from "../lib/platform";

export type ThemeMode = "system" | "light" | "dark";

const CACHE_KEY = "meiliops:theme";

function cached(): ThemeMode {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
const [systemDark, setSystemDark] = createSignal(media.matches);
media.addEventListener("change", (e) => setSystemDark(e.matches));

const [mode, setModeSignal] = createSignal<ThemeMode>(cached());
export const themeMode = mode;
export const resolvedTheme = () => (mode() === "system" ? (systemDark() ? "dark" : "light") : mode());

createRoot(() => createEffect(() => (document.documentElement.dataset.theme = resolvedTheme())));

export function setThemeMode(m: ThemeMode) {
  setModeSignal(m);
  try {
    localStorage.setItem(CACHE_KEY, m);
  } catch {}
  saveSetting("theme", m);
}

export async function loadTheme() {
  const m = await loadSetting<ThemeMode>("theme", mode());
  if (m !== mode()) setThemeMode(m);
}
