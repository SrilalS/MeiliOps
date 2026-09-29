// Schema analysis over a document sample (Compass-style). Nested objects are flattened to
// dot paths the way Meilisearch addresses them (`author.name`); objects inside arrays share
// the path of the array (`tags.label`), which is also how filters see them.

export type ValueType = "string" | "number" | "boolean" | "null" | "array" | "object";

export interface FieldStats {
  path: string;
  depth: number;
  /** Documents in the sample that contain the field at least once. */
  present: number;
  types: Partial<Record<ValueType, number>>;
  /** Top scalar values (strings, numbers, booleans), for fields with few distinct values. */
  values: Map<string, number>;
  /** True once `values` hit the cap: the distinct count is at least `MAX_DISTINCT`. */
  valuesCapped: boolean;
  /** Free text (some value longer than `MAX_VALUE_LEN`): values aren't counted. */
  isText: boolean;
  min?: number;
  max?: number;
  minLen?: number;
  maxLen?: number;
  /** Longest array seen. */
  maxItems?: number;
}

export interface SchemaResult {
  sampled: number;
  fields: FieldStats[];
}

const MAX_DISTINCT = 1000;
/** Strings longer than this are text, not categories: don't count their values. */
const MAX_VALUE_LEN = 120;
/** Don't descend into these; they are huge and not user schema. */
const SKIP = new Set(["_vectors"]);

export function typeOf(v: unknown): ValueType {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" ? t : "object";
}

export class SchemaAnalyzer {
  private fields = new Map<string, FieldStats>();
  private sampled = 0;
  private seen = new Set<string>();

  add(docs: Record<string, unknown>[]) {
    for (const d of docs) {
      this.seen.clear();
      this.walk(d, "", 0);
      for (const p of this.seen) this.fields.get(p)!.present++;
      this.sampled++;
    }
  }

  result(): SchemaResult {
    // Parents before children, then alphabetical.
    const fields = [...this.fields.values()].sort((a, b) => a.path.localeCompare(b.path));
    return { sampled: this.sampled, fields };
  }

  private field(path: string, depth: number) {
    let f = this.fields.get(path);
    if (!f) this.fields.set(path, (f = { path, depth, present: 0, types: {}, values: new Map(), valuesCapped: false, isText: false }));
    return f;
  }

  private walk(obj: Record<string, unknown>, prefix: string, depth: number) {
    for (const [k, v] of Object.entries(obj)) {
      if (depth === 0 && SKIP.has(k)) continue;
      this.value(prefix + k, depth, v, true);
    }
  }

  private value(path: string, depth: number, v: unknown, countType: boolean) {
    const f = this.field(path, depth);
    this.seen.add(path);
    const t = typeOf(v);
    if (countType) f.types[t] = (f.types[t] ?? 0) + 1;
    switch (t) {
      case "array": {
        const arr = v as unknown[];
        f.maxItems = Math.max(f.maxItems ?? 0, arr.length);
        // Elements are tallied as values of the same path, but not as extra types.
        for (const el of arr) {
          const et = typeOf(el);
          if (et === "object") this.walk(el as Record<string, unknown>, path + ".", depth + 1);
          else if (et !== "array") this.scalar(f, el, et);
        }
        break;
      }
      case "object":
        this.walk(v as Record<string, unknown>, path + ".", depth + 1);
        break;
      default:
        this.scalar(f, v, t);
    }
  }

  private scalar(f: FieldStats, v: unknown, t: ValueType) {
    if (t === "number") {
      const n = v as number;
      f.min = f.min === undefined ? n : Math.min(f.min, n);
      f.max = f.max === undefined ? n : Math.max(f.max, n);
    } else if (t === "string") {
      const len = (v as string).length;
      f.minLen = f.minLen === undefined ? len : Math.min(f.minLen, len);
      f.maxLen = f.maxLen === undefined ? len : Math.max(f.maxLen, len);
      if (len > MAX_VALUE_LEN) {
        f.isText = true;
        f.values.clear();
      }
      if (f.isText) return;
    } else if (t !== "boolean") return;
    const key = String(v);
    const n = f.values.get(key);
    if (n !== undefined) f.values.set(key, n + 1);
    else if (f.values.size < MAX_DISTINCT) f.values.set(key, 1);
    else f.valuesCapped = true;
  }
}

/** Most common values, highest first. */
export function topValues(f: FieldStats, n = 10): [string, number][] {
  return [...f.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** (Nearly) every sampled value is different (IDs, URLs, titles): value counts say nothing. */
export function isUnique(f: FieldStats): boolean {
  if (f.valuesCapped) return true;
  let total = 0;
  for (const n of f.values.values()) total += n;
  return f.values.size > 20 && f.values.size >= total * 0.9;
}

/** A field is a good filter/facet candidate when it has few distinct, short values. */
export function looksCategorical(f: FieldStats): boolean {
  if (f.isText || f.valuesCapped || f.values.size === 0) return false;
  const strings = f.types.string ?? 0;
  const arrays = f.types.array ?? 0;
  if (f.types.boolean) return true;
  return (strings > 0 || arrays > 0) && f.values.size <= 200 && (f.maxLen ?? 0) <= MAX_VALUE_LEN;
}

/** Filter expression that matches one value of a field. */
export function filterFor(path: string, value: string, type: ValueType | undefined): string {
  const field = /^[A-Za-z0-9_.]+$/.test(path) ? path : JSON.stringify(path);
  if (type === "number" || type === "boolean") return `${field} = ${value}`;
  return `${field} = ${JSON.stringify(value)}`;
}
