# Changelog

All notable changes to Pare are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below `1.0.0` the public surface (HTTP routes, MCP tool
contracts, on-disk and crypto formats) may change between minor versions — see
[docs/RELEASING.md](docs/RELEASING.md) for how the version number is decided.

## [Unreleased]

### Added

- **Manual / cash transactions** — a `+ ADD CASH` quick-add on the transactions
  page for spending that never hits a statement. Cash entries count in every
  spend chart (and in cashflow's outflow), keep the category you pick even
  through later recategorize passes, and can be deleted from the row dialog.
  Statement-backed rows stay undeletable. Also exposed over MCP as
  `add_manual_transaction` / `delete_manual_transaction` (18 tools total), so
  "Claude, I spent $40 cash at the market" records it.

- **OFX / QFX import** on `/upload` — drop a `.ofx` / `.qfx` export and Pare reads
  the transactions directly, no PDF or bank login required. Dedup is keyed on each
  transaction's bank-assigned `FITID`, so re-importing an overlapping file is a
  no-op instead of the silent duplicates the old CSV import produced. Account type
  from the file (chequing / savings / credit card) sets `account_kind`, so imported
  accounts light up every chart; deposit-account closing balances feed net worth.
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
- Hosted accounts must now verify their email address before they can sign in. A
  verification link is emailed on sign-up; signing up with an address you don't
  control no longer yields a usable session.

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
