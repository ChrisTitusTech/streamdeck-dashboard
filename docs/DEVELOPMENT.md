# Development

## Architecture

```text
OpenDeck WebSocket
        |
        v
     index.js ------> render.js ------> Stream Deck SVG image
        |
        v
     status.js ------> /proc/<pid>/comm
                  \--> /proc/<pid>/fd/* -> active Codex rollout JSONL
```

The monitor discovers processes whose Linux `comm` value is exactly `codex`. It resolves open file descriptors that point to a dated Codex rollout and incrementally parses only `event_msg` records. Each session tracks its latest `task_started` turn until the matching `task_complete` or `turn_aborted` event. A newer turn replaces an orphaned older turn because a Codex process runs only one foreground turn at a time.

The tracker caches the last byte offset for every active rollout. It reads only appended bytes after the initial scan and drops the cache when the owning process closes the rollout.

## Source layout

```text
plugin/com.christitustech.codex-status.sdPlugin/
  index.js                 OpenDeck protocol and polling loop
  lib/status.js            Linux process and Codex lifecycle detection
  lib/t3.js                Authenticated MCP and linked-environment aggregation
  lib/render.js            SVG state renderer
  manifest.json            OpenDeck plugin manifest
scripts/
  connect-t3.mjs           One-time OAuth PKCE connection setup
  build.mjs                Bundles the plugin and ws dependency
  package.mjs              Creates the installable archive
  install.mjs              Development-only live profile installer
test/                      Node test suite
```

## Validation

```bash
npm install
npm run check
npm test
npm run package
unzip -t release/*.streamDeckPlugin
```

The tests use a temporary fake `/proc` tree and rollout files. They cover working, complete, offline, multiple-state rendering, incremental event parsing, and ZIP integrity primitives.

## Release archive

`npm run package` creates an uncompressed ZIP with a `.streamDeckPlugin` extension. The archive contains exactly one `.sdPlugin` root, which lets OpenDeck identify the plugin without a fallback identifier.

The bundled `index.js` includes the `ws` dependency and targets Node.js 18. Release archives do not contain `node_modules`, test files, source maps, or project scripts.

## Versioning and releases

1. Update `package.json` and the plugin `manifest.json` to the same semantic version.
2. Update `CHANGELOG.md`.
3. Run the full validation suite.
4. Merge or push the release commit to `main`.
5. Create and push an annotated `vX.Y.Z` tag.

The release workflow verifies the tag/version match, rebuilds the archive, writes a SHA-256 checksum, attests the artifact, and publishes a GitHub release.

## T3 Code monitoring

`CombinedStatusMonitor` polls local Codex and configured T3 servers. Each MCP client initializes protocol `2025-06-18`, retains its session, and reconnects after a stale-session response. T3 discovery uses `t3_environment_read`, `t3_environment_links`, and paginated `t3_thread_list` with `allProjects` and `includeSubagents`. Environment and thread IDs prevent duplicate counting. No thread-read operation is used, so monitoring does not mark child results delivered.

The key displays the active T3 thread count in larger text. Local Codex activity still affects the status but is not added to that count because a Codex process may belong to a T3 thread. Source errors take priority over complete, while known active work keeps the working state. The renderer rotates busy environment labels. OAuth setup uses dynamic registration, a loopback callback, state validation, and PKCE; credentials stay outside the checkout.

Tests exercise multiple providers, remote work, subagents, pagination, duplicate sources, unavailable peers, malformed configuration, SSE responses, session renewal, and endpoint restrictions. A real authenticated T3 smoke test additionally requires approving a read-only connection with `npm run connect:t3`.
