# Contributing

Thanks for helping improve Codex Status for OpenDeck.

## Before opening an issue

- Search existing issues first.
- Confirm the problem occurs with a current OpenDeck release.
- Run `node --version` and verify Node.js 18 or newer is installed on the host.
- Check the OpenDeck logs for the Codex Status plugin.
- Do not post Codex transcripts, credentials, or other private data.

Security vulnerabilities should be reported using the process in [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

```bash
git clone https://github.com/ChrisTitusTech/streamdeck-dashboard.git
cd streamdeck-dashboard
npm install
npm run check
npm test
npm run package
```

## Pull requests

1. Create a focused branch from `main`.
2. Keep changes small and include tests for behavior changes.
3. Update documentation and `CHANGELOG.md` when user-visible behavior changes.
4. Run all validation commands before opening the pull request.
5. Explain what changed, why it changed, and how it was tested.

By contributing, you agree that your contributions will be licensed under the MIT License.
