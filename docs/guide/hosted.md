# Web hosting (Kubernetes)

MeiliOps can also run as a web app in a container, next to your Meilisearch servers. Your team opens it in a browser behind your single sign-on, and the Meilisearch API keys stay in the cluster.

```
Browser ──▶ SSO proxy (e.g. oauth2-proxy + Entra ID) ──▶ MeiliOps pod ──key added──▶ Meilisearch
             signs users in                              serves the app,
                                                         proxies the API
```

- **MeiliOps doesn't do the sign-in.** Put your SSO in front of its Service, for example an ingress with oauth2-proxy. Anyone who can reach the MeiliOps Service can use the configured keys, so allow traffic only from the SSO path (the manifest includes a NetworkPolicy).
- **The pod's keys stay in the pod.** It reads them from its environment (a Secret) and adds them to each request it forwards. The browser only sees server names.
- **API key management is off by default.** Meilisearch's `/keys` routes return keys in plain text, so a user who could open them could copy a key, use it without SSO and keep it after leaving. Turn them on with `MEILIOPS_ALLOW_KEY_MANAGEMENT=true` only if your users may manage keys anyway.
- **Every change is logged** with the signed-in user, read from the headers your SSO proxy sets.

## Configure

Each Meilisearch server is a group of environment variables. `<ID>` is any name in capitals, digits and `_`.

| Variable | |
|---|---|
| `MEILIOPS_SERVER_<ID>_URL` | Required. The in-cluster URL, e.g. `http://meilisearch.search.svc.cluster.local:7700` |
| `MEILIOPS_SERVER_<ID>_KEY` | The API key MeiliOps uses for that server. Take it from a Secret |
| `MEILIOPS_SERVER_<ID>_NAME` | Display name (default: the ID) |
| `MEILIOPS_SERVER_<ID>_COLOR` | Dot color, e.g. `#ef4444` |
| `MEILIOPS_SERVERS` | Optional comma-separated IDs, to set the order |
| `MEILIOPS_ALLOW_KEY_MANAGEMENT` | `true` to show the API keys screen and proxy the `/keys` routes. Default off |
| `MEILIOPS_USER_HEADERS` | Headers that carry the signed-in user. Default: `x-auth-request-email, x-forwarded-email, x-forwarded-user, x-ms-client-principal-name` |
| `PORT` | Default `8080` |

Everyone signed in uses the same key for a server. To limit what MeiliOps users can do, give it an [API key](./keys) scoped to the actions and indexes they need rather than the master key. Leave out the `keys.*` actions unless key management is on.

With one server configured, MeiliOps connects to it on load. With several, users pick one.

## Deploy

Build the image from `app/` and push it to your registry:

```bash
podman build -t registry.example.com/meiliops-web:0.4.1 -f Containerfile .
```

The image is about 80 MB: Alpine with Node.js and no other dependencies. It runs as a non-root user and works with a read-only root filesystem.

[`deploy/kubernetes/meiliops.yaml`](https://github.com/SrilalS/MeiliOps/blob/main/deploy/kubernetes/meiliops.yaml) is a starting point: a Secret for the keys, the Deployment and a Service. Edit the image, URLs and keys, then:

```bash
kubectl apply -f deploy/kubernetes/meiliops.yaml
```

Then route your SSO-protected ingress to the `meiliops` Service. With ingress-nginx and oauth2-proxy, that's the usual `nginx.ingress.kubernetes.io/auth-url` and `auth-signin` annotations, plus `auth-response-headers: X-Auth-Request-Email` so MeiliOps knows who is signed in. Check the NetworkPolicy's selector matches where your ingress controller runs.

MeiliOps can live under a sub-path (for example `https://tools.corp/meiliops/`) if the ingress strips the prefix before forwarding (with ingress-nginx, `rewrite-target`). The pod itself always serves from `/`.

## What's different from the desktop app

| | Desktop | Web |
|---|---|---|
| Connections | Added by each user | Set by the administrator in the environment |
| API keys screen | ✅ | Off unless `MEILIOPS_ALLOW_KEY_MANAGEMENT=true` |
| API keys | OS credential store | Kubernetes Secret, used only by the pod |
| Local instances, updates | ✅ | Not available |
| Live logs | ✅ | ✅ (the pod asks Meilisearch for an uncompressed stream) |
| MCP endpoint card | ✅ | Hidden: MCP clients can't sign in through the SSO proxy |
| Export to another server | URL and key | Pick a configured server; the pod fills in its URL and key |

## Security details

- API calls go to `/api/servers/<id>/...` on the MeiliOps pod, which forwards them only to the configured URL. Browsers can't use it to reach anything else.
- The pod drops cookies, the SSO headers and any `Authorization` header the browser sends, and adds the server's key itself.
- API calls must carry an `X-MeiliOps` header and come from the same site, so other websites can't make a signed-in user's browser call the API.
- Pages are served with a strict Content Security Policy and `X-Frame-Options: DENY`.
- The audit log is one JSON line per change on the pod's stdout: time, user, server, method, path with query string, status and duration. Refused requests (cross-site, key routes) and changes that couldn't reach Meilisearch are logged too.

## Try it locally with kind

[`deploy/kubernetes/kind-test.yaml`](https://github.com/SrilalS/MeiliOps/blob/main/deploy/kubernetes/kind-test.yaml) runs Meilisearch 1.58 and 1.18 with MeiliOps pointed at both:

```bash
podman build -t localhost/meiliops-web:dev -f Containerfile .
podman save -o meiliops-web.tar localhost/meiliops-web:dev
kind load image-archive meiliops-web.tar --name <cluster>
kubectl apply -f deploy/kubernetes/kind-test.yaml
kubectl -n meiliops-test port-forward svc/meiliops 8098:80
```

Open `http://localhost:8098`. There's no SSO in this setup, so the user shows as unknown. To see the audit log with a user, send a request with `X-Auth-Request-Email` set.
