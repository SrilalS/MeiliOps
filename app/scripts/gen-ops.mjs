// Builds a compact operation catalog (src/api/operations.json) from the OpenAPI spec.
// The API console uses it so every Meilisearch operation is reachable from the UI.
import { readFileSync, writeFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../spec/meilisearch-openapi.json", import.meta.url), "utf8"));
const METHODS = ["get", "post", "put", "patch", "delete"];

function resolve(ref) {
  return ref.split("/").slice(1).reduce((o, k) => o[k], spec);
}

/** Build a small skeleton body from a JSON schema (top-level properties only). */
function skeleton(schema, depth = 0) {
  if (!schema || depth > 2) return null;
  if (schema.$ref) return skeleton(resolve(schema.$ref), depth);
  if (schema.example !== undefined) return schema.example;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => skeleton(s, depth) ?? {}));
  if (schema.oneOf || schema.anyOf) return skeleton((schema.oneOf ?? schema.anyOf)[0], depth);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const out = {};
    for (const [k, v] of Object.entries(schema.properties ?? {}).slice(0, 12)) {
      if ((schema.required ?? []).includes(k)) out[k] = skeleton(v, depth + 1);
    }
    return out;
  }
  if (type === "array") return [];
  if (type === "string") return schema.enum?.[0] ?? "";
  if (type === "integer" || type === "number") return schema.default ?? 0;
  if (type === "boolean") return schema.default ?? false;
  return null;
}

const ops = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
      .map((p) => (p.$ref ? resolve(p.$ref) : p))
      .map((p) => ({ name: p.name, in: p.in, required: !!p.required, description: (p.description ?? "").split("\n")[0].slice(0, 200), example: p.example ?? p.schema?.example }));
    const content = op.requestBody?.content ?? {};
    const json = content["application/json"];
    ops.push({
      method: m.toUpperCase(),
      path,
      tag: op.tags?.[0] ?? "Other",
      summary: op.summary ?? "",
      description: (op.description ?? "").slice(0, 600),
      params,
      body: op.requestBody ? { contentTypes: Object.keys(content), example: json ? (json.example ?? skeleton(json.schema)) : null } : null,
    });
  }
}
ops.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path));
writeFileSync(new URL("../src/api/operations.json", import.meta.url), JSON.stringify({ version: spec.info.version, ops }));
console.log(`operations.json: ${ops.length} operations for Meilisearch ${spec.info.version}`);
