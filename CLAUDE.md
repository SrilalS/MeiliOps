# MeiliOps — Project Memory

Native desktop admin app for **Meilisearch** (Compass / pgAdmin class). MIT licensed.
No AI-DLC or other process frameworks: plan briefly, build, verify.

## 🎯 Non-negotiables

1. **100% coverage of Meilisearch's stable API** for the latest stable release. Experimental routes are best-effort. Enterprise-only routes (`/network*`) are out of scope and console-only.
2. **No Electron.** Tauri 2 + TypeScript (SolidJS). Memory: see `Research/08-performance-results.md`.
3. Windows 11 x64 first; macOS and Linux must keep building.
4. **The team writes TypeScript only.** Native code is limited to `app/src-tauri/src/lib.rs` (keychain), `files.rs` (sandboxed file ops), `memory.rs` (WebView2 memory target, not exposed by Tauri) and `process.rs` (runs side-by-side Meilisearch versions; the shell scope can't allow a per-version path). Prefer Tauri plugins; add Rust only when a plugin is broken or missing, and document why.
5. API keys live in the OS credential store, never in plain-text config.

## 🗺️ Layout

| Path | What |
|---|---|
| `app/src/api/meili.ts` | Dependency-free HTTP client. **Every call is `req("METHOD", "/literal/path")`**, typed against the generated OpenAPI types |
| `app/src/api/schema.d.ts` | Generated from `app/spec/meilisearch-openapi.json` (don't edit) |
| `app/src/api/operations.json` | Generated op catalog for the API console (`npm run gen`) |
| `app/src/state/app.ts` | Connections, active client, task tracking (`trackTask`), toasts |
| `app/src/state/instances.ts` | Local instance manager: side-by-side native versions (`bin/<version>/`), Docker/Podman containers, start/stop, launch flags, data-version tracking |
| `app/src/lib/sse.ts` | Fetch-based SSE reader (EventSource can't send auth headers) |
| `app/src/lib/schema.ts` | Schema analysis of a document sample (Schema tab) |
| `app/src/styles.css` | Design tokens at the top (Meilisearch palette, light + dark on `html[data-theme]`), then components |
| `app/src/state/updater.ts` | In-app updates (tauri-plugin-updater): daily check, title-bar Update button, `UpdateDialog.tsx` |
| `app/src/state/theme.ts` | System / light / dark theme; `index.html` applies it before first paint |
| `app/src/components/icons.ts` | Icon registry (Lucide, per-icon imports). Use icons from here, never Unicode glyphs |
| `app/src/views/TitleBar.tsx` | Custom title bar: connection switcher, breadcrumb, theme menu, window controls |
| `app/src/views/` | Screens. `views/index/settingsCatalog.ts` lists every settings sub-route |
| `app/scripts/coverage.mjs` | API coverage report (`npm run coverage`, `--strict` for CI) |
| `app/scripts/measure-memory.ps1` | Memory of the whole process tree |
| `.github/workflows/ci.yml` | Push/PR: typecheck + `coverage --strict` only (no app builds) |
| `.github/workflows/release.yml` | Tag `v*`: checks, draft release, builds (Windows NSIS, macOS arm64 + x64 DMG, Linux deb/rpm/AppImage), then publishes |
| `.github/scripts/updater-manifest.mjs` | Writes the updater feed `latest.json` in the release's publish job (`--test` checks the file-name mapping) |
| `.github/workflows/rust-cache.yml` | Keeps a compiled Rust dependency cache on `main` (on `Cargo.lock` changes + weekly) so releases start warm. Builds nothing that ships |
| `.github/workflows/docs.yml` | Builds `docs/` (VitePress) and deploys it to GitHub Pages on changes to `main` |
| `docs/` | User and developer documentation site. Screenshots in `docs/public/screenshots/`. Keep it in sync when features change |
| `README.md` | Project front page (features, install, screenshots) |

## ⚠️ Gotchas (learned the hard way)

- **tauri-plugin-fs is broken for us on Windows.** Every *existing* path under `$APPLOCALDATA` is reported "forbidden" (verbatim `\\?\` canonicalization never matches the scope). Hence `files.rs`.
- **`POST /logs/stream` is Brotli-compressed** when the client accepts it, and the compressor holds chunks back forever. Browsers can't opt out, so LogsView uses `@tauri-apps/plugin-http` with `Accept-Encoding: identity` (needs its `unsafe-headers` feature).
- **`@tauri-apps/plugin-*` npm and crate versions must share major.minor**, or `tauri build` fails. `tauri-plugin-http` is pinned to `~2.7` for this reason.
- **Capabilities are compiled in.** After editing `capabilities/*.json`, touch `build.rs` or cargo may not rebuild.
- **`additionalBrowserArgs` in `tauri.conf.json` overrides `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.** To debug a build over CDP, merge `--remote-debugging-port=9333` in via the `TAURI_CONFIG` env var at build time.
- Something on this machine already listens on **7700**. The dev server uses **7711**, and local instances check ports before starting.
- **CI caches are ref-scoped.** Tag builds can read `main`'s caches but not other tags', so `rust-cache.yml` warms them on `main` and `release.yml` only restores (`save-if: false`). Both must use the same `shared-key` (`tauri-<os>-<rust-target>`), or releases miss.
- **Keep `crate-type = ["rlib"]`.** The template's `staticlib`/`cdylib` (mobile only) each add a full LTO pass: +130 s per build, same binary.
- **Native Meilisearch runs through `process.rs`, containers through the shell plugin.** The shell scope pins one fixed path per program, so side-by-side versions can't be listed in `capabilities/default.json`. Docker/Podman are scoped by name plus the usual macOS install paths (GUI apps there don't get the shell `PATH`).
- **Orphaned native instances hold their data open** (Windows won't delete files in use). `process.rs` puts every started instance in a kill-on-close job object, so it dies with the app however the app exits. macOS/Linux have no equivalent yet: an app crash there leaves Meilisearch running until the port check or a failed delete says so.
- **Instance data is per engine.** `dataVersion[engine]` records the version that last opened it: newer → `--upgrade-db` (1.12+), older → refused (`upgradePlan`). Containers use a named volume `meiliops-<id>`, not a bind mount (LMDB over Windows/WSL mounts is unreliable).
- **`<For>` over `<option>`s must key on primitives.** New objects each render re-create the options and the `<select>` snaps to the first one.
- **Updates are signed.** Release builds need the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets; the public key is in `tauri.conf.json` (`plugins.updater.pubkey`). Losing the private key strands every installed copy. Locally, `tauri build` makes the installer and then fails on signing: use `npm run build:unsigned`.
- **`latest.json` is built once, in the publish job**, not by tauri-action (`includeUpdaterJson: false`): parallel jobs overwrite each other's entries, and a draft's asset URLs (`untagged-…`) break on publish. Adding a platform to the matrix means adding it to `REQUIRED` in `updater-manifest.mjs`.
- **Sync `#[tauri::command]`s run on the main thread.** Anything that calls `with_webview` and waits for it must be `async`, or it deadlocks (see `memory.rs`).
- **The window has no native frame on Windows/Linux** (`decorations: false`); `TitleBar.tsx` draws the controls. macOS keeps native traffic lights via `tauri.macos.conf.json` (arrays in platform configs replace, so that file repeats the whole window). Empty title-bar areas need `data-tauri-drag-region`.
- **Connection states** (`state/app.ts`): `idle → connecting → ready ⇄ lost`, or `error`. `lost` means the server stopped answering mid-session: views stay mounted, a watchdog probes `/health`, and `ApiError` panels retry on their own once it's back. Use `connected()` (ready or lost) to decide what renders, and `online()` to gate polling. Open the connection form with `openConnectionForm()`, never `setView`, so Cancel returns to where the user was.
- **Pin the client in long-running async work** (`const m = api()` before the first `await`). The user can switch servers mid-flight, and `api()` would then return the new server.
- **UI consistency:** use the tokens (`--bg*`, `--fg*`, `--accent*`, `--control-h`), never raw colors in components. Buttons, inputs and selects share `--control-h`; icon-only buttons are `.icon-btn` (24px) or `button.square` (control height).
- Some experimental features are **launch flags** (logs route, metrics, task streaming); others are runtime toggles (`/experimental-features`). `ApiError` points users to the right one.

## 🔁 Updating to a new Meilisearch release

1. Download the release's `meilisearch-openapi.json` into `app/spec/`
2. `npx openapi-typescript@7 spec/meilisearch-openapi.json -o src/api/schema.d.ts && npm run gen`
3. `npm run typecheck`: renamed or removed routes fail here
4. `npm run coverage -- --strict`: new stable operations without a screen fail here

## 🚀 Releasing

1. Bump the version in `app/package.json`, `app/src-tauri/Cargo.toml` and `app/src-tauri/tauri.conf.json` (the release fails if the tag doesn't match all three)
2. Commit, then `git tag v0.3.0 && git push origin v0.3.0`
3. The release is published only when every platform builds. Tags like `v0.3.0-beta.1` become pre-releases

## ▶️ Dev loop

- Local server: `.dev/meilisearch.exe` on port 7711 with metrics, logs and task-streaming routes on. The key is in `.dev/dev.env`
- UI in a browser: `npm run dev --prefix app` (secrets fall back to localStorage; local instances need the desktop app)
- Desktop app: `npm run tauri dev --prefix app` (needs `~/.cargo/bin` on PATH)
- Installer: `npm run build:unsigned --prefix app` → `src-tauri/target/release/bundle/nsis/` (no updater signing key needed)
- Docs site: `npm run dev --prefix docs` (VitePress). `npm run build --prefix docs` fails on dead links
