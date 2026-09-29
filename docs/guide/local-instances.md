# Local instances

MeiliOps can install and run Meilisearch on your computer, which is handy for development and testing. Open it from the title bar connection switcher → **Local instances**.

::: info Desktop app only
Local instances need the installed app. They're not available when the UI runs in a browser during development.
:::

## Install the binary

Click **Install** (or **Update**) on the binary card. MeiliOps:

1. Looks up the latest Meilisearch release on GitHub.
2. Downloads the official **Community Edition** binary for your platform.
3. Verifies its **SHA-256** against the digest GitHub publishes for the release, and refuses it on mismatch.
4. Installs it into the app's data folder (on Windows: `%LOCALAPPDATA%\io.meiliops.app\bin`).

After an update, each instance is started once with `--upgrade-db` so its data is migrated to the new version.

## Create an instance

Click **New instance** and set:

| Field | Notes |
|---|---|
| **Name** | Shown in the list and used for the auto-created connection |
| **Port** | Defaults to a free port. A port already in use is flagged before you start. |
| **Environment** | `development` or `production` (production requires a master key) |
| **Master key** | Stored in the OS keychain. **Generate** creates a random 32-character key. |
| **Launch flags** | A searchable editor built from `meilisearch --help` for the installed version, so every flag of that version is available with its description and default |
| **Environment variables** | Extra `MEILI_*` variables if you prefer them to flags |

Each instance keeps its data in its own folder under `instances/<id>` in the app's data folder.

## Run it

- **Start** launches the process and waits for `/health`. The first successful start creates a connection named *&lt;name&gt; (local)*; after that, your own edits to that connection's name and color are kept.
- **Open** connects to it.
- **Logs** shows the process output live.
- **Stop** shuts it down. Closing MeiliOps stops all running instances so no process is left holding a port or the database lock.
- **Delete** removes the instance and its connection, and optionally its data folder.

::: tip Experimental routes
Some experimental features are **launch flags** rather than runtime toggles: `--experimental-enable-metrics`, `--experimental-enable-logs-route` and `--experimental-enable-tasks-streaming-route`. Turn them on in the instance's launch flags to use the Metrics and Logs screens and live task streaming.
:::
