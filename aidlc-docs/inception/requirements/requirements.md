# Requirements (DRAFT, seeded from kickoff)

> Status: 🟡 Draft. Finalized after `requirements-questions.md` is answered.

## Functional requirements

| ID | Requirement | Source |
|---|---|---|
| FR-01 | Manage multiple Meilisearch connections (URL + API key), saved securely | Kickoff (Compass/pgAdmin parity) |
| FR-02 | Cover **100% of the Meilisearch HTTP API** for the supported version range (inventory: `Research/01`) | Kickoff |
| FR-03 | Detect the server version and features, and gate the UI accordingly ("compatibility") | Kickoff |
| FR-04 | Browse, search, create, edit and delete documents at scale (virtualized grid, JSON view) | Implied by Compass parity |
| FR-05 | Edit every index setting with a diff preview, and track the resulting async tasks | Implied |
| FR-06 | Live task and batch monitoring | Implied |
| FR-07 | API key management, plus local tenant-token generation | Implied |
| FR-08 | Import/export (JSON, NDJSON, CSV); dumps, snapshots, remote export | Implied |

## Non-functional requirements

| ID | Requirement | Target (proposed, see `Research/04`) |
|---|---|---|
| NFR-01 | Native desktop app, **no Electron** | Hard constraint |
| NFR-02 | Memory efficient | Idle < 60 MB private working set (whole process tree) |
| NFR-03 | High performance | Cold start < 500 ms; 60 fps scrolling over 1M-row result sets |
| NFR-04 | Cross-platform: Windows, macOS, Linux | Windows 11 x64 first; the others must stay buildable |
| NFR-05 | Secrets stored in the OS credential store | Hard constraint |
