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

4. **Updater feed**: writes `latest.json` from the signed files (`.github/scripts/updater-manifest.mjs`) and fails if any platform is missing.
5. **Publish**: only when every build succeeded, so a release never goes out missing a platform.

Tags with a suffix (`v0.4.0-beta.1`) are published as pre-releases. Re-running a failed workflow reuses the existing draft.

## Update signing key

The in-app updater only installs files signed with the MeiliOps key. The builds sign them with two repository secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password |

The public half is `plugins.updater.pubkey` in `tauri.conf.json` (also `app/meiliops.key.pub`).

::: danger Back up the private key
If the key is lost, installed copies can never update again: they only trust the public key they were built with. Keep the key file and its password in a password manager, not only on one machine. Never commit it (`*.key` is gitignored).
:::

To test a release build's update locally, build with the key in the environment: `TAURI_SIGNING_PRIVATE_KEY` (file contents or path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without them, `tauri build` makes the installer and then fails at the signing step, because `createUpdaterArtifacts` is on. For everyday local builds use `npm run build:unsigned`, which turns the updater files off.

## Other workflows

- `ci.yml`: typecheck and `coverage --strict` on every push and pull request. No app builds.
- `rust-cache.yml`: compiles the app on `main` (without making installers) when Rust dependencies change and once a week, so release builds restore compiled dependencies instead of starting cold. GitHub only lets tag builds reuse caches from the default branch, which is why this can't happen in the release itself.
- `docs.yml`: builds this documentation site and deploys it to GitHub Pages when `docs/` changes on `main`.
