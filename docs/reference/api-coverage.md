# API coverage

MeiliOps aims to cover **100% of Meilisearch's stable API** for the latest stable release. Coverage is measured, not estimated: `npm run coverage` scans the source for every API call and compares it with the operations in Meilisearch's published OpenAPI spec.

**Meilisearch 1.54.1: 143 operations. 140 have a dedicated screen (97.9%); all 143 are reachable from the API console.**

| Area (OpenAPI tag) | Operations | Where in MeiliOps |
|---|---|---|
| Settings | 69 | Index **Settings** tab (every sub-route, plus *All settings*) |
| Async task management | 10 | **Tasks**, **Batches**, Activity |
| Documents | 10 | **Documents** tab, *Edit with function* |
| Indexes | 9 | Sidebar, **Index info** tab (create, rename, primary key, swap, compact, delete) |
| Chats | 7 | **Chats** |
| Search rules | 5 | **Search rules** |
| Experimental features | 5 | **Experimental**; the 3 `/network` routes are console-only (see below) |
| Keys | 5 | **API keys** |
| Webhooks | 5 | **Webhooks** |
| Logs | 3 | **Logs** |
| Backups | 2 | **Overview** (dumps and snapshots) |
| Search, Similar documents, Facet search | 5 | **Search** tab |
| Stats | 2 | **Overview**, **Index info**, **Metrics** |
| Multi-search | 1 | **Multi-search** |
| Export | 1 | **Export** |
| Template | 1 | *Test template…* in Settings |
| MCP connection | 1 | **Overview** MCP card |
| Health, Version | 2 | Connection test, **Overview** |

## Not covered by a dedicated screen

`GET /network`, `PATCH /network` and `POST /network/control` configure sharding across a cluster, which is an **Enterprise Edition** feature. They're out of scope for a dedicated screen and available from the API console.

## Experimental routes

Experimental routes are covered on a best-effort basis. Some need a launch flag on the server, others a runtime toggle; MeiliOps tells you which when a route isn't enabled.

## Keeping it at 100%

CI runs `npm run coverage -- --strict` on every push. It fails when a new stable operation appears in the spec without a screen, so a new Meilisearch release can't silently reduce coverage. See [New Meilisearch versions](../development/meilisearch-updates).
