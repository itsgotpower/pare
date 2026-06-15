# cloud/ — proprietary commercial layer

**PROPRIETARY** — see [LICENSE](LICENSE). Not AGPL. Not part of the open-source
core.

Everything required to run the **paid hosted Pare service** that isn't part of
the open product lives here. Nothing in this directory is needed to self-host the
open-source core.

## Rules

1. **Additive only.** Code here is new; it never edits core files (that's what
   keeps `git merge upstream/main` clean — see [../SETUP.md](../SETUP.md)).
2. **Gated.** Every entry point must no-op unless `PARE_CLOUD=1`, so the core
   still runs standalone.
3. **Thin shims in `app/`.** Next.js routes must live under `app/`, but keep
   those files to a one-line re-export of an implementation defined here.

## Intended contents (as the hosted product is built)

| Path | Purpose | Status |
|---|---|---|
| `cloud/billing/` | Stripe integration, checkout/portal, webhook handling | scaffolded — see [billing/README.md](billing/README.md) |
| `cloud/metering/` | Usage metering (statements parsed, storage) + plan-limit enforcement | scaffolded (`metering/usage.ts`) |
| `cloud/plans.ts` | Plan definitions (free cap, paid tiers) — see PRD §6 | placeholder numbers |
| `cloud/admin/` | Hosted-only operational/admin tooling | not started |

These map to roadmap **Phase 6 — Billing + public launch** in the public
[PRD](https://github.com/itsgotpower/pare/blob/main/docs/PRD.md). Functional
requirement **FR-72** (billing) is the spec.
