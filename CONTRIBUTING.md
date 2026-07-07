# Contributing to Pare

Thanks for taking a look.

## Contribution status: issues yes, code PRs not yet

Pare is currently **solo-developed**. Bug reports, feature requests, and
discussions are very welcome — please open an issue. **External code pull
requests are not being accepted right now**; an unsolicited PR will be closed
with a pointer to this section rather than reviewed.

Why: keeping authorship in one place while the project is young keeps the
licensing picture simple (see the [license boundary](README.md#license) —
AGPL-3.0 core, proprietary `cloud/`). If code contributions open up later,
the contribution terms (DCO sign-off vs. CLA) will be settled and documented
here *before* the first outside PR merges.

The rest of this document describes the workflow changes go through today, so
you can follow along — and so it's ready if contributions open up.

## Setup

See the [Self-host quickstart](README.md#self-host-quickstart) in the README:
Node 18+, Python 3.10+, poppler, then `npm install && npm run dev`. That's the
same environment you develop in.

## Running tests

```bash
npm test            # Python parser regression suite (stdlib unittest, synthetic fixtures)
npm run test:repo   # Repo seam, parser, storage, and queue tests (tsx --test)
npm run test:auth   # Auth tests (single-user gate + better-auth resolution)
npm run test:do-sql # Durable Object SQLite backend, run in workerd (vitest)
```

Before opening a PR, also run the build the way CI does:

```bash
npm run typecheck:workers   # type-check the Workers build
npm run cf:build            # build the Cloudflare (OpenNext) bundle
```

CI runs `typecheck:workers` and `cf:build` on every PR. If those pass locally,
CI should be green.

**Test data must be synthetic.** Never put real transactions, statement PDFs, or
account/transit numbers into tests or tracked source — see [SECURITY.md](SECURITY.md).

## PR flow

1. Fork the repo and create a branch off `main`.
2. Make your change. Keep it focused; one concern per PR.
3. Use a [Conventional Commits](https://www.conventionalcommits.org) prefix on
   your commits and PR title — this project uses `feat:`, `fix:`, `docs:`,
   `chore:`, and `copy:` (see `git log`).
4. Open a PR against `main`. Fill out the template (what changed, why, how
   tested).
5. CI must be green before merge. PRs are squash-merged.

## Versioning & releases

Pare follows [Semantic Versioning](https://semver.org). The version lives in one
place — `package.json` `version` — and the web app and MCP server both derive
from it. Notable changes go in [CHANGELOG.md](CHANGELOG.md). For how the version
number is chosen (the pre-1.0 rules differ) and the step-by-step release flow,
see [docs/RELEASING.md](docs/RELEASING.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be decent.

## Reporting security issues

**Do not open a public issue for a security vulnerability.** Email
**security@pare.money** with details and steps to reproduce. See
[SECURITY.md](SECURITY.md) for what counts as sensitive and how disclosure is
handled.
