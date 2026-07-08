# Changelog

All notable changes to Pare are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is below `1.0.0` the public surface (HTTP routes, MCP tool
contracts, on-disk and crypto formats) may change between minor versions — see
[docs/RELEASING.md](docs/RELEASING.md) for how the version number is decided.

## [Unreleased]

### Added

- **Account management** — each account row in Profile → Data Health gets a
  MANAGE dialog: nickname it, hide it from every chart and total (data stays
  in the database and in exports), or mark it closed — history stays, upload
  nudges stop, and its last balance no longer carries into net worth or the
  cash-flow forecast ([#110]).

## [0.3.0] - 2026-07-04

### Added

- **Web push notifications (self-host)** — opt in on `/upload` ("GET PARSE
  ALERTS") to get a push when a statement finishes parsing, plus the
  safe-to-spend forecast heads-up; subscriptions auto-prune when a device
  unsubscribes. Paired with a full 375px responsive audit of the app ([#63]).
- **Safe to spend** — a hero card at the top of the dashboard answers "am I
  clear through rent and on to the next payday?" with one calm number, derived
  from the cash-flow forecast (short / tight / clear tiers on its ±1σ band).
  A web-push heads-up fires when a fresh statement projects the balance below
  zero before payday ([#68]).
- **Subscription kill kit** — `/recurring` now detects price hikes and lapsed
  subscriptions (which stop counting toward the monthly total and stop
  projecting phantom forecast charges), and adds mark-to-cancel: a CANCEL LIST
  with a running "$X since you marked" tally, per-merchant cancellation links,
  and matching dashboard insights ([#69]).
- **Shareable month-in-review card** — export the REVIEW tab as a 1080×1350
  PNG. Privacy-safe by default: category percentages only, with an explicit
  toggle for dollar amounts; merchant names never render ([#70]).
- **Public demo & onboarding** — a no-signup `/demo` renders the dashboard
  from synthetic sample data; `/upload` gains per-bank "where to get your
  statement" guides with parser-status badges ([#71]).
- **Bill calendar** — a new UPCOMING BILLS section on `/recurring` lists your
  committed outflows (rent, fixed bills, and detected subscriptions) due over
  the next 45 days, each cross-checked against your cash-flow forecast so a bill
  your projected balance won't cover gets flagged. Shows total due, lowest
  projected balance, and next payday ([#66]).

### Fixed

- **Chunk-recovery hardening** — the post-deploy chunk recovery no longer
  deletes share-target files still waiting for `/upload` to pick them up
  (the share-intake cache is preserved, matching the service worker's own
  keep-list), and no longer treats an offline dynamic-import failure as a
  deploy mismatch (which wiped the offline cache and bricked the offline app —
  it now surfaces the error screen instead). When recovery is declined because
  the chunk is missing on the *current* build, the error boundaries now show
  the real error and report it to monitoring instead of a permanent
  "Reloading…" screen, and boundary auto-recovery is production-only (dev HMR
  churn no longer triggers cache-clearing reloads) ([#73]).
- **Installed-PWA chunk-load error** — after a deploy, home-screen PWA users
  could hit a "failed to load chunk" error screen: the service worker was
  identical across deploys, so it never updated and kept serving a stale app
  shell pointing at chunk hashes the new build had removed. Cache names are now
  tied to a per-deploy build id (so a new deploy evicts the old build's cached
  chunks), and a `ChunkLoadError` now clears the cache and reloads onto the
  current build instead of dead-ending ([#72]).
- **Landing font fallback** — mono headings now fall back to a real monospace
  font (not a sans-serif) if the JetBrains Mono webfont fails to load ([#72]).
- **Installed-PWA safe area** — the marketing/landing header no longer runs
  under the iOS status bar and notch when Pare is launched from the home screen
  (standalone mode); headers now respect `safe-area-inset-top` ([#64]).

## [0.2.0] - 2026-07-02

### Added

- **Installable PWA** — add Pare to your home screen on iOS and Android: new
  pear icon set (incl. Android-maskable variant), web app manifest, and a
  service worker giving offline read-through of your last-synced data with an
  offline fallback page. On Android, share a statement PDF / OFX from your bank
  app straight into Pare (Web Share Target). Installed launches default to the
  dark theme with an edge-to-edge (`black-translucent`) iOS status bar; an
  install prompt is offered after your first successful upload ([#60]).
- **Cross-app import** — bring your history over from Monarch, Mint, or YNAB
  exports, with `/switch` as the guided migration landing page ([#39], [#58]).
- **Merchant drill-down pages** — click any merchant for its full history,
  monthly trend, and category breakdown ([#45]).
- **Month-in-review dashboard tab** ([#44]).
- **Parser registry + six new bank scaffolds** — statement parsers now route
  through a modular registry with shared card/ledger engines; RBC, TD, Scotia,
  BMO, Tangerine, and Wealthsimple are scaffolded (synthetic fixtures — they'll
  get a tuning pass on first real statements) ([#40], [#48]).
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
- Public pages: `/security` trust page ([#43]), `/how-it-works` and `/privacy`
  ([#56]), and a blog with six cornerstone articles for Mint/Monarch switchers
  ([#57]).
- Hosted-mode scaffolds (not yet live): Stripe subscriptions with per-plan
  feature entitlements ([#38], [#41]) and email-in statement ingest ([#42]).

### Changed

- Redesigned the login / auth screens ([#32]).
- Collapsed the project to a single public open-core repository
  (`itsgotpower/pare`) as the source of truth ([#29]).
- Charts and queries are now keyed by `account_kind` instead of hardcoded
  source strings, so statements from any new bank light up every chart
  automatically ([#36]).
- Contact addresses moved to `@pare.money` aliases.

### Removed

- The CSV import button and its `/api/upload/csv-import` route. CSV rows used
  period-start dates, producing different dedup keys than the PDF parser and
  silently doubling every metric on re-import. OFX/QFX import ([#47]) is the
  dedup-safe replacement.

### Fixed

- **Silent data corruption**: card refunds were counted as negative spend, and
  ambiguous D/M/Y dates could transpose — both fixed, with regression tests
  ([#50]).
- Blog articles 404'd on Cloudflare (content is now bundled and rendered on
  demand) ([#59]).
- Parser hardening and data-loss guards from three review passes: skipped-row
  logging, year-boundary dedup, pdftotext caching, multipart fallback ([#49],
  [#51], [#52]).
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

[Unreleased]: https://github.com/itsgotpower/pare/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/itsgotpower/pare/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/itsgotpower/pare/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/itsgotpower/pare/releases/tag/v0.1.0

[#25]: https://github.com/itsgotpower/pare/pull/25
[#27]: https://github.com/itsgotpower/pare/pull/27
[#29]: https://github.com/itsgotpower/pare/pull/29
[#30]: https://github.com/itsgotpower/pare/pull/30
[#32]: https://github.com/itsgotpower/pare/pull/32
[#36]: https://github.com/itsgotpower/pare/pull/36
[#38]: https://github.com/itsgotpower/pare/pull/38
[#39]: https://github.com/itsgotpower/pare/pull/39
[#40]: https://github.com/itsgotpower/pare/pull/40
[#41]: https://github.com/itsgotpower/pare/pull/41
[#42]: https://github.com/itsgotpower/pare/pull/42
[#43]: https://github.com/itsgotpower/pare/pull/43
[#44]: https://github.com/itsgotpower/pare/pull/44
[#45]: https://github.com/itsgotpower/pare/pull/45
[#47]: https://github.com/itsgotpower/pare/pull/47
[#48]: https://github.com/itsgotpower/pare/pull/48
[#49]: https://github.com/itsgotpower/pare/pull/49
[#50]: https://github.com/itsgotpower/pare/pull/50
[#51]: https://github.com/itsgotpower/pare/pull/51
[#52]: https://github.com/itsgotpower/pare/pull/52
[#56]: https://github.com/itsgotpower/pare/pull/56
[#57]: https://github.com/itsgotpower/pare/pull/57
[#58]: https://github.com/itsgotpower/pare/pull/58
[#59]: https://github.com/itsgotpower/pare/pull/59
[#60]: https://github.com/itsgotpower/pare/pull/60
[#63]: https://github.com/itsgotpower/pare/pull/63
[#64]: https://github.com/itsgotpower/pare/pull/64
[#66]: https://github.com/itsgotpower/pare/pull/66
[#68]: https://github.com/itsgotpower/pare/pull/68
[#69]: https://github.com/itsgotpower/pare/pull/69
[#70]: https://github.com/itsgotpower/pare/pull/70
[#71]: https://github.com/itsgotpower/pare/pull/71
[#72]: https://github.com/itsgotpower/pare/pull/72
[#73]: https://github.com/itsgotpower/pare/pull/73
[#110]: https://github.com/itsgotpower/pare/pull/110
