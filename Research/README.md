# Research — Index & Summary

> Research date: **2026-09-28** · Meilisearch latest: **v1.54** · Status: 🟡 awaiting review

## 🎯 Headline findings

1. ✅ **The gap is real.** Every existing Meilisearch admin tool is a web app. No native desktop client exists, and none covers the full API. → `02`
2. 🏃 **Meilisearch is a fast-moving target:** weekly releases, 180+ operations, and experimental APIs that break between minors. → `01`
3. 🧬 **"100% coverage" can be made measurable.** Every release ships an official `meilisearch-openapi.json`, so we can generate the client and **CI-diff the spec for each release**. → `01`, `05`
4. 🦀 **Framework shortlist:** GPUI (Rust) 🥇, Avalonia 12 (C#) 🥈, Tauri 2 🥉 as a baseline. The pick depends on team language plus a benchmark spike. → `03`, `04`
5. 🏷️ **"Compatibility" = a capability registry:** version × edition × experimental flags × key permissions drive what the UI shows. → `05`

## 📚 Documents

| # | File | What's inside |
|---|---|---|
| 01 | [meilisearch-api-surface](01-meilisearch-api-surface.md) | Full route inventory, key actions, breaking-change history, OpenAPI strategy |
| 02 | [existing-tools-landscape](02-existing-tools-landscape.md) | Competitors, reference apps, features to steal |
| 03 | [desktop-framework-evaluation](03-desktop-framework-evaluation.md) | 12 frameworks scored, shortlist, decision flow |
| 04 | [performance-and-memory](04-performance-and-memory.md) | Budgets, measurement gotchas, spike plan |
| 05 | [architecture-options](05-architecture-options.md) | Headless core, capability registry, client codegen |
| 06 | [feature-map](06-feature-map.md) | API → screens, release slicing |

## ▶️ Next steps (AI-DLC)

1. ❓ Answer `aidlc-docs/inception/requirements/requirements-questions.md` (8 questions)
2. 🔵 Requirements Analysis → User Stories → Application Design
3. 🧪 Run the framework spike → **ADR-001**
