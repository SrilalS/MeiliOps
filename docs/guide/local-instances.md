# Local instances

MeiliOps can install and run Meilisearch on your computer, which is handy for development and testing. Open it from the title bar connection switcher → **Local instances**.

::: info Desktop app only
Local instances need the installed app. They're not available when the UI runs in a browser during development.
:::

Each instance picks a **Meilisearch version** and where it **runs**:

| Runs on | What it uses | Data |
|---|---|---|
| **Native** | An official binary that MeiliOps downloads | `instances/<id>` in the app's data folder |
| **Docker** | The official `getmeili/meilisearch` image | A named volume, `meiliops-<id>` |
| **Podman** | The same image | A named volume, `meiliops-<id>` |

## Native versions

Pick a release in the **Native versions** card and click **Install**. MeiliOps:

1. Lists Meilisearch releases from GitHub (tick **pre-releases** to include release candidates).
2. Downloads the official **Community Edition** binary for your platform.
3. Verifies its **SHA-256** against the digest GitHub publishes for the release, and refuses it on mismatch.
4. Installs it next to the others, in `bin/<version>` in the app's data folder (on Windows: `%LOCALAPPDATA%\io.meiliops.app\bin`).

Versions install side by side, so instances can run different versions at the same time. Remove a version with its trash icon; instance data is not touched.

## Docker and Podman

The **Container engines** card shows whether Docker and Podman are installed and running. MeiliOps looks for them on your `PATH` and, on macOS, in the usual install locations (`/usr/local/bin`, `/opt/homebrew/bin`, `/opt/podman/bin`, Docker.app).

- The engine must be running: start Docker Desktop or the Docker daemon, or run `podman machine start`, then click refresh.
- Images are pulled on an instance's first start; the pull progress appears in its logs. Pulled versions are listed as chips; remove one with its ×.
- The container publishes its port on `127.0.0.1` only, and the master key is passed as an environment variable, never on the command line.

## Create an instance

Click **New instance** and set:

| Field | Notes |
|---|---|
| **Name** | Shown in the list and used for the auto-created connection |
| **Runs on** | Native, Docker or Podman. Engines that aren't installed are disabled. |
| **Meilisearch version** | Native: an installed version. Docker/Podman: any release (pulled versions first). |
| **Port** | Defaults to a free port. A port already in use is flagged before you start. |
| **Environment** | `development` or `production` (production requires a master key) |
| **Master key** | Stored in the OS keychain. **Generate** creates a random 32-character key. |
| **Launch flags** | A searchable editor built from `meilisearch --help` of the chosen version, so every flag of that version is available with its description and default. Flags the version doesn't have are flagged, since Meilisearch won't start with them. |
| **Environment variables** | Extra `MEILI_*` variables if you prefer them to flags |

## Change the version

Edit a stopped instance and pick another version:

- **Newer version:** the data is upgraded in place with `--upgrade-db` on the next start (Meilisearch 1.12 and later). Take a dump or snapshot first if you may want to go back.
- **Older version:** refused. Meilisearch can't open data written by a newer version; import a dump instead.
- **Other engine:** data doesn't move between engines. Each engine has its own storage for the instance, which starts empty the first time.

## Run it

- **Start** launches the process and waits for `/health`. The first successful start creates a connection named *&lt;name&gt; (local)*; after that, your own edits to that connection's name and color are kept.
- **Open** connects to it.
- **Logs** shows the process output live.
- **Stop** shuts it down (`docker stop` / `podman stop` for containers). Closing MeiliOps stops all running instances so no process is left holding a port or the database lock.
- If MeiliOps quits without stopping a container, it reattaches to it on the next launch.
- **Delete** removes the instance and its connection, and optionally its data folder and volumes.

::: tip Experimental routes
Some experimental features are **launch flags** rather than runtime toggles: `--experimental-enable-metrics`, `--experimental-enable-logs-route` and `--experimental-enable-tasks-streaming-route`. Turn them on in the instance's launch flags to use the Metrics and Logs screens and live task streaming.
:::
