# MeiliOps — Project Memory

Native desktop admin app for **Meilisearch** (Compass / pgAdmin class). MIT licensed.
No AI-DLC or other process frameworks: plan briefly, build, verify.

## 🎯 Non-negotiables

1. **100% coverage of Meilisearch's stable API** for the latest stable release. Experimental routes are best-effort.
2. **No Electron.** Tauri 2 + TypeScript. Memory budget: **< 100 MB idle for the whole process tree** (WebView2 included).
3. Windows 11 x64 first; macOS and Linux must keep building.
4. **The team writes TypeScript only.** The Rust in `app/src-tauri` is boilerplate plus the OS keychain commands. Add native features through Tauri plugins before writing Rust.
5. API keys live in the OS credential store, never in plain-text config.

## 🗺️ Layout

| Path | What |
|---|---|
| `app/src/api/meili.ts` | Dependency-free HTTP client. **Every call is `req("METHOD", "/literal/path")`**, typed against the generated OpenAPI types |
| `app/src/api/schema.d.ts` | Generated from `app/spec/meilisearch-openapi.json` (don't edit) |
| `app/src/api/operations.json` | Generated op catalog for the API console (`npm run gen`) |
| `app/src/state/app.ts` | Connections, active client, task tracking (`trackTask`), toasts |
| `app/src/views/` | Screens. `views/index/settingsCatalog.ts` lists every settings sub-route |
| `app/scripts/coverage.mjs` | API coverage report (`npm run coverage`) |
| `app/scripts/measure-memory.ps1` | Memory of the whole process tree |
| `Research/` | Pre-build research and answered requirements |
| `.dev/` | Local Meilisearch binary, data, dev key (gitignored) |

## 🔁 Updating to a new Meilisearch release

1. Download the release's `meilisearch-openapi.json` into `app/spec/`
2. `npx openapi-typescript@7 spec/meilisearch-openapi.json -o src/api/schema.d.ts && npm run gen`
3. `npm run typecheck`: renamed or removed routes fail here
4. `npm run coverage`: lists new operations without a dedicated UI

## ▶️ Dev loop

- Local server: `.dev/meilisearch.exe` on port **7711** (7700 is blocked on this machine). The key is in `.dev/dev.env`
- UI in a browser: `npm run dev --prefix app` (secrets fall back to localStorage, dev only)
- Desktop app: `npm run tauri dev --prefix app` (needs `~/.cargo/bin` on PATH)
