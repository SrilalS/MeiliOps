# Updates

MeiliOps updates itself from its GitHub releases.

## How it works

- A few seconds after launch, MeiliOps checks for a newer release, at most **once a day**. When one exists, an **Update** button appears in the title bar.
- Click it to read the release notes, then **Update and restart**. MeiliOps downloads the update, verifies it, installs it and restarts.
- Check any time from the **⋮** menu in the title bar → **Check for updates**. Turn off **Check automatically** in the same menu if you'd rather only check by hand.

::: tip Running local instances
Local instances are stopped before the update installs, so no Meilisearch process is left holding its port or data. Start them again after the restart; their data is untouched.
:::

## Security

Every update is signed with the MeiliOps release key, and the app refuses any download whose signature doesn't match the public key built into it. A tampered file on the release page can't be installed.

## Per platform

| Installed with | Update |
|---|---|
| Windows installer (`.exe`) | Installs in place (no admin prompt for the per-user install) |
| macOS `.dmg` | Replaces `MeiliOps.app` |
| Linux `.AppImage` | Replaces the AppImage file |
| Linux `.deb` / `.rpm` | Installs the new package; asks for your password (`pkexec`) |

Versions before 0.4 have no updater: install 0.4 by hand once, and it updates itself from then on.
