# Performance

MeiliOps is built to stay small and light. These numbers were measured on Windows 11 x64 with the release build, summing memory across the **whole process tree** (the app plus every WebView2 process), which is how Task Manager's per-app total works.

## Size

| | |
|---|---|
| Installer (Windows) | about **3 MB** |
| App executable | about 9 MB |
| Initial JavaScript | about 140 KB (the code editor loads on first use) |

## Memory

| Scenario | Private memory |
|---|---|
| Idle | about **140 MB** |
| In use: 32,000-document grid scrolled end to end, JSON editor open | about 200 MB |
| After leaving the grid | about 170 MB |

MeiliOps's own code accounts for about 20 MB of that (a 10 MB JavaScript heap and an 11 MB host process). The rest is the system WebView, which every Tauri app pays. Electron apps, by comparison, ship their own full copy of Chromium with every app instead of using the one built into the OS.

How it stays low:

- WebView2 is launched with tuned flags: a single renderer process, the GPU in-process, and background services off.
- The documents grid is virtualized and keeps at most about 2,400 rows in memory, however far you scroll.
- The code editor is loaded only when a screen needs it.

## While minimized

When the window is minimized, MeiliOps sets WebView2's memory target to *low*. The page's working set drops from about 72 MB to under 10 MB, handing that RAM back to other apps until you restore the window.

The full measurements and method are in the repository under [`Research/08-performance-results.md`](https://github.com/SrilalS/MeiliOps/blob/main/Research/08-performance-results.md).
