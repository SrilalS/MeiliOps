# Connections

A connection is a saved server: a name, a URL, a color and (optionally) an API key.

## Managing connections

- **Add**: title bar connection switcher → **New connection…**, or **+** next to *Connections* in the sidebar.
- **Edit**: hover a connection in the switcher and click the pencil. Cancel or Save returns you to the page you were on.
- **Delete**: open the connection and click **Delete**. This removes it and its stored key from this computer; the server itself is not touched.

The color shows up in the title bar and status bar, which helps tell production from staging at a glance.

## Where keys are stored

API keys are saved in the operating system's credential store, never in a config file:

| OS | Store |
|---|---|
| Windows | Credential Manager (service `io.meiliops.app`) |
| macOS | Keychain |
| Linux | Secret Service (GNOME Keyring, KWallet, …) |

The rest of the connection (name, URL, color) is stored in the app's settings file. See [Security](../reference/security).

## Connection states

| State | What you see | What to do |
|---|---|---|
| **Connecting** | A spinner in the title bar | Wait. Attempts time out after 8 seconds. |
| **Couldn't connect** | An error screen and an `offline` badge | **Retry**, **Edit connection**, or **Back** to leave it |
| **Connection lost** | A yellow banner: *Lost connection to …* and a `reconnecting` badge | Nothing: MeiliOps checks the server every few seconds and reconnects on its own, keeping your page. **Retry now** checks immediately; **Disconnect** gives up. |

While a connection is lost, background refreshes pause and error messages are collected into the banner instead of piling up as notifications. Panels that failed because the server was unreachable reload by themselves once it's back.

## Switching servers

Pick another connection in the title bar. Reconnecting to the *same* server keeps your page; switching to a *different* server opens its Overview. Operations still running on the previous server keep being tracked, and their notifications name the server they ran on.
