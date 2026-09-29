# Architecture

```
┌────────────────────────────── MeiliOps ───────────────────────────────┐
│  SolidJS UI (TypeScript)                                              │
│   views/ ── state/app.ts ── api/meili.ts ──── HTTP ────▶ Meilisearch  │
│               │   (connections,     (typed client,                    │
│               │    tasks, toasts)    reachability hooks)              │
│               ├─ state/instances.ts ─┬─ process.rs ───▶ meilisearch   │
│               │                      │                  (native)      │
│               │                      └─ shell plugin ─▶ docker/podman │
│               └─ state/updater.ts ── updater plugin ──▶ GitHub        │
├───────────────────────────────────────────────────────────────────────┤
│  Tauri 2 shell (Rust, under 400 lines)                                │
│   lib.rs      OS keychain for API keys                                │
│   files.rs    file ops inside the app data folder                     │
│   memory.rs   WebView2 memory target while minimized                  │
│   process.rs  side-by-side Meilisearch versions                       │
│   plugins     store · shell · http · upload · os · updater · process  │
└───────────────────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Uses the OS WebView instead of bundling Chromium: small installer, low memory |
| UI | SolidJS + Vite | Fine-grained reactivity without a virtual DOM; small runtime |
| Editor | CodeMirror 6 | Lazy-loaded; JSON linting and inline diffs |
| Grid | TanStack Virtual | Renders only visible rows |
| Icons | Lucide | Per-icon imports, tree-shaken |

## Source layout

| Path | What |
|---|---|
| `app/src/api/meili.ts` | Dependency-free HTTP client. Every call is `req("METHOD", "/literal/path")`, typed against the generated OpenAPI types |
| `app/src/api/schema.d.ts` | Generated from `app/spec/meilisearch-openapi.json` (don't edit) |
| `app/src/state/app.ts` | Connections and their states, the active client, navigation, task tracking, notifications |
| `app/src/state/instances.ts` | Local instance manager: binary install, start/stop, launch flags |
| `app/src/state/theme.ts` | System / light / dark theme |
| `app/src/lib/` | SSE reader, schema analysis, `meilisearch --help` parser, tenant tokens |
| `app/src/views/` | Screens; `views/index/` holds the index tabs |
| `app/src-tauri/` | The native shell, capabilities and bundle config |
| `app/scripts/` | Coverage report, operation catalog generator, memory measurement |

## Connection lifecycle

```
idle ──connect──▶ connecting ──ok──▶ ready ◀──server back──┐
                      │                 │                   │
                      └──fail──▶ error  └──server gone──▶ lost
```

- **error**: the first connection failed. An error screen offers Retry, Edit and Back.
- **lost**: the server stopped answering after connecting. Screens stay mounted, polling and streams pause, a watchdog probes `/health` every 3 s, and error panels retry by themselves once it's back.

The HTTP client reports reachability through two hooks (`onUnreachable`, `onReachable`), which is how the whole app learns about a lost server from any failed request.

## Why these three Rust files

- **Keychain** (`lib.rs`): there's no Tauri plugin for the OS credential store.
- **Files** (`files.rs`): `tauri-plugin-fs` rejects every existing path under the app data folder on Windows (its scope check never matches Windows' `\\?\` path form), so the instance manager uses these small, sandboxed commands instead.
- **Memory** (`memory.rs`): Tauri doesn't expose WebView2's memory target level.
