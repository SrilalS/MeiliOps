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

## 🛠️ Remaining levers (not yet applied)

1. `--disable-gpu`: about −12 MB, at the cost of software-rendered scrolling
2. WebView2 `MemoryUsageTargetLevel = Low` when minimized or unfocused: big cuts while in the background (small Rust addition via `with_webview`)
3. Drop crashpad (`--disable-breakpad`): about −7 MB, but we lose crash dumps
