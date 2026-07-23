# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Keep tracking active Codex sessions when Linux marks their still-open rollout files as deleted.

## [1.0.1] - 2026-07-14

### Fixed

- Encode package timestamps in UTC so release archives are byte-for-byte reproducible across builder timezones.

## [1.0.0] - 2026-07-14

### Added

- OpenDeck action with working, complete, and offline states.
- Multiple concurrent Codex session detection through Linux `/proc`.
- Privacy-preserving task lifecycle tracking from active Codex rollout files.
- Reproducible `.streamDeckPlugin` packaging.
- Automated tests, CI, release checksums, and build provenance attestations.

[Unreleased]: https://github.com/ChrisTitusTech/streamdeck-dashboard/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ChrisTitusTech/streamdeck-dashboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ChrisTitusTech/streamdeck-dashboard/releases/tag/v1.0.0
