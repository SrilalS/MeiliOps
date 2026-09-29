# 09 — CI build speed (measured)

> Why the v0.3.0 Windows release build took 18 minutes, and what makes it faster.
> Local measurements: Windows 11, `cargo build --release -j 4` (GitHub's Windows runners have 4 vCPUs), cold target dir unless noted. Local cold time for the current config (503 s) matches CI (7 min), so the local numbers transfer.

## 🔍 Where the time goes

CI step timings for the two v0.3.0 runs (same commit):

| Job | Run 1 (tag) | Run 2 (manual, `main`) | Rust compile share |
|---|---|---|---|
| Windows x64 | 8 min | **17 min** | 7m03s → 14m01s |
| Linux x64 | 10 min | 10 min | ~7m20s (+ ~2 min AppImage/deb/rpm bundling) |
| macOS arm64 | 4 min | 7 min | 3m09s → 5m38s |
| macOS x64 | 10 min | 7 min | |

- **Rust compilation is 85–95% of every job.** Node, Vite (1–2 s) and setup are noise.
- **The same commit took 7 or 14 minutes on Windows**: GitHub's Windows runners vary a lot run to run. That part isn't in our control.
- **Both runs had zero cache hits** ("No cache found"). Expected for first builds, but see below.

## 🧪 Experiments (cold, 4 cores)

| # | Config | Time | exe | vs today |
|---|---|---|---|---|
| A | Today: `crate-type = ["staticlib","cdylib","rlib"]`, fat LTO, 1 codegen unit | 503 s | 8,599 KB | — |
| B | A + thin LTO, 16 codegen units | 402 s | 9,966 KB | −20% |
| C | A + no LTO, 16 codegen units | 311 s | 9,411 KB | −38% |
| **D** | **A with `crate-type = ["rlib"]`** | **373 s** | **8,598 KB** | **−26%, same binary** |
| E | D + thin LTO, 16 codegen units | 323 s | 9,966 KB | −36% |

Warm rebuild (dependencies cached, only our crate changed — what a CI cache hit looks like):

| Config | Time |
|---|---|
| A (today) | 184 s |
| D | 158 s |

### Finding 1: our crate is built three times

`cargo --timings` for A: `meiliops` (lib) 125 s, then `meiliops` (bin) 130 s, sequentially: **half the build**. The template's `staticlib` and `cdylib` crate types exist for iOS and Android. With fat LTO, each is a whole-program optimization over all ~290 crates, before the `.exe` does it again. Desktop only needs `rlib`. Dropping the other two gives an **identical binary 130 s sooner**.

### Finding 2: fat LTO + 1 codegen unit is the rest of the tail

The final binary's LTO pass is single-threaded (~150 s of the 158 s warm build). Thin LTO + 16 units (E) saves another ~50 s cold, but the exe grows 1.3 MB (installer roughly +0.4 MB compressed). Not applied: the size budget matters more than 50 s.

### Finding 3: tag builds can never reuse each other's cache

GitHub caches are scoped by ref. A tag build can read caches from the default branch, but not from other tags. Nothing builds Rust on `main` (CI is checks-only), so every release is a cold build. The manual v0.3.0 rebuild ran on `main` and left ~450 MB caches per platform there, so the **next** release can use them. But they're evicted after 7 days without use, and their key changes when `Cargo.lock` changes. `Swatinem/rust-cache` falls back to a partial restore on a key miss, which still restores most dependencies.

### Not the problem

- Dependencies: 287 crates, of which Tauri itself is 212 and the HTTP/upload plugins' shared `reqwest` stack ~55. `ring` is the only C-backed crate (seconds). No `aws-lc`/OpenSSL.
- Frontend build: 1–2 s.

## ✅ Recommendations

> **Applied:** 1 (`crate-type = ["rlib"]`) and 2 (`.github/workflows/rust-cache.yml`; `release.yml` now restores with a shared key and doesn't save).


| # | Change | Effect | Cost |
|---|---|---|---|
| 1 | `crate-type = ["rlib"]` | **−26% cold, identical binary** | None (no mobile targets) |
| 2 | Keep a Rust cache on `main` (a small workflow that runs `cargo build --release` per platform when `Cargo.lock` changes, plus weekly so it isn't evicted) | Release compile ~373 s → ~158 s | ~4 extra CI builds when dependencies change; it's a cache warm-up, not a release |
| 3 | Windows: build on a Dev Drive (ReFS) via `samypr100/setup-dev-drive` | Commonly reported 10–30% on Rust builds on Windows runners | Unmeasured here; try it and compare |
| 4 | Thin LTO + 16 codegen units | −50 s cold | +1.3 MB exe |
| 5 | Larger runners (8–16 cores, paid) | Faster dependency builds; doesn't help the single-threaded LTO tail | Money |

Projected Windows release job with 1 + 2: compile ~2.5–3 min on a cache hit (vs 7–14), ~6 min cold.
