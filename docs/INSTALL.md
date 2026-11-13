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

Connect T3 Code as described below. Remote work must be running in a configured T3 server or one of its linked environments. Standalone remote Codex and cloud-only tasks remain outside scope.

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

## Connect T3 Code

Use a current T3 Code version with MCP thread listing and linked environments (developed against desktop 0.1.9). In a source checkout on the OpenDeck host:

```bash
npm run connect:t3
```

The setup reads the local server address from `$T3CODE_HOME/userdata/server-runtime.json` (default `~/.t3`). Open its printed authorization URL in a browser on the same host and approve **read-only** access. T3 requires this approval to create the plugin connection. The callback listener binds only to loopback and exits after approval or five minutes.

For another server:

```bash
npm run connect:t3 -- https://your-t3-server
```

Repeat for each independent server in the app. A server's directly linked environments are discovered automatically through `t3_environment_links`; enable **Settings > Labs > Linked environments** in T3 to use that feature. Desktop-only saved connections are not necessarily server links. Each environment is counted once even if multiple sources link to it.

The setup writes `$XDG_CONFIG_HOME/codex-status/t3.json` (default `~/.config/codex-status/t3.json`) and a separate token file with mode `600`. The config uses this format:

```json
{
  "sources": [
    {
      "endpoint": "http://127.0.0.1:3773/mcp",
      "tokenFile": "token-file-from-setup",
      "includeLinked": true
    }
  ]
}
```

The port is an example; setup uses the actual server port. Token paths are relative to the config file or absolute. Endpoint URLs require HTTPS except on loopback. For a standalone server with linked environments disabled, set `includeLinked` to `false`. The plugin reloads config and token files on each poll. Re-run setup after a local server port change or token expiry/revocation. Remove a source from the config and revoke its connection in T3 to disconnect it.

If a source cannot be reached, its count is excluded and the key reports source errors. Without known active work it shows **UNKNOWN**, never **COMPLETE**. A missing config keeps the original local Codex behavior; an invalid config shows an error. Polls never overlap and individual MCP requests time out after five seconds, so unreachable machines can slow refreshes.
