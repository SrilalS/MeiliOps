// Generates src/api/since.json: the first Meilisearch version that serves each
// operation newer than the minimum supported version (MIN below).
//
// Source of truth: the OpenAPI spec published with every release since 1.18
// (cached in spec/history/, gitignored). An operation's version is the first
// minor whose spec lists it. Older specs sometimes left out routes that already
// worked, so PRESENT_AT_MIN lists operations a live MIN server was probed to
// serve even though the spec added them later.
//
// Usage: node scripts/gen-since.mjs   (run after updating spec/meilisearch-openapi.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MIN = "1.18.0";

// Probed against a 1.18.0 server on 2026-11-25: these answer on 1.18 although
// the spec only documents them from a later release.
const PRESENT_AT_MIN = new Set([
  "POST /indexes/{}/documents/delete-batch", // spec: 1.26
  "GET /tasks/{}/documents", // spec: 1.38
  "GET /chats", // spec: 1.38 (experimental)
  "GET /chats/{}",
  "DELETE /chats/{}",
  "GET /chats/{}/settings",
  "PATCH /chats/{}/settings",
  "DELETE /chats/{}/settings",
  "POST /chats/{}/chat/completions",
]);

const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const cacheDir = join(root, "spec/history");
const norm = (p) => p.replace(/\{[^}]+\}/g, "{}");
const minorOf = (v) => Number(v.split(".")[1]);

function ops(spec) {
  const out = new Map(); // normalized id -> literal id
  for (const [path, item] of Object.entries(spec.paths))
    for (const m of ["get", "post", "put", "patch", "delete"]) if (item[m]) out.set(`${m.toUpperCase()} ${norm(path)}`, `${m.toUpperCase()} ${path}`);
  return out;
}

async function specFor(version) {
  const file = join(cacheDir, `v${version}.json`);
  if (!existsSync(file)) {
    const url = `https://github.com/meilisearch/meilisearch/releases/download/v${version}/meilisearch-openapi.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, await res.text());
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

const current = JSON.parse(readFileSync(join(root, "spec/meilisearch-openapi.json"), "utf8"));
const latest = current.info.version;
const currentOps = ops(current);

// Every minor from MIN up to (not including) the current one, plus the current spec itself.
const history = [];
for (let n = minorOf(MIN); n < minorOf(latest); n++) history.push({ version: `1.${n}.0`, ops: ops(await specFor(`1.${n}.0`)) });
history.push({ version: latest, ops: currentOps });

const since = {};
for (const [id, literal] of currentOps) {
  if (PRESENT_AT_MIN.has(id)) continue;
  const first = history.find((h) => h.ops.has(id)).version;
  if (first !== MIN) since[literal] = first;
}

const sorted = Object.fromEntries(Object.entries(since).sort(([a, va], [b, vb]) => minorOf(va) - minorOf(vb) || a.localeCompare(b)));
writeFileSync(join(root, "src/api/since.json"), JSON.stringify({ min: MIN, latest, ops: sorted }, null, 2) + "\n");
console.log(`since.json: ${Object.keys(sorted).length} operations newer than ${MIN} (spec ${latest})`);
