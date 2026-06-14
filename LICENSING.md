# Licensing

Copyright © 2026 pare.money. All rights reserved.

Pare follows an **open-core** model. There are two layers, under two different
licenses, in two repositories.

## 1. The open-source core — this repository (`pare`) — AGPL-3.0

Everything in this repository is licensed under the
**GNU Affero General Public License, version 3** (see [LICENSE](LICENSE),
SPDX: `AGPL-3.0-only`).

You may run, study, modify, self-host, and redistribute it freely. The AGPL's
key condition: **if you run a modified version as a network service, you must
make your modified source available to that service's users.** Plain self-hosting
for yourself or your organization triggers no obligation; offering a *modified*
Pare to others over a network does.

This covers the whole product you can self-host today: the PDF parser, `lib/db`
query layer, the `Repo` seam (`SqliteRepo` + `DoSqlBackend`), the dashboard and
all analytics, the single-user auth gate, the hosted multi-user data plane, and
the finance MCP server.

## 2. The commercial layer — the `pare-cloud` repository — proprietary

The code that runs the paid hosted service at **pare.money** — billing, usage
metering and plan enforcement, subscription/account lifecycle, and any
hosted-only operational tooling — lives in a **separate, private repository
(`pare-cloud`)** and is **not** released under the AGPL. It is proprietary and
all rights are reserved.

`pare-cloud` is a downstream fork that tracks this repository as `upstream`; the
proprietary code is quarantined in its own top-level `cloud/` directory. Fixes to
the core are made *here* (AGPL) and flow downstream; the proprietary layer never
flows back upstream.

## 3. Why we can keep the cloud layer closed

We hold the copyright to the core, and **a copyright holder is not bound by the
terms it places on others.** We license the core to the public under AGPL while
retaining the right to combine our *own* core code with proprietary code in
`pare-cloud`. This dual position is standard for open-core projects (GitLab,
Sentry, Cal.com, etc.).

This freedom holds **only while we own the entire copyright in the core.** That
is what the Contributor License Agreement below protects.

## 4. Contributing — CLA required

External contributions are welcome, but because a contribution licensed to us
under the AGPL alone would *remove* our ability to use that code in the
proprietary cloud layer (§3), we require contributors to agree to a lightweight
**Contributor License Agreement (CLA)**: you keep copyright in your contribution
and grant pare.money a perpetual, irrevocable license to use, modify, and
**relicense** it (including under proprietary terms) as part of Pare.

> **[TBD]** Choose and wire up the CLA mechanism before accepting outside PRs —
> e.g. [CLA Assistant](https://github.com/cla-assistant/cla-assistant) (a bot
> that gates PRs on signature) or a simpler [DCO](https://developercertificate.org/)
> with an explicit relicensing grant. Until this is in place, do not merge
> third-party contributions, or the dual-licensing position in §3 is compromised.

## 5. What is *not* in the open-source core

To set expectations for self-hosters: the AGPL core is a complete, runnable
product. The cloud repository adds operational/commercial concerns only —
nothing in `cloud/` is required to self-host Pare. The tuned categorization
dictionary (`data/seed-rules.json`) and all personal data remain gitignored in
either repository and are never distributed (see [SECURITY.md](SECURITY.md)).

## 6. Questions

Licensing or commercial-use questions: `licensing@pare.money`. **[TBD]** set up
forwarding for this alias (mirrors the `privacy@pare.money` step in PHASE4).
