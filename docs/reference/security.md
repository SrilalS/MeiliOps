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

MeiliOps talks only to:

- the Meilisearch servers you add,
- `api.github.com` and GitHub's release downloads, when you install or update the Meilisearch binary for [local instances](../guide/local-instances).

There is no telemetry and no update check.

## Local instance binaries

The Meilisearch binary is downloaded from the official GitHub release and its **SHA-256** is checked against the digest GitHub publishes for that release file. A mismatch aborts the install. File operations for instances are restricted to the app's own data folder.

## Reporting a vulnerability

Please report security issues privately through [GitHub security advisories](https://github.com/SrilalS/MeiliOps/security/advisories/new) rather than a public issue.
