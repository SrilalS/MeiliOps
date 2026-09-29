# MeiliOps app

The MeiliOps desktop app: Tauri 2 + SolidJS + TypeScript. See the [project README](../README.md) for what it does and the [documentation](https://srilals.github.io/MeiliOps/) for how to use it.

## Development

Prerequisites: Node.js 20+, Rust (rustup), MSVC C++ build tools on Windows. WebView2 is preinstalled on Windows 11.

```bash
npm install
npm run dev          # UI only, in a browser (http://localhost:1420)
npm run tauri dev    # desktop app
npm run tauri build  # release build + installer
npm run typecheck
npm run coverage     # API coverage report (--strict fails on uncovered stable operations)
```

More in the [contributing guide](https://srilals.github.io/MeiliOps/development/) and [architecture notes](https://srilals.github.io/MeiliOps/development/architecture).
