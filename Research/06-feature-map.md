# 06 — Feature Map (API → Screens) & Release Slicing

> **TL;DR:** 10 screen areas cover the whole API. Proposed slicing: **MVP = daily admin loop** (connect → browse → search → settings → tasks → keys). Ops, AI and cluster features follow.

---

## 🗺️ Screen areas

| # | Area | Covers (API) | Slice |
|---|---|---|---|
| 1 | 🔌 **Connections** | health, version, capability probe | MVP |
| 2 | 📂 **Index explorer** | indexes CRUD, rename, swap, stats, fields, compact | MVP |
| 3 | 📄 **Documents** | list/fetch/get, add/replace/update, delete (id/filter/batch/all), import CSV/JSON/NDJSON | MVP |
| 4 | 🔍 **Search playground** | search, facets, facet-search, hybrid/vector, geo, ranking-score details, performance details, similar | MVP |
| 5 | ⚙️ **Settings editor** | all ~25 settings, diff preview, reindex warning, copy settings between indexes | MVP |
| 6 | ⏳ **Tasks & batches** | list/filter, SSE stream, cancel, delete, payload, progress trace, compact | MVP |
| 7 | 🔑 **Security** | keys CRUD with an action picker, tenant-token generator | MVP |
| 8 | 🛠️ **Operations** | dumps, snapshots, export, webhooks, metrics dashboard, log stream, experimental flags | v1.1 |
| 9 | 🤖 **AI** | embedders config, render-template tester, chat workspaces + chat playground, multi-search/federation builder, MCP info | v1.2 |
| 10 | 🎯 **Curation & cluster** | Dynamic Search Rules editor, foreign keys, network/sharding topology view | v1.3 (volatile APIs) |

---

## 🧭 Release slicing

```mermaid
flowchart LR
  S[Spike + ADR-001<br/>framework] --> M[MVP<br/>areas 1–7]
  M --> O[v1.1 Ops<br/>area 8]
  O --> A[v1.2 AI<br/>area 9]
  A --> C[v1.3 Curation & Cluster<br/>area 10]
  C --> X[100% coverage ✅<br/>CI-enforced from here on]
```

The coverage gate becomes **blocking** once v1.3 ships. Before that it is a report.
