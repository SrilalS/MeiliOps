// API coverage report: which OpenAPI operations have a dedicated UI.
//
// Detection = static scan of src/ for `req("METHOD", "/path"` calls plus the
// settings catalog (each `setting(key, METHOD, slug, …)` covers GET/METHOD/DELETE).
// Every operation is also reachable through the generic API console, so the
// report distinguishes "dedicated UI" from "console only".
//
// Usage: node scripts/coverage.mjs [--strict]   (--strict exits 1 if a stable op lacks a dedicated UI)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const spec = JSON.parse(readFileSync(join(root, "spec/meilisearch-openapi.json"), "utf8"));

const all = [];
for (const [path, item] of Object.entries(spec.paths))
  for (const m of ["get", "post", "put", "patch", "delete"])
    if (item[m]) all.push({ id: `${m.toUpperCase()} ${path}`, tag: item[m].tags?.[0] ?? "Other", summary: item[m].summary ?? "", experimental: /experimental/i.test(`${item[m].summary} ${item[m].description}`) });

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
  });
}

const covered = new Set();
for (const file of walk(join(root, "src"))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/req(?:<.+?>)?\(\s*"(GET|POST|PUT|PATCH|DELETE)",\s*"([^"]+)"/g)) covered.add(`${m[1]} ${m[2]}`);
  for (const m of src.matchAll(/setting\(\s*"[^"]+",\s*"(PUT|PATCH)",\s*"([a-z-]+)"/g)) {
    const p = `/indexes/{index_uid}/settings/${m[2]}`;
    ["GET", m[1], "DELETE"].forEach((verb) => covered.add(`${verb} ${p}`));
  }
  // The "All settings" entry in SettingsTab uses the parent route dynamically.
  if (/key === "\*" \? "\/indexes\/\{index_uid\}\/settings"/.test(src)) ["GET", "PATCH", "DELETE"].forEach((v) => covered.add(`${v} /indexes/{index_uid}/settings`));
}

const known = new Set(all.map((o) => o.id));
const unknown = [...covered].filter((c) => !known.has(c));
const missing = all.filter((o) => !covered.has(o.id));
const pct = (((all.length - missing.length) / all.length) * 100).toFixed(1);

console.log(`Meilisearch ${spec.info.version}: ${all.length} operations`);
console.log(`Dedicated UI: ${all.length - missing.length} (${pct}%) · Console only: ${missing.length} · Console reach: 100%\n`);
const byTag = {};
for (const o of missing) (byTag[o.tag] ??= []).push(o);
for (const [tag, list] of Object.entries(byTag).sort()) {
  console.log(`  ${tag}`);
  for (const o of list) console.log(`    ${o.id}${o.experimental ? "  (experimental)" : ""}`);
}
if (unknown.length) {
  console.log(`\n⚠ Calls to routes NOT in the spec (renamed/removed upstream?):`);
  unknown.forEach((u) => console.log(`    ${u}`));
}
if (process.argv.includes("--strict") && (missing.some((o) => !o.experimental) || unknown.length)) process.exit(1);
