// Per-field capabilities (searchable, filterable, ...). POST /indexes/{uid}/fields
// reports them from Meilisearch 1.36; older servers get them worked out from the settings.
import type { Meili } from "../api/meili";
import { supports } from "./compat";

export interface FieldCaps {
  name: string;
  searchable?: { enabled: boolean };
  sortable?: { enabled: boolean };
  displayed?: { enabled: boolean };
  filterable?: { enabled: boolean; facetSearch?: boolean; comparison?: boolean };
  distinct?: { enabled: boolean };
}

export interface FieldCapsLookup {
  get(path: string): FieldCaps | undefined;
}

type FilterableRule = string | { attributePatterns: string[]; features?: { facetSearch?: boolean; filter?: { equality?: boolean; comparison?: boolean } } };

interface CapSettings {
  searchableAttributes?: string[];
  displayedAttributes?: string[];
  sortableAttributes?: string[];
  filterableAttributes?: FilterableRule[];
  distinctAttribute?: string | null;
}

/** Meilisearch attribute patterns: `*` wildcards, and a field covers its nested fields. */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === "*" || path === pattern || path.startsWith(pattern + ".")) return true;
  if (!pattern.includes("*")) return false;
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(path);
}

export function capsFromSettings(s: CapSettings): FieldCapsLookup {
  const any = (list: string[] | undefined, path: string) => !!list?.some((p) => matchesPattern(p, path));
  return {
    get(path) {
      const rule = s.filterableAttributes?.find((r) => (typeof r === "string" ? matchesPattern(r, path) : r.attributePatterns.some((p) => matchesPattern(p, path))));
      const features = rule && typeof rule === "object" ? rule.features : undefined;
      return {
        name: path,
        searchable: { enabled: any(s.searchableAttributes, path) },
        displayed: { enabled: any(s.displayedAttributes, path) },
        sortable: { enabled: any(s.sortableAttributes, path) },
        // A plain string enables every filter feature; an object defaults to equality only.
        filterable:
          typeof rule === "string"
            ? { enabled: true, facetSearch: true, comparison: true }
            : { enabled: !!rule && features?.filter?.equality !== false, facetSearch: !!features?.facetSearch, comparison: !!features?.filter?.comparison },
        distinct: { enabled: s.distinctAttribute === path },
      };
    },
  };
}

/** Capabilities of every field of an index, from /fields when the server has it, else from its settings. */
export async function loadFieldCaps(m: Meili, uid: string): Promise<FieldCapsLookup> {
  if (!supports("POST /indexes/{index_uid}/fields")) return capsFromSettings(await m.req<CapSettings>("GET", "/indexes/{index_uid}/settings", { path: { index_uid: uid } }));
  const out = new Map<string, FieldCaps>();
  for (let offset = 0; ; offset += 1000) {
    const res = await m.req<{ results: FieldCaps[]; total: number }>("POST", "/indexes/{index_uid}/fields", { path: { index_uid: uid }, body: { offset, limit: 1000 } });
    for (const f of res.results) out.set(f.name, f);
    if (offset + res.results.length >= res.total || res.results.length === 0) break;
  }
  return out;
}
