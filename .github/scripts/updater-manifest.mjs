// Writes the updater feed (latest.json) for a draft release from its signed assets.
//
// Built once in the publish job instead of by each tauri-action build: parallel jobs each
// rewrite latest.json and can drop each other's platforms, and a draft's asset URLs point at
// an "untagged-…" path that stops working once it is published. URLs here use the tag.
//
// env: GITHUB_TOKEN, GITHUB_REPOSITORY, RELEASE_ID, TAG. Writes ./latest.json.
// `node updater-manifest.mjs --test` checks the file-name mapping without the network.

import { writeFileSync } from "node:fs";

/** Asset name → updater platform keys. The first key of each is the plain `{os}-{arch}` fallback. */
export function platformKeys(name) {
  if (/_x64-setup\.exe$/.test(name)) return ["windows-x86_64", "windows-x86_64-nsis"];
  // tauri-action adds the arch to the macOS archive name (both targets build MeiliOps.app).
  if (/(aarch64|arm64)[^/]*\.app\.tar\.gz$/.test(name)) return ["darwin-aarch64", "darwin-aarch64-app"];
  if (/(x64|x86_64)[^/]*\.app\.tar\.gz$/.test(name)) return ["darwin-x86_64", "darwin-x86_64-app"];
  if (/_amd64\.AppImage$/.test(name)) return ["linux-x86_64", "linux-x86_64-appimage"];
  if (/_amd64\.deb$/.test(name)) return ["linux-x86_64-deb"];
  if (/\.x86_64\.rpm$/.test(name)) return ["linux-x86_64-rpm"];
  return [];
}

/** Every platform the release matrix builds must be in the feed. */
export const REQUIRED = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64", "linux-x86_64-deb", "linux-x86_64-rpm"];

export function buildManifest({ version, notes, pubDate, repo, tag, assets, signatures }) {
  const platforms = {};
  for (const a of assets) {
    const keys = platformKeys(a.name);
    const signature = signatures[a.name];
    if (!keys.length || !signature) continue;
    const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(a.name)}`;
    for (const k of keys) platforms[k] = { signature, url };
  }
  const missing = REQUIRED.filter((k) => !platforms[k]);
  if (missing.length) throw new Error(`No signed updater asset for: ${missing.join(", ")}`);
  return { version, notes, pub_date: pubDate, platforms };
}

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY: repo, RELEASE_ID, TAG: tag } = process.env;
  const api = (path, accept = "application/vnd.github+json") =>
    fetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: accept } }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r;
    });
  const release = await (await api(`/releases/${RELEASE_ID}`)).json();
  const assets = [];
  for (let page = 1; ; page++) {
    const batch = await (await api(`/releases/${RELEASE_ID}/assets?per_page=100&page=${page}`)).json();
    assets.push(...batch);
    if (batch.length < 100) break;
  }
  const signatures = {};
  for (const sig of assets.filter((a) => a.name.endsWith(".sig"))) {
    signatures[sig.name.slice(0, -4)] = (await (await api(`/releases/assets/${sig.id}`, "application/octet-stream")).text()).trim();
  }
  const manifest = buildManifest({
    version: tag.replace(/^v/, ""),
    notes: release.body ?? "",
    pubDate: new Date().toISOString(),
    repo,
    tag,
    assets: assets.filter((a) => !a.name.endsWith(".sig")),
    signatures,
  });
  writeFileSync("latest.json", JSON.stringify(manifest, null, 2));
  console.log(`latest.json: ${Object.keys(manifest.platforms).join(", ")}`);
}

if (process.argv.includes("--test")) {
  const names = ["MeiliOps_0.5.0_x64-setup.exe", "MeiliOps_aarch64.app.tar.gz", "MeiliOps_x64.app.tar.gz", "MeiliOps_0.5.0_amd64.AppImage", "MeiliOps_0.5.0_amd64.deb", "MeiliOps-0.5.0-1.x86_64.rpm", "MeiliOps_0.5.0_aarch64.dmg"];
  const m = buildManifest({ version: "0.5.0", notes: "", pubDate: "", repo: "o/r", tag: "v0.5.0", assets: names.map((name) => ({ name })), signatures: Object.fromEntries(names.map((n) => [n, `sig:${n}`])) });
  for (const [k, v] of Object.entries(m.platforms)) console.log(k.padEnd(24), v.url.split("/").pop());
} else {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
