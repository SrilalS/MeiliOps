// Thin, dependency-free Meilisearch HTTP client.
//
// Every call goes through `req(method, path)` where `path` is a literal from the
// generated OpenAPI types (src/api/schema.d.ts). That gives compile-time checking of
// route names AND lets scripts/coverage.mjs find every operation the app uses by
// scanning the source for `req("METHOD", "/path"`.

import type { paths } from "./schema";

export type ApiPath = keyof paths & string;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ReqOpts {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
  contentType?: string;
  signal?: AbortSignal;
  /** Return the raw Response (for streams / non-JSON payloads). */
  raw?: boolean;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Alternative fetch implementation (e.g. Tauri's native HTTP client). */
  fetch?: typeof fetch;
}

export class MeiliError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public link?: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** The server could not be reached at all (refused, DNS, offline). No HTTP response. */
export class NetworkError extends Error {
  constructor(
    public url: string,
    public cause?: unknown,
  ) {
    super(`Can't reach ${url}. Is Meilisearch running there?`);
    this.name = "NetworkError";
  }
}

export const isNetworkError = (e: unknown): e is NetworkError => e instanceof NetworkError;

const isAbort = (e: unknown) => e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");

export interface EnqueuedTask {
  taskUid: number;
  indexUid: string | null;
  status: string;
  type: string;
  enqueuedAt: string;
}

export interface Task {
  uid: number;
  batchUid?: number | null;
  indexUid: string | null;
  status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  type: string;
  canceledBy?: number | null;
  details?: Record<string, unknown>;
  error?: { message: string; code: string; type: string; link: string } | null;
  duration?: string | null;
  enqueuedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  customMetadata?: string | null;
}

export const FINAL_STATUSES = ["succeeded", "failed", "canceled"];

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class Meili {
  readonly url: string;
  /** Connection-health hooks: the app uses them to detect a server going away and coming back. */
  onUnreachable?: (e: NetworkError) => void;
  onReachable?: () => void;

  constructor(url: string, private key?: string) {
    this.url = url.trim().replace(/\/+$/, "");
  }

  get hasKey() {
    return !!this.key;
  }

  resolve(path: string, opts: ReqOpts = {}): string {
    let p = path;
    for (const [k, v] of Object.entries(opts.path ?? {})) {
      p = p.replace(`{${k}}`, encodeURIComponent(String(v)));
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    const q = qs.toString();
    return this.url + p + (q ? `?${q}` : "");
  }

  headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.key) h.Authorization = `Bearer ${this.key}`;
    if (contentType) h["Content-Type"] = contentType;
    return h;
  }

  async req<T = any>(method: HttpMethod, path: ApiPath, opts: ReqOpts = {}): Promise<T> {
    let body: BodyInit | undefined;
    let contentType: string | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === "string" || opts.body instanceof Blob) {
        body = opts.body as BodyInit;
        contentType = opts.contentType ?? "application/json";
      } else {
        body = JSON.stringify(opts.body);
        contentType = "application/json";
      }
    }
    const res = await this.fetch(this.resolve(path, opts), {
      method,
      headers: { ...this.headers(contentType), ...opts.headers },
      body,
      signal: opts.signal,
    }, opts.fetch);
    if (opts.raw) {
      if (!res.ok) throw await toError(res);
      return res as unknown as T;
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      throw new MeiliError(
        res.status,
        data?.code,
        data?.message ?? `HTTP ${res.status} ${res.statusText}`,
        data?.link,
        data,
      );
    }
    return data as T;
  }

  /** fetch() that reports reachability and turns connection failures into NetworkError. */
  async fetch(url: string, init: RequestInit, impl: typeof fetch = fetch): Promise<Response> {
    let res: Response;
    try {
      res = await impl(url, init);
    } catch (e) {
      if (isAbort(e) || init.signal?.aborted) throw e;
      const err = new NetworkError(this.url, e);
      this.onUnreachable?.(err);
      throw err;
    }
    this.onReachable?.();
    return res;
  }

  /** Poll a task until it reaches a final status. */
  async waitForTask(taskUid: number, { timeoutMs = 10 * 60_000, intervalMs = 250, signal }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {}): Promise<Task> {
    const start = Date.now();
    let delay = intervalMs;
    for (;;) {
      const task = await this.req<Task>("GET", "/tasks/{task_id}", { path: { task_id: taskUid }, signal });
      if (FINAL_STATUSES.includes(task.status)) return task;
      if (Date.now() - start > timeoutMs) throw new Error(`Task ${taskUid} timed out`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 2000);
    }
  }
}

async function toError(res: Response): Promise<MeiliError> {
  const text = await res.text().catch(() => "");
  const data = text ? safeJson(text) : null;
  return new MeiliError(res.status, data?.code, data?.message ?? `HTTP ${res.status}`, data?.link, data);
}

export function errorMessage(e: unknown): string {
  if (e instanceof MeiliError) return e.code ? `${e.message} (${e.code})` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
