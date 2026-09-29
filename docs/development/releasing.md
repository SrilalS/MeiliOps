# Releasing

Releases are built and published by GitHub Actions when a version tag is pushed.

## Steps

1. Bump the version in all three places (the release fails if they don't match the tag):
   - `app/package.json`
   - `app/src-tauri/Cargo.toml`
   - `app/src-tauri/tauri.conf.json`
2. Commit and push.
3. Tag and push the tag:

```bash
git tag -a v0.4.0 -m "MeiliOps v0.4.0"
```

```bash
git push origin v0.4.0
```

## What the workflow does

`.github/workflows/release.yml`:

1. **Checks**: the tag matches all three versions, typecheck, `coverage --strict`.
2. **Draft release** with notes generated from the commits since the previous tag.
3. **Builds** in parallel and uploads to the draft:

| Runner | Output |
|---|---|
| Windows | NSIS installer (`.exe`) |
| macOS (Apple Silicon and Intel) | `.dmg` for each |
| Ubuntu 22.04 | `.deb`, `.rpm`, `.AppImage` |

4. **Publish**: only when every build succeeded, so a release never goes out missing a platform.

Tags with a suffix (`v0.4.0-beta.1`) are published as pre-releases. Re-running a failed workflow reuses the existing draft.

## Other workflows

- `ci.yml`: typecheck and `coverage --strict` on every push and pull request. No app builds.
- `rust-cache.yml`: compiles the app on `main` (without making installers) when Rust dependencies change and once a week, so release builds restore compiled dependencies instead of starting cold. GitHub only lets tag builds reuse caches from the default branch, which is why this can't happen in the release itself.
- `docs.yml`: builds this documentation site and deploys it to GitHub Pages when `docs/` changes on `main`.
