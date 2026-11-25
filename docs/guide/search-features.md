# Search features

Screens for the search features that span indexes or change how search behaves.

## Multi-search

Runs several queries in one request (`POST /multi-search`), either:

- **Per index**: each query returns its own result list, or
- **Federated**: results from all queries are merged into one ranked list. Each query can carry a `federationOptions.weight` to boost or dampen its index.

The request is edited as JSON, starting from a working template, and the results are shown grouped by query or merged.

## Search rules

Dynamic search rules pin, boost or demote documents for matching queries, without touching your data or settings. Create, edit and delete rules here.

Rule changes are tasks, so a rule can lag behind what you saved. On the Enterprise Edition, click **target** on a rule to see the state it will have once its pending tasks are processed, with the changes highlighted, and tick **Show pending** to mark rules with pending tasks and see how the rule count will change. The Community Edition answers both with a `requires_enterprise_edition` error.

Search rules are an experimental Meilisearch feature. If it's off, the screen offers a button to enable it under **Experimental**.

## Chats

Conversational search over your indexes:

- **Workspaces**: create and delete chat workspaces and edit their settings (LLM provider, prompts, API key).
- **Playground**: chat with a workspace. Answers stream in as they're generated.

Chats is experimental in Meilisearch and must be enabled first.
