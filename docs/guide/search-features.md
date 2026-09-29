# Search features

Screens for the search features that span indexes or change how search behaves.

## Multi-search

Runs several queries in one request (`POST /multi-search`), either:

- **Per index**: each query returns its own result list, or
- **Federated**: results from all queries are merged into one ranked list. Each query can carry a `federationOptions.weight` to boost or dampen its index.

The request is edited as JSON, starting from a working template, and the results are shown grouped by query or merged.

## Search rules

Dynamic search rules pin, boost or demote documents for matching queries, without touching your data or settings. Create, edit and delete rules here.

Search rules are an experimental Meilisearch feature. If it's off, the screen offers a button to enable it under **Experimental**.

## Chats

Conversational search over your indexes:

- **Workspaces**: create and delete chat workspaces and edit their settings (LLM provider, prompts, API key).
- **Playground**: chat with a workspace. Answers stream in as they're generated.

Chats is experimental in Meilisearch and must be enabled first.
