# Web hosting (Kubernetes)

MeiliOps can also run as a web app in a container, next to your Meilisearch servers. Your team opens it in a browser, signs in with your organization's account (for example Microsoft Entra ID), and the Meilisearch API keys stay in the cluster.

```
Browser ──▶ Gateway / ingress ──/meiliops──▶ MeiliOps pod ──key added──▶ Meilisearch
   ▲                                            │
   └────────── sign-in (OpenID Connect) ────────┘
               Entra ID or another provider
```

- **MeiliOps signs users in itself**, with OpenID Connect, the same way Temporal UI does with its `TEMPORAL_AUTH_*` settings. You register an app with your identity provider and give MeiliOps its client ID and secret.
- **The pod's keys stay in the pod.** It reads them from its environment (a Secret) and adds them to each request it forwards. The browser only sees server names.
- **API key management is off by default.** Meilisearch's `/keys` routes return keys in plain text, so a user who could open them could copy a key, use it without MeiliOps and keep it after losing access. Turn them on with `MEILIOPS_ALLOW_KEY_MANAGEMENT=true` only if your users may manage keys anyway.
- **Every change is logged** with the signed-in user, and with `MEILIOPS_AUDIT=all` every search and document read too.

If your cluster already puts an SSO proxy such as oauth2-proxy in front of apps, you can leave MeiliOps' own sign-in off instead: it then trusts the user headers that proxy sets (see [Behind an SSO proxy](#behind-an-sso-proxy)).

## Configure

### Meilisearch servers

Each server is a group of environment variables. `<ID>` is any name in capitals, digits and `_`.

| Variable | |
|---|---|
| `MEILIOPS_SERVER_<ID>_URL` | Required. The in-cluster URL, e.g. `http://meilisearch.search.svc.cluster.local:7700` |
| `MEILIOPS_SERVER_<ID>_KEY` | The API key MeiliOps uses for that server. Take it from a Secret |
| `MEILIOPS_SERVER_<ID>_NAME` | Display name (default: the ID) |
| `MEILIOPS_SERVER_<ID>_COLOR` | Dot color, e.g. `#ef4444` |
| `MEILIOPS_SERVERS` | Optional comma-separated IDs, to set the order |

Everyone signed in uses the same key for a server. To limit what MeiliOps users can do, give it an [API key](./keys) scoped to the actions and indexes they need rather than the master key. Leave out the `keys.*` actions unless key management is on.

With one server configured, MeiliOps connects to it on load. With several (for example one per shard), users pick one.

### Sign-in

| Variable | |
|---|---|
| `MEILIOPS_AUTH_ENABLED` | `true` to require sign-in |
| `MEILIOPS_AUTH_ISSUER_URL` | The provider's issuer. Entra ID: `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `MEILIOPS_AUTH_PROVIDER_URL` | Where to read `.well-known/openid-configuration`, if not the issuer |
| `MEILIOPS_AUTH_CLIENT_ID` | The app registration's client ID |
| `MEILIOPS_AUTH_CLIENT_SECRET` | Its client secret. Take it from a Secret |
| `MEILIOPS_AUTH_CALLBACK_URL` | `https://<host><public path>/auth/callback`, registered as a redirect URI on the app |
| `MEILIOPS_AUTH_SCOPES` | Default `openid,profile,email` |
| `MEILIOPS_AUTH_ALLOWED_GROUPS` | Comma-separated group object IDs or app role values. Only their members can sign in |
| `MEILIOPS_SESSION_SECRET` | 32+ random characters, the same on every replica. Changing it signs everyone out |
| `MEILIOPS_SESSION_HOURS` | Session length. Default `8` |

MeiliOps uses the authorization-code flow with PKCE, checks the ID token's signature against the provider's published keys, its issuer, audience, expiry and nonce, and then keeps a signed session cookie. It doesn't keep access or refresh tokens: it only needs to know who you are. When a session ends, the next action takes you through sign-in and back.

#### Microsoft Entra ID

1. **App registrations → New registration**, single tenant. Add a **Web** redirect URI: your `MEILIOPS_AUTH_CALLBACK_URL`.
2. **Certificates & secrets → New client secret.** Store it where your cluster's secrets come from (e.g. Key Vault through the Secrets Store CSI driver).
3. **Token configuration → Add groups claim**, and pick **Groups assigned to the application**. Users in many groups otherwise get no groups in the token (MeiliOps then explains this when refusing them).
4. **Enterprise applications → (the app) → Properties → Assignment required: Yes**, and assign the admin group. Put the same group's object ID in `MEILIOPS_AUTH_ALLOWED_GROUPS`.

### Other settings

| Variable | |
|---|---|
| `MEILIOPS_PUBLIC_PATH` | Serve under this path, e.g. `/meiliops`. The route forwards it as-is (no rewrite) |
| `MEILIOPS_AUDIT` | `writes` (default), or `all` to also log every search and document read. Monitoring polls (tasks, stats, settings) are never logged, to keep log volume down |
| `MEILIOPS_ALLOW_KEY_MANAGEMENT` | `true` to show the API keys screen and proxy the `/keys` routes. Default off |
| `MEILIOPS_USER_HEADERS` | With sign-in off: headers that carry the user. Default: `x-auth-request-email, x-forwarded-email, x-forwarded-user, x-ms-client-principal-name` |
| `PORT` | Default `8080` |

## Deploy

