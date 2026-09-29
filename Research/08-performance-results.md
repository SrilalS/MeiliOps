# 08 — Performance Results (measured)

> Windows 11 x64 · Tauri 2 + SolidJS · WebView2 153 · MeiliOps 0.2.0 release build
> Method: `app/scripts/measure-memory.ps1`, private bytes summed over the **whole process tree** (host + every `msedgewebview2.exe`).

## 📦 Size

| Artifact | Size |
|---|---|
| Installer (NSIS, per-user) | **2.99 MB** |
| App exe | 9.0 MB |
| Initial JS (CodeMirror lazy-loaded) | ~140 KB |

## 🧠 Memory

| Scenario | Private bytes |
|---|---|
| Tauri default WebView2 flags, idle (v0.1) | 192 MB |
| Tuned flags (process consolidation + in-process GPU), idle (v0.1) | 130 MB |
| v0.2 idle (more plugins: shell, http, upload, os) | **138 MB** |
| v0.2 in use: connected, 32k-doc grid scrolled end to end, JSON editor open | ~198 MB |
| v0.2 after leaving the grid (+20 s) | ~167 MB |

## 🔍 Where the memory goes (in use)

| Process | MB | Note |
|---|---|---|
| WebView2 browser (with in-process GPU) | ~75 | Flat between idle and in use |
| WebView2 renderer | 33 → 64 | Grows with layout, raster and fonts |
| Utility (storage) | ~12 | |
| Crashpad | ~7 | |
| **meiliops.exe (host)** | **~11** | |
| **App JS heap** | **10** | 657 DOM nodes at 32k docs scrolled |

**Conclusion:** our code accounts for about 20 MB. Everything else is the WebView2 floor. The original 100 MB idle target is not reachable with a web renderer.

## 💤 While minimized (applied in 0.3)

`MemoryUsageTargetLevel = Low` is set while the window is minimized (`src-tauri/src/memory.rs`, policy in `lib/platform.ts`). It pages out rather than frees, so **private bytes stay flat** and the win shows up as physical RAM (working set), which is what Task Manager's "Memory" column tracks.

| Scenario | Renderer working set | Tree working set | Tree private bytes |
|---|---|---|---|
| Visible, normal | ~72 MB | ~334 MB | ~136 MB |
| Visible, target forced to Low (isolates our call) | **~7 MB** | ~269 MB | ~136 MB |
| Minimized 15 s (our call + Chromium's own backgrounding) | ~19 MB | ~290 MB | ~138 MB |
| Restored 5 s | ~24 MB | ~295 MB | ~138 MB |

The browser process (~180 MB working set) is not affected by the target level.

## 🛠️ Remaining levers (not yet applied)

1. `--disable-gpu`: about −12 MB, at the cost of software-rendered scrolling
2. Drop crashpad (`--disable-breakpad`): about −7 MB, but we lose crash dumps
