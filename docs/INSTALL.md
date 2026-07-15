# Installation

## Requirements

- Linux with `/proc` mounted
- OpenDeck 2.13 or newer
- Node.js 18 or newer installed on the host
- Codex running as the same Linux user as OpenDeck

Check Node.js before installing:

```bash
node --version
```

OpenDeck's Flatpak build can run the plugin, but Node.js must still be installed natively on the host. A Node.js Flatpak extension is not sufficient for OpenDeck plugins.

## Install a release

1. Open the [latest release](https://github.com/ChrisTitusTech/streamdeck-dashboard/releases/latest).
2. Download the file ending in `.streamDeckPlugin`.
3. Open **OpenDeck > Settings > Plugins**.
4. Select **Install plugin from file**.
5. Select the downloaded release file.
6. In the action list, open **Codex** and drag **Codex Status** to a key.

The release archive contains a single top-level `com.christitustech.codex-status.sdPlugin` directory, including its bundled JavaScript and manifest.

## Update

Download the newer release and install it through **Install plugin from file** again. OpenDeck replaces the plugin while preserving profile assignments.

## Remove

Open **OpenDeck > Settings > Plugins**, select **Codex Status**, and choose **Remove**. OpenDeck removes the plugin and its assigned actions.

## Verify a download

Each GitHub release includes a SHA-256 checksum file. From the download directory:

```bash
sha256sum --check codex-status-v*.streamDeckPlugin.sha256
```

GitHub also publishes a build provenance attestation for the plugin archive.

## Troubleshooting

### The action does not appear

- Restart OpenDeck after installation.
- Confirm **Codex Status** appears under **Settings > Plugins**.
- Confirm `node --version` reports 18 or newer.
- Review OpenDeck's plugin log directory from its Settings page.

### The key says OFFLINE while Codex is open

- Confirm the process is named `codex`: `pgrep -a -x codex`.
- Run Codex and OpenDeck as the same Linux user.
- Confirm the user can inspect its own `/proc/<pid>/fd` directory.
- Start a new local Codex task and press the key to refresh immediately.

### The key stays WORKING

The status follows the live rollout attached to the Codex process. If Codex was interrupted abnormally, restart that Codex process so its stale open session is released.

### Cloud or remote tasks are not shown

Only local Codex processes on the same Linux host are in scope. Cloud-only and remote-host tasks are not visible to this plugin.

## Install from source for development

Stop OpenDeck before using the development installer:

```bash
git clone https://github.com/ChrisTitusTech/streamdeck-dashboard.git
cd streamdeck-dashboard
npm install
npm run build
node scripts/install.mjs --slot 0
```

Replace `0` with an empty key position. The script creates a timestamped profile backup under `~/.local/state/streamdeck-dashboard/backups`.
