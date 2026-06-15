# Changelog

All notable changes to Pare are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below `1.0.0` the public surface (HTTP routes, MCP tool
contracts, on-disk and crypto formats) may change between minor versions — see
[docs/RELEASING.md](docs/RELEASING.md) for how the version number is decided.

## [Unreleased]

### Added

- Display the app version in the landing-page footer and in-app, linked to the
  matching GitHub release ([#27]).

### Changed

- Redesigned the login / auth screens ([#32]).
- Collapsed the project to a single public open-core repository
  (`itsgotpower/pare`) as the source of truth ([#29]).

### Fixed

- The finance MCP server now reports its version from `package.json` instead of
  a hardcoded literal, so a release bump can't leave it stale.

### Security

- Pre-launch security audit fixes ([#30]).

## [0.1.0] - 2026-06-14

Initial public open-core release: local-first personal finance app that parses
bank/credit-card PDF statements, categorizes transactions, and shows spending
trends, cash-flow forecasts, net worth, and budget goals — plus a finance MCP
server exposing the local data to MCP clients. Ships open-source repo scaffolding
(README, LICENSE, CONTRIBUTING, issue/PR templates) and the first release tag
([#25]).

[Unreleased]: https://github.com/itsgotpower/pare/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/itsgotpower/pare/releases/tag/v0.1.0

[#25]: https://github.com/itsgotpower/pare/pull/25
[#27]: https://github.com/itsgotpower/pare/pull/27
[#29]: https://github.com/itsgotpower/pare/pull/29
[#30]: https://github.com/itsgotpower/pare/pull/30
[#32]: https://github.com/itsgotpower/pare/pull/32
