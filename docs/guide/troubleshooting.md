# Troubleshooting

## Installing

**Windows says "Windows protected your PC".** Releases aren't code-signed yet, so SmartScreen doesn't recognise the publisher. Click **More info → Run anyway**.

**macOS says the app is damaged or can't be opened.** Same cause. Right-click MeiliOps in Applications and choose **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/MeiliOps.app
```

**Linux AppImage won't start.** Make it executable (`chmod +x MeiliOps_*.AppImage`). The deb and rpm packages pull in WebKitGTK 4.1; for the AppImage, install it from your distribution.

## Connecting

**"Can't reach http://…. Is Meilisearch running there?"** Nothing answered at that address. Check the URL and port, that Meilisearch is running, and that no firewall is in the way.

**"No response from … after 8 s."** Something accepted the connection but never answered, typically a wrong host or a firewall silently dropping traffic.

**`invalid_api_key` or `missing_authorization_header`.** The server has a master key and the connection's key is missing or wrong. Edit the connection and paste the master key or an admin key.

**A screen shows a permission error.** The connection's key lacks an action that screen needs. Use a key with broader actions, or the master key.

## Features

**Metrics, Logs or live task updates say they're not enabled.** These are experimental features that Meilisearch only enables with a launch flag: `--experimental-enable-metrics`, `--experimental-enable-logs-route`, `--experimental-enable-tasks-streaming-route`. For [local instances](./local-instances), add them in the instance's launch flags.

**"feature_not_enabled" on Search rules, Chats, Edit with function, and similar.** These are runtime toggles: click **Open Experimental features** in the error and switch the feature on.

**A local instance won't start because the port is in use.** Another program is listening on that port. Pick another port in the instance settings (new instances default to a free one).

## Still stuck?

[Open an issue](https://github.com/SrilalS/MeiliOps/issues) with your OS, the MeiliOps and Meilisearch versions, and what you see.
