# MeiliOps

A native desktop admin app for [Meilisearch](https://www.meilisearch.com), in the spirit of MongoDB Compass and pgAdmin. Built with Tauri 2 and SolidJS. No Electron.

## Features

- **Connections:** multiple servers, color-coded. API keys are stored in the OS credential store
- **Overview:** health, version, DB size, per-index stats, dumps and snapshots
- **Documents:** virtualized grid (only visible rows are rendered), filter and sort, JSON editor, add/replace/update from JSON, NDJSON or CSV files, delete by ID/filter/all, export
- **Schema:** Compass-style analysis of a document sample: field types, presence, value ranges and top values; exact whole-index facet counts; click a value to open matching documents; one-click "make filterable"
- **Search playground:** search-as-you-type, filters, sort, facets with facet search, hybrid/semantic search, ranking-score details, similar documents, raw JSON body mode
- **Settings:** every index setting with inline diff against the server, apply, reset, and a re-index warning
- **Index info:** stats, field distribution, rename, change primary key, swap, compact, delete
- **Tasks and batches:** live list, filters, cancel/delete by filter, task payloads
- **API keys:** create/edit/delete with an action picker; tenant tokens signed locally
- **Tasks and batches, live:** server-sent events push updates (polling fallback), batch progress bars, task-queue compaction
- **Multi-search:** federated and per-index queries
- **Search rules:** dynamic search rules (pin / boost / demote)
- **Chats:** chat workspaces, settings and a streaming playground
- **Operations:** metrics dashboard (Prometheus), live logs, export to another instance, webhooks, experimental features, MCP endpoint check
- **Local instances:** download the official Meilisearch binary (SHA-256 verified), run multiple instances with their own port, data dir, master key (in the OS keychain) and launch flags (the editor is generated from `meilisearch --help`), live logs, one-click connect, in-place database upgrade after binary updates
- **API console:** every operation in the OpenAPI spec (143 in v1.54), including streaming routes

**Coverage:** 140/143 operations have a dedicated screen. The other 3 are Enterprise-only (sharding) and reachable from the console. See `npm run coverage`.

## Development

Prerequisites: Node 20+, Rust (rustup), MSVC C++ build tools, WebView2 (preinstalled on Windows 11).

```bash
npm install
npm run dev          # UI only, in a browser (http://localhost:1420)
npm run tauri dev    # desktop app
npm run tauri build  # release build + installers
npm run typecheck
npm run coverage     # API coverage report
```

## License

MIT
