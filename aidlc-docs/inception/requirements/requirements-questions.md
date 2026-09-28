# Requirements: Clarifying Questions

Fill in each `[Answer]:` line. Use a letter, or free text.

---

## Q1. Supported Meilisearch version range
Meilisearch ships roughly **weekly** (v1.54 on 2026-09-21). Experimental APIs break often: Dynamic Search Rules changed shape in v1.50 **and** again in v1.54.

- A) Latest stable only, tracking forward
- B) Latest **N** minor versions (suggest N = 12, about 3 months)
- C) Everything from v1.12+ (Batches API baseline)
- D) Other

[Answer]: A

## Q2. What does "100% feature availability" include?
- A) All **stable** routes. Experimental routes are best-effort and behind a toggle
- B) Stable **and** experimental routes, both first-class
- C) B, plus Enterprise-only features (sharding/network, S3 snapshots)

[Answer]: A

## Q3. Team language and skill set
This drives the framework choice (see `Research/03`). Is the team strongest in:

- A) Rust
- B) C# / .NET
- C) TypeScript / web
- D) C++ / Qt
- E) Mixed, or open to learning Rust

[Answer]: C

## Q4. Licensing and distribution model
- A) Open source (which license?)
- B) Internal tool only
- C) Commercial product

This affects framework licensing: Qt is LGPL/commercial, Slint is GPL, royalty-free or commercial.

[Answer]: A (MIT)

## Q5. Local instance management
Should the app **start and stop a local `meilisearch` binary** and edit its launch flags and env vars? Compass and pgAdmin don't. Some server config (CLI flags) isn't reachable through the HTTP API at all.

- A) Yes
- B) No, connect to running instances only
- C) Later phase

[Answer]: A

## Q6. Connectivity extras
Which of these are needed? Multi-select.

- A) SSH tunnel
- B) HTTP proxy
- C) Custom CA / self-signed TLS
- D) Meilisearch Cloud account integration
- E) None for v1

[Answer]: E

## Q7. Product name
`MeiliAdmin` is **already taken** by an existing OSS project (github.com/90pixel/MeiliAdmin, a Vue web tool).

- A) Keep it (internal only)
- B) Rename. Suggestions?

[Answer]: B. Rename. Suggestion: "MeiliOps".

## Q8. AI-DLC runtime
Should I install the **official AI-DLC v2 runtime**? It adds the `/aidlc` command and structured audit/state under `aidlc/spaces/`. Installing it runs `irm …/install.ps1 | iex` and modifies the user PATH.

- A) Yes, install it
- B) No, keep the lightweight manual scaffold (current)

[Answer]: A
