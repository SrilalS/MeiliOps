# Contributing

MeiliOps is MIT licensed and contributions are welcome. The whole app is **TypeScript**; you don't need to know Rust.

## Prerequisites

- Node.js 20 or newer
- Rust via [rustup](https://rustup.rs) (only to build the desktop shell; you won't edit Rust)
- Windows: the MSVC C++ build tools. WebView2 ships with Windows 11.
- macOS: Xcode command line tools
- Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libdbus-1-dev`

## Run it

```bash
cd app
npm install
npm run dev          # UI only, in a browser at http://localhost:1420
npm run tauri dev    # the desktop app, with hot reload
```

The browser mode is the fastest loop for UI work. It stores API keys in `localStorage` (insecure, development only) and can't run local instances.

For a server to point it at, run Meilisearch locally, for example with the [local instance manager](../guide/local-instances) in the desktop app, or:

```bash
meilisearch --http-addr 127.0.0.1:7711 --experimental-enable-metrics --experimental-enable-logs-route --experimental-enable-tasks-streaming-route
```

## Before you open a pull request

```bash
npm run typecheck
npm run coverage -- --strict
```

CI runs the same two checks. `coverage --strict` fails when a stable Meilisearch operation has no screen.

## Conventions

- **API calls** go through `api().req("METHOD", "/literal/path", …)`. The path must be a string literal from the generated OpenAPI types: that's what gives compile-time checking and lets the coverage script find every call.
- **Styling** uses the design tokens at the top of `src/styles.css` (`--bg*`, `--fg*`, `--accent*`, `--control-h`). No raw colors in components; both themes must work.
- **Icons** come from `src/components/icons.ts` (Lucide). Add new ones there; don't use Unicode glyphs as icons.
- **Long-running async work** pins the client before its first `await` (`const m = api()`), because the user can switch servers mid-flight.
- **Native code** is limited to three small files in `src-tauri/src`. Prefer a Tauri plugin; add Rust only when a plugin is broken or missing, and document why.

See [Architecture](./architecture) for how the pieces fit together.
