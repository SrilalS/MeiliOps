// App self-update through tauri-plugin-updater. Releases publish a signed latest.json
// (tauri-action), the plugin verifies every download against the public key in
// tauri.conf.json, and installs it for the way the app was installed (NSIS, .app, AppImage,
// .deb or .rpm). See docs/development/releasing.md for the signing key.

import { createRoot, createSignal } from "solid-js";
import { isTauri, loadSetting, saveSetting } from "../lib/platform";
import { notify, notifyError } from "./app";
import { runningCount, stopAllInstances } from "./instances";

type Update = import("@tauri-apps/plugin-updater").Update;

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";

const DAY = 24 * 60 * 60 * 1000;

const s = createRoot(() => {
  const [status, setStatus] = createSignal<UpdateStatus>("idle");
  const [update, setUpdate] = createSignal<Update>();
  const [progress, setProgress] = createSignal<{ done: number; total?: number }>();
  const [autoCheck, setAutoCheck] = createSignal(true);
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [appVersion, setAppVersion] = createSignal("");
  return { status, setStatus, update, setUpdate, progress, setProgress, autoCheck, setAutoCheck, dialogOpen, setDialogOpen, appVersion, setAppVersion };
});

export const { status: updateStatus, update: availableUpdate, progress: updateProgress, autoCheck, dialogOpen: updateDialogOpen, appVersion } = s;
export const openUpdateDialog = () => s.setDialogOpen(true);
export const closeUpdateDialog = () => s.setDialogOpen(false);

/** Load the setting, then check quietly a few seconds after launch (at most once a day). */
export async function initUpdater() {
  if (!isTauri) return;
  const { getVersion } = await import("@tauri-apps/api/app");
  s.setAppVersion(await getVersion());
  s.setAutoCheck(await loadSetting("updates.autoCheck", true));
  if (!s.autoCheck()) return;
  const last = await loadSetting<number>("updates.lastCheck", 0);
  if (Date.now() - last < DAY) return;
  setTimeout(() => checkForUpdates({ quiet: true }), 5000);
}

export async function setAutoCheck(on: boolean) {
  s.setAutoCheck(on);
  await saveSetting("updates.autoCheck", on);
}

/**
 * Ask the release feed for a newer version. `quiet` (the automatic check) stays silent
 * unless there is one; a manual check always reports the result.
 */
export async function checkForUpdates(opts: { quiet?: boolean } = {}) {
  if (!isTauri || s.status() === "checking" || s.status() === "downloading" || s.status() === "installing") return;
  s.setStatus("checking");
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const found = await check({ timeout: 15000 });
    await saveSetting("updates.lastCheck", Date.now());
    await s.update()?.close();
    s.setUpdate(found ?? undefined);
    s.setStatus(found ? "available" : "none");
    if (found && opts.quiet) notify("info", `MeiliOps ${found.version} is available. Click Update in the title bar.`, 8000);
    if (!found && !opts.quiet) notify("success", `MeiliOps ${s.appVersion()} is the latest version.`);
  } catch (e) {
    s.setStatus("error");
    if (!opts.quiet) notifyError(e, "Checking for updates");
  }
}

/** Download, verify, install, relaunch. Local instances are stopped first. */
export async function installUpdate() {
  const u = s.update();
  if (!u) return;
  if (import.meta.env.DEV) return notify("error", "Updates install only in a built app, not in `tauri dev`.");
  try {
    // On Windows the installer closes the app without the close-requested event,
    // which would leave Meilisearch processes holding their ports and data.
    if (runningCount() > 0) await stopAllInstances();
    s.setStatus("downloading");
    s.setProgress({ done: 0 });
    await u.downloadAndInstall((ev) => {
      if (ev.event === "Started") s.setProgress({ done: 0, total: ev.data.contentLength });
      else if (ev.event === "Progress") s.setProgress((p) => ({ ...p, done: (p?.done ?? 0) + ev.data.chunkLength }));
      else s.setStatus("installing");
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    s.setStatus("available");
    s.setProgress(undefined);
    notifyError(e, "Installing the update");
  }
}
