# MeiliOps — Project Memory

Native desktop admin app for **Meilisearch** (Compass / pgAdmin class). MIT licensed.
No AI-DLC or other process frameworks: plan briefly, build, verify.

## 🎯 Non-negotiables

1. **100% coverage of Meilisearch's stable API** for the latest stable release. Experimental routes are best-effort. Enterprise-only routes (`/network*`) are out of scope and console-only.
2. **No Electron.** Tauri 2 + TypeScript (SolidJS). Memory: see `Research/08-performance-results.md`.
3. Windows 11 x64 first; macOS and Linux must keep building.
4. **The team writes TypeScript only.** Native code is limited to `app/src-tauri/src/lib.rs` (keychain), `files.rs` (sandboxed file ops) and `memory.rs` (WebView2 memory target, not exposed by Tauri). Prefer Tauri plugins; add Rust only when a plugin is broken or missing, and document why.
5. API keys live in the OS credential store, never in plain-text config.

## 🗺️ Layout

| Path | What |
|---|---|
| `app/src/api/meili.ts` | Dependency-free HTTP client. **Every call is `req("METHOD", "/literal/path")`**, typed against the generated OpenAPI types |
| `app/src/api/schema.d.ts` | Generated from `app/spec/meilisearch-openapi.json` (don't edit) |
| `app/src/api/operations.json` | Generated op catalog for the API console (`npm run gen`) |
| `app/src/state/app.ts` | Connections, active client, task tracking (`trackTask`), toasts |
| `app/src/state/instances.ts` | Local instance manager: binary install, start/stop, launch flags |
| `app/src/lib/sse.ts` | Fetch-based SSE reader (EventSource can't send auth headers) |
| `app/src/lib/schema.ts` | Schema analysis of a document sample (Schema tab) |
| `app/src/views/` | Screens. `views/index/settingsCatalog.ts` lists every settings sub-route |
| `app/scripts/coverage.mjs` | API coverage report (`npm run coverage`, `--strict` for CI) |
| `app/scripts/measure-memory.ps1` | Memory of the whole process tree |
| `.github/workflows/ci.yml` | Typecheck, `coverage --strict`, web build; app builds on Windows (NSIS artifact), macOS, Linux |

## ⚠️ Gotchas (learned the hard way)

- **tauri-plugin-fs is broken for us on Windows.** Every *existing* path under `$APPLOCALDATA` is reported "forbidden" (verbatim `\\?\` canonicalization never matches the scope). Hence `files.rs`.
- **`POST /logs/stream` is Brotli-compressed** when the client accepts it, and the compressor holds chunks back forever. Browsers can't opt out, so LogsView uses `@tauri-apps/plugin-http` with `Accept-Encoding: identity` (needs its `unsafe-headers` feature).
- **`@tauri-apps/plugin-*` npm and crate versions must share major.minor**, or `tauri build` fails. `tauri-plugin-http` is pinned to `~2.7` for this reason.
- **Capabilities are compiled in.** After editing `capabilities/*.json`, touch `build.rs` or cargo may not rebuild.
- **`additionalBrowserArgs` in `tauri.conf.json` overrides `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.** To debug a build over CDP, merge `--remote-debugging-port=9333` in via the `TAURI_CONFIG` env var at build time.
- Something on this machine already listens on **7700**. The dev server uses **7711**, and local instances check ports before starting.
- **Sync `#[tauri::command]`s run on the main thread.** Anything that calls `with_webview` and waits for it must be `async`, or it deadlocks (see `memory.rs`).
- Some experimental features are **launch flags** (logs route, metrics, task streaming); others are runtime toggles (`/experimental-features`). `ApiError` points users to the right one.

## 🔁 Updating to a new Meilisearch release

1. Download the release's `meilisearch-openapi.json` into `app/spec/`
2. `npx openapi-typescript@7 spec/meilisearch-openapi.json -o src/api/schema.d.ts && npm run gen`
3. `npm run typecheck`: renamed or removed routes fail here
4. `npm run coverage -- --strict`: new stable operations without a screen fail here

## ▶️ Dev loop

- Local server: `.dev/meilisearch.exe` on port 7711 with metrics, logs and task-streaming routes on. The key is in `.dev/dev.env`
- UI in a browser: `npm run dev --prefix app` (secrets fall back to localStorage; local instances need the desktop app)
- Desktop app: `npm run tauri dev --prefix app` (needs `~/.cargo/bin` on PATH)
- Installer: `npm run tauri build --prefix app` → `src-tauri/target/release/bundle/nsis/`
