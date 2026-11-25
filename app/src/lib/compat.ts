// Meilisearch version compatibility. MeiliOps supports MIN_VERSION and newer;
// operations added after it are gated on the connected server's version.
// The table is generated from each release's OpenAPI spec (scripts/gen-since.mjs).
import since from "../api/since.json";
import { server } from "../state/app";

/** An operation that not every supported Meilisearch version serves. */
export type GatedOp = keyof typeof since.ops;

export const MIN_VERSION = since.min;

function parse(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** `v >= required`. Unparseable versions count as new enough. */
export function atLeast(v: string, required: string): boolean {
  const a = parse(v);
  const b = parse(required);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** "1.41.0" → "1.41" */
export const shortVersion = (v: string) => v.replace(/^(\d+\.\d+)\.0$/, "$1");

/** The connected server's version, e.g. "1.58.0". */
export const serverVersion = () => server().version?.pkgVersion;

/** The version the connected server needs for `op`, or undefined when it serves it (or its version is unknown). */
export function missing(op: GatedOp): string | undefined {
  const v = serverVersion();
  const required = since.ops[op];
  return v && !atLeast(v, required) ? required : undefined;
}

export const supports = (op: GatedOp) => !missing(op);

/** Like `missing`, for a settings sub-route (each one's GET, update and DELETE ship together). */
export function settingMissing(slug: string): string | undefined {
  const op = `GET /indexes/{index_uid}/settings/${slug}`;
  return op in since.ops ? missing(op as GatedOp) : undefined;
}

/** Tooltip for a control the server is too old for, or undefined when it's available. */
export function needs(op: GatedOp): string | undefined {
  const r = missing(op);
  return r ? `Requires Meilisearch ${shortVersion(r)} or newer. This server runs ${serverVersion()}.` : undefined;
}

/** The connected server is older than MeiliOps supports. */
export const belowMinimum = () => {
  const v = serverVersion();
  return !!v && !atLeast(v, MIN_VERSION);
};
