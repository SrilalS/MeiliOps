# Security

## Secrets

| What | Where it's stored |
|---|---|
| Connection API keys | OS credential store: Windows Credential Manager, macOS Keychain, or the Secret Service on Linux. Service name `io.meiliops.app`. |
| Local instance master keys | Same credential store |
| Connection names, URLs, colors, theme | The app's settings file (`meiliops.json` in the app's config folder). No secrets. |

Keys are read from the credential store only when needed (connecting, editing a connection, starting an instance), and are sent only to the server they belong to, in the `Authorization` header.

Tenant tokens are signed locally with the key you choose; nothing is sent to the server to create them.

## Network access

MeiliOps connects only to the hosts below. There is **no telemetry**: no analytics, crash reports, usage tracking or accounts.

| Host | When | Can you turn it off? |
|---|---|---|
| The Meilisearch servers you add | Whenever you use them. Keys go only to the server they belong to | — |
| `127.0.0.1` | Checking whether a port is free, and talking to your [local instances](../guide/local-instances) | — |
| `api.github.com` | Opening **Local instances**, to list Meilisearch releases | Don't open that screen |
| GitHub release downloads | Installing a Meilisearch version (SHA-256 checked, see below) | Only on request |
| `github.com/SrilalS/MeiliOps/releases/latest/download/latest.json` | The [update check](../guide/updates): at most once a day, a few seconds after launch, and when you choose **Check for updates** | Yes: ⋮ → **Check automatically** |
| MeiliOps' GitHub release download | Only when you click **Update and restart**. The installer is verified against the release signing key | Only on request |
| Docker Hub (`docker.io`), through your own Docker or Podman | Pulling a Meilisearch image for a container instance | Only on request |

The app sends no identifiers of its own in these requests.

## Local instance binaries

The Meilisearch binary is downloaded from the official GitHub release and its **SHA-256** is checked against the digest GitHub publishes for that release file. A mismatch aborts the install. File operations for instances are restricted to the app's own data folder.

## Reporting a vulnerability

Please report security issues privately through [GitHub security advisories](https://github.com/SrilalS/MeiliOps/security/advisories/new) rather than a public issue.
