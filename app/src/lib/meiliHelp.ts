// Parses `meilisearch --help` into a flag catalog, so the launch-config editor
// always matches the installed binary's version (no hand-maintained flag list).

export interface FlagDef {
  /** Long flag name without dashes, e.g. "max-indexing-memory". */
  name: string;
  /** Value placeholder, e.g. "MAX_INDEXING_MEMORY". Undefined for boolean switches. */
  value?: string;
  description: string;
  env?: string;
  default?: string;
  possible?: string[];
  experimental: boolean;
}

/** Flags MeiliOps sets itself for every managed instance. */
export const MANAGED_FLAGS = new Set(["db-path", "http-addr", "master-key", "env", "dump-dir", "snapshot-dir", "no-analytics", "config-file-path", "help", "version", "upgrade-db"]);

export function parseHelp(text: string): FlagDef[] {
  const flags: FlagDef[] = [];
  let cur: FlagDef | undefined;
  let desc: string[] = [];
  const flush = () => {
    if (!cur) return;
    cur.description = desc.join(" ").replace(/\s+/g, " ").trim();
    flags.push(cur);
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    // `<VALUE>` is required, `[<VALUE>]` optional (e.g. --schedule-snapshot).
    const opt = raw.match(/^\s{2,8}(?:-\w,\s+)?--([\w-]+)(?:\s+\[?<([^>]+)>\]?)?\s*$/);
    if (opt) {
      flush();
      cur = { name: opt[1], value: opt[2], description: "", experimental: opt[1].startsWith("experimental") };
      desc = [];
      continue;
    }
    if (!cur) continue;
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\[env: (\w+)=?[^\]]*\]$/))) cur.env = m[1];
    else if ((m = line.match(/^\[default: (.*)\]$/))) cur.default = m[1];
    else if ((m = line.match(/^\[possible values: (.*)\]$/))) cur.possible = m[1].split(",").map((s) => s.trim());
    else if (line) desc.push(line);
  }
  flush();
  return flags;
}
