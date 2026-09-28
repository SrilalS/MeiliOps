// Meilisearch tenant tokens are HS256 JWTs signed with a parent API key.
// Signing happens locally with WebCrypto — no server route involved.

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const enc = new TextEncoder();

export async function signTenantToken(apiKey: string, apiKeyUid: string, searchRules: unknown, expiresAt?: Date): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const payload: Record<string, unknown> = { searchRules, apiKeyUid };
  if (expiresAt) payload.exp = Math.floor(expiresAt.getTime() / 1000);
  const data = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(apiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}