Every release from v0.5.1 publishes the image for amd64 and arm64:

```bash
podman pull ghcr.io/srilals/meiliops-web:0.5.1
```

Pin a version rather than `latest`, and mirror it to your own registry if your cluster only pulls from there. To build it yourself instead, from `app/`:

```bash
podman build -t meiliops-web -f Containerfile .
```

The image is about 80 MB: Alpine with Node.js and no other dependencies. It runs as a non-root user and works with a read-only root filesystem. `/healthz` answers without sign-in, at the root and under the public path, for probes.

[`deploy/kubernetes/meiliops.yaml`](https://github.com/SrilalS/MeiliOps/blob/main/deploy/kubernetes/meiliops.yaml) is a starting point: the Secret, Deployment, Service, a Gateway API `HTTPRoute` for `/meiliops`, and a NetworkPolicy. Replace the `REPLACE_*` values, then:

```bash
kubectl apply -f deploy/kubernetes/meiliops.yaml
```

Network access it needs:

| Direction | To / from | Why |
|---|---|---|
| In | Your Gateway or ingress controller pods, port 8080 | Users |
| Out | Meilisearch, port 7700 | The API |
| Out | The identity provider, HTTPS | Sign-in: discovery, token and signing keys |
| Out | DNS | |

If Meilisearch has its own NetworkPolicy, it must admit the MeiliOps pod too.

## Behind an SSO proxy

Leave `MEILIOPS_AUTH_ENABLED` unset and route your SSO-protected ingress (for example ingress-nginx with oauth2-proxy and `auth-response-headers: X-Auth-Request-Email`) to the Service. MeiliOps then takes the user from those headers for the audit log. They're only trustworthy if nothing but the proxy can reach the pod, so keep the NetworkPolicy.

## What's different from the desktop app

| | Desktop | Web |
|---|---|---|
| Connections | Added by each user | Set by the administrator in the environment |
| API keys screen | ✅ | Off unless `MEILIOPS_ALLOW_KEY_MANAGEMENT=true` |
| API keys | OS credential store | Kubernetes Secret, used only by the pod |
| Local instances, updates | ✅ | Not available |
| Live logs | ✅ | ✅ (the pod asks Meilisearch for an uncompressed stream) |
| MCP endpoint card | ✅ | Hidden: MCP clients can't sign in to MeiliOps |
| Export to another server | URL and key | Pick a configured server; the pod fills in its URL and key |

## Security details

- API calls go to `/api/servers/<id>/...` on the MeiliOps pod, which forwards them only to the configured URL. Browsers can't use it to reach anything else.
- The pod drops cookies, proxy headers and any `Authorization` header the browser sends, and adds the server's key itself.
- API calls must carry an `X-MeiliOps` header and come from the same site, and the session cookie is `HttpOnly` and `SameSite=Lax`, so other websites can't make a signed-in user's browser call the API.
- After sign-in MeiliOps only redirects to its own pages, so the sign-in link can't be used to send people elsewhere.
- Pages are served with a strict Content Security Policy and `X-Frame-Options: DENY`.
- The audit log is one JSON line per event on the pod's stdout: sign-ins and refused sign-ins (with the reason), sign-outs, and requests with time, user, server, `kind` (`read` or `write`), method, path with query string, status and duration. Refused requests and requests that couldn't reach Meilisearch are logged too.

## Try it locally

### kind

[`deploy/kubernetes/kind-test.yaml`](https://github.com/SrilalS/MeiliOps/blob/main/deploy/kubernetes/kind-test.yaml) runs Meilisearch 1.58 and 1.18 with MeiliOps pointed at both, under `/meiliops`, with sign-in off:

```bash
podman build -t localhost/meiliops-web:dev -f Containerfile .
podman save -o meiliops-web.tar localhost/meiliops-web:dev
kind load image-archive meiliops-web.tar --name <cluster>
kubectl apply -f deploy/kubernetes/kind-test.yaml
kubectl -n meiliops-test port-forward svc/meiliops 8098:8080
```

Open `http://localhost:8098/meiliops/`.

### Sign-in, with a mock provider

`app/scripts/mock-oidc.mjs` is a test-only OpenID Connect provider with users that sign in fine, aren't in the allowed group, or produce forged, expired or mismatched tokens. `app/scripts/test-hosted-auth.mjs` runs the whole flow against it. With a Meilisearch on `http://127.0.0.1:7700`:

```bash
npm run build:web
node scripts/mock-oidc.mjs &
PORT=8090 MEILIOPS_PUBLIC_PATH=/meiliops \
MEILIOPS_SERVER_LOCAL_URL=http://127.0.0.1:7700 MEILIOPS_SERVER_LOCAL_KEY=<key> \
MEILIOPS_AUTH_ENABLED=true MEILIOPS_AUTH_ISSUER_URL=http://localhost:9099/tenant-1/v2.0 \
MEILIOPS_AUTH_CLIENT_ID=meiliops-client MEILIOPS_AUTH_CLIENT_SECRET=meiliops-secret \
MEILIOPS_AUTH_CALLBACK_URL=http://localhost:8090/meiliops/auth/callback \
MEILIOPS_AUTH_ALLOWED_GROUPS=g-admins MEILIOPS_SESSION_SECRET=local-test-session-secret-0123456789 \
node dist-server/main.js &
node scripts/test-hosted-auth.mjs
```

Or open `http://localhost:8090/meiliops/` and pick a test user.
