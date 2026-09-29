# Operations

Screens for running a Meilisearch server day to day.

## Overview

Health, version, index and document counts, database size and last update, plus buttons to **Create dump** and **Create snapshot**. The **MCP endpoint** card shows the server's Model Context Protocol URL (`/mcp`) for connecting an LLM client, and can test it.

## Metrics

![The metrics dashboard](/screenshots/metrics.png)

A dashboard over Meilisearch's Prometheus endpoint: searches running and waiting, task queue usage, request latency, database sizes, and every raw metric family with a filter. It refreshes every 5 seconds.

Requires the server to be started with `--experimental-enable-metrics`. If it isn't, the screen says so and tells you which flag to add.

## Logs

Streams the server's logs live (`/logs/stream`). Set the target filter (for example `debug`, `milli=trace,actix_web=off`, or one of the presets) and the mode: **human** (readable lines), **json**, or **profile** (a performance trace you can download and open in a profiler). You can also change what the server writes to its own stderr, and download what you captured. Requires `--experimental-enable-logs-route`.

::: info Desktop app only
The live log stream works in the desktop app. Browsers can't receive it: Meilisearch compresses the stream in a way that holds data back, and only the desktop app can ask for it uncompressed.
:::

## Export

Copies indexes from the connected server to **another Meilisearch instance** (`POST /export`). Set the destination URL and API key, then add index patterns, each with an optional filter and a choice to override the destination's settings.

## Webhooks

Create, edit and delete webhooks that Meilisearch calls when tasks finish, with custom headers.

## Experimental features

Toggle the runtime experimental features (`/experimental-features`). Features that need a launch flag instead are pointed out wherever you hit them.

## API console

![The API console](/screenshots/console.png)

Every operation in Meilisearch's OpenAPI spec, searchable and grouped by tag. Pick one, fill in its path and query parameters and body, and send it. Streaming routes stream into the response pane. It's the escape hatch for anything without a dedicated screen, and for trying requests before writing code.
