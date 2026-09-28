// Platform bridge. Inside Tauri we use the OS keychain + the store plugin.
// In a plain browser (`npm run dev`, used for fast UI iteration) we fall back to
// localStorage — clearly insecure, so it's only for local development.

import { invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

let storePromise: Promise<StoreLike> | undefined;

function store(): Promise<StoreLike> {
  storePromise ??= (async () => {
    if (isTauri) {
      const { load } = await import("@tauri-apps/plugin-store");
      return (await load("meiliops.json", { autoSave: 200, defaults: {} })) as StoreLike;
    }
    return {
      async get<T>(key: string) {
        const raw = localStorage.getItem(`meiliops:${key}`);
        return raw ? (JSON.parse(raw) as T) : undefined;
      },
      async set(key: string, value: unknown) {
        localStorage.setItem(`meiliops:${key}`, JSON.stringify(value));
      },
    };
  })();
  return storePromise;
}

export async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  return (await (await store()).get<T>(key)) ?? fallback;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await (await store()).set(key, value);
}

export const secrets = {
  async get(account: string): Promise<string | undefined> {
    if (isTauri) return (await invoke<string | null>("secret_get", { account })) ?? undefined;
    return localStorage.getItem(`meiliops:dev-insecure-secret:${account}`) ?? undefined;
  },
  async set(account: string, secret: string): Promise<void> {
    if (isTauri) return invoke("secret_set", { account, secret });
    localStorage.setItem(`meiliops:dev-insecure-secret:${account}`, secret);
  },
  async delete(account: string): Promise<void> {
    if (isTauri) return invoke("secret_delete", { account });
    localStorage.removeItem(`meiliops:dev-insecure-secret:${account}`);
  },
};

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

/** Save text as a file via a download link (works in WebView2 and browsers). */
export function downloadText(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
