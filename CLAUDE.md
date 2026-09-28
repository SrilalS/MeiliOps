# MeiliAdmin — Project Memory

Native desktop admin app for **Meilisearch**, in the spirit of MongoDB Compass / pgAdmin.

## 🎯 Product goals (non-negotiable)

1. **100% Meilisearch feature coverage.** Every stable API route plus the experimental ones, gated by the connected server's version.
2. **Native desktop app. No Electron.** It must perform well and stay memory efficient. Budgets are in `Research/04-performance-and-memory.md`.
3. **Cross-platform:** Windows, macOS and Linux. **Windows 11 is the only priority for now.**

## 🗺️ Repository map

| Path | Purpose |
|---|---|
| `CLAUDE.md` | This file: project memory and AI-DLC workflow rules |
| `aidlc-docs/aidlc-state.md` | **Source of truth for the current phase and stage.** Read it first every session |
| `aidlc-docs/audit.md` | Append-only log of user decisions and approvals |
| `aidlc-docs/inception/` | Requirements, user stories, application design, units |
| `aidlc-docs/construction/` | Per-unit functional design, NFR design, code plans, test results |
| `aidlc-docs/operations/` | Packaging, release and distribution |
| `Research/` | Research notes (Markdown + Mermaid diagrams). Input to Inception |

---

# AI-DLC Workflow (AI-Driven Development Life Cycle)

This project follows **AI-DLC** (awslabs/aidlc-workflows). The phases are gated: **AI proposes, human approves, then AI executes.** Never skip ahead to code.

## Phases and stages

```
🔵 INCEPTION ─────────────────────────────────────────────
   1. Workspace Detection        (always)
   2. Reverse Engineering        (brownfield only; skip, this is greenfield)
   3. Requirements Analysis      (always, depth adapts)
   4. User Stories               (conditional)
   5. Workflow Planning          (always)
   6. Application Design         (conditional)
   7. Units Generation           (conditional)
🟢 CONSTRUCTION  (repeat per unit) ───────────────────────
   8.  Functional Design         (conditional)
   9.  NFR Requirements          (conditional)
   10. NFR Design                (conditional)
   11. Infrastructure Design     (conditional)
   12. Code Generation           (always: plan first, then generate)
   13. Build & Test              (always)
🟠 OPERATIONS ────────────────────────────────────────────
   14. Packaging / Release / Distribution (placeholder)
```

## Rules

1. **Start of every session:** read `aidlc-docs/aidlc-state.md` and resume from the recorded stage.
2. **Questions go in files.** For each stage, write clarifying questions to `aidlc-docs/<phase>/<stage>-questions.md` using `[Answer]:` tags. Wait for the answers. Never assume on ambiguous product decisions.
3. **Plan before executing.** Each stage produces a plan with `- [ ]` checkboxes. Get explicit approval, then tick boxes **as work completes**, not in bulk at the end.
4. **Approval gate at the end of every stage.** Summarize what was produced and ask: *"Approve and continue to <next stage>, or request changes?"*
5. **Audit everything.** Append each user decision or approval to `aidlc-docs/audit.md` with an ISO timestamp and the user's words, verbatim.
6. **Update state.** Update `aidlc-docs/aidlc-state.md` after every stage transition.
7. **Artifacts stay out of code.** Design docs live in `aidlc-docs/`. Application code lives in the source tree (location decided in Application Design), never in `aidlc-docs/`.
8. **Adaptive depth.** Skip conditional stages only with a stated reason, and record the skip in the state file.

---

## 🧭 Engineering principles (apply once construction starts)

- 📐 **Measure, don't guess.** Every performance or memory claim needs a benchmark in the repo.
- 🔌 **The API contract is generated, not hand-written.** Derive it from the per-release `meilisearch-openapi.json` (see `Research/01-meilisearch-api-surface.md`).
- 🏷️ **Features are version-gated.** The UI asks the capability registry what's available instead of assuming.
- 🔐 **Secrets never touch plain-text config.** Use the OS credential store (Windows Credential Manager, macOS Keychain, Secret Service).
