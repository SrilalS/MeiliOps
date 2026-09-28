# 02 — Existing Tools Landscape

> **TL;DR:** Every existing Meilisearch admin tool is a **web app**. There is **no native desktop client**, and none claims full API coverage. The gap is real.

---

## 🔎 What exists today

| Tool | Type | Stack | Strengths | Gaps |
|---|---|---|---|---|
| 🌐 **Meilisearch mini-dashboard** | Web, bundled at `:7700` | React | Zero install | Search preview only. No settings, keys or tasks |
| ☁️ **Meilisearch Cloud UI** | Web, SaaS | Proprietary | Most complete official UI | Cloud instances only; not for self-hosted |
| 🌐 **meilisearch-ui** (riccox / eyeix forks) | Web / Docker | React + Tailwind | Multi-instance; settings, docs, keys | Browser-bound; stores keys in browser storage; lags new APIs |
| 🌐 **meilisearch-manager** (connorabbas) | Web | Laravel/Vue | Proxy mode hides the master key | Server to deploy; partial coverage |
| 🌐 **MeiliAdmin** (90pixel) | Web | Vue | Early mover | No auth, stale. ⚠️ **Name collision with this project** |

Sources: [meilisearch-ui](https://github.com/eyeix/meilisearch-ui), [meilisearch-manager](https://github.com/connorabbas/meilisearch-manager), [90pixel/MeiliAdmin](https://github.com/90pixel/MeiliAdmin)

---

## 🏆 Reference apps we are emulating

| App | Stack | Lesson for us |
|---|---|---|
| 🍃 **MongoDB Compass** | Electron | Excellent UX (schema analysis, visual query builder, explain plans), but **heavy**: 300–600 MB RAM is common. That's our anti-goal |
| 🐘 **pgAdmin 4** | Python server + web UI (desktop = embedded browser) | Complete but sluggish. "Desktop" is really a local web server |
| 🦫 **DBeaver** | Java/Eclipse SWT | Proof that a generic data grid plus editors scales. JVM memory cost |
| ⚡ **TablePlus** | Native (Swift/AppKit, C++ on Windows) | **Our north star:** native, instant start, low memory, polished |
| 🔵 **Zed** | Rust + GPUI | Proof that a GPU-rendered Rust UI can be very fast |

---

## 🧩 Feature ideas worth stealing

1. 🧪 **Explain-like view:** render `_rankingScoreDetails` and `showPerformanceDetails` as a visual breakdown (Compass "explain plan" equivalent)
2. 📊 **Schema/field analysis:** sample documents plus `/fields` to show field types, fill rate and facet distribution (Compass "Schema" tab)
3. 🧱 **Visual filter builder** ⇄ raw filter-expression editor, round-trippable
4. 🔁 **Settings diff before apply,** plus a warning when a change triggers a full reindex
5. 📜 **Query history and saved queries** per connection
6. 🪟 **Side-by-side instance compare:** diff settings between two indexes or instances (e.g. staging vs prod)
