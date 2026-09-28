// Minimal Server-Sent Events reader over fetch. EventSource can't send the
// Authorization header, so we parse the stream ourselves.

import { ApiPath, Meili, MeiliError } from "../api/meili";

export interface SseHandlers {
  onData: (data: string, event?: string) => void;
  onOpen?: () => void;
}

/**
 * Opens an SSE stream and resolves when it ends. Rejects with MeiliError on HTTP
 * errors (e.g. the route is disabled at launch) so callers can fall back to polling.
 */
export async function streamSse(
  m: Meili,
  method: "GET" | "POST",
  path: ApiPath,
  handlers: SseHandlers,
  opts: { path?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {},
) {
  const res = await fetch(m.resolve(path, { path: opts.path }), {
    method,
    headers: { ...m.headers(opts.body !== undefined ? "application/json" : undefined), Accept: "text/event-stream" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw new MeiliError(res.status, data?.code, data?.message ?? `HTTP ${res.status}`, data?.link, data);
  }
  handlers.onOpen?.();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
      if (data.length) handlers.onData(data.join("\n"), event);
    }
  }
}

/** Keep an SSE stream alive with reconnects. Returns a stop function. */
export function liveSse(open: (signal: AbortSignal) => Promise<void>, onFatal: (e: unknown) => void): () => void {
  const ctrl = new AbortController();
  (async () => {
    let backoff = 1000;
    while (!ctrl.signal.aborted) {
      try {
        await open(ctrl.signal);
        backoff = 1000;
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // 4xx = route disabled / no permission: stop and let the caller poll instead.
        if (e instanceof MeiliError && e.status >= 400 && e.status < 500) return onFatal(e);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15000);
      }
    }
  })();
  return () => ctrl.abort();
}
