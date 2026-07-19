---
title: "How to self-host Pare (and why you might not need to)"
description: "Pare is open source and runs entirely on your own machine — zero outbound calls, your data in one file. Here's the setup, start to finish, and an honest take on who should bother."
publishedAt: "2026-07-18"
keywords:
  - "self-host personal finance"
  - "self-hosted budgeting app"
  - "run Pare locally"
  - "open source finance app"
  - "local-first finance"
  - "private finance self-host"
canonical: "https://pare.money/blog/how-to-self-host-pare"
---

Every hosted finance app asks you to trust it — the company, its servers, its promise to still be here next year. Pare's answer to that is that you don't have to: the whole app is open source, and you can run it on your own machine, where the only party with access to your financial data is you. This is the setup, start to finish. But first, the honest part, because self-hosting is a real commitment and not everyone needs it.

## First: you might not need to

The hosted version of Pare has a free tier with the full product — same parsing, same categories, same forecasts, same everything. Self-hosting doesn't unlock features; it changes *who runs the software*. So if what you want is a good private finance app and you'd rather not think about updates and backups, the hosted free tier is probably your answer, and that's a legitimate choice.

Self-host when the running-it-yourself part is the point:

- You want zero outbound calls — your data physically never leaves a machine you control.
- You'd rather not trust any hosted service, including ours.
- You already run your own tools and this is just one more.
- You're the kind of person for whom "it's on my hardware" is worth a little upkeep.

If none of those is you, close this tab and go [create a hosted account](/login) — no hard feelings.

## What self-hosting actually gets you

Self-host isn't a stripped-down demo. It's the complete product running locally: PDF and OFX statement parsing, categorization, the full dashboard, forecasts, subscription detection, and the finance MCP server. Everything lands in a single SQLite file on your machine, and with the app running locally there are no outbound calls — nothing to upload, nothing to sync unless you deliberately turn on the optional bank sync. The code is AGPL-3.0, so you can read all of it, change it, and run your modified copy.

## What you'll need

Three things, all free:

- **Node.js** (the app is Next.js 16).
- **Python 3** — the statement parser runs in Python.
- **poppler**, which provides `pdftotext`. On macOS that's `brew install poppler`; on Debian or Ubuntu, `apt install poppler-utils`.

## The setup, start to finish

Clone the repo, install, and run:

```
git clone https://github.com/itsgotpower/pare.git
cd pare
npm install
npm run dev
```

Open <http://localhost:3000>. The first run prompts you to create a profile — a name and a password — and you're in. Drop a bank or credit-card PDF (or an OFX/QFX export) onto the upload page, and Pare parses it, categorizes the transactions, and builds your dashboard. That's the core loop: statements in, insights out. Your data now lives in `data/pare.db`, a plain SQLite file you can copy, back up, or inspect any time.

For anything beyond kicking the tires, set a **`PARE_AUTH_SECRET`** environment variable — it's the signing key the auth gate uses, and setting it explicitly is what keeps your sign-in working reliably across restarts. If you want to talk to your numbers with Claude, start the finance MCP server alongside the app with `npm run mcp`; the [/connect page](/connect) generates the exact client config for your machine.

If your first upload fails with a `pdftotext`-not-found error, that's the poppler prerequisite missing — install it and try again. It's the one dependency people forget, because the app installs and runs fine without it and only trips when it goes to read a PDF.

## What "fully local" really means

Run Pare this way and, by default, nothing about your finances leaves the machine — no telemetry, no account, no sync, no outbound calls at all. The one thing that changes that is a choice you'd have to make on purpose: the optional SimpleFIN bank sync. Turn it on and Pare reaches out to the bridge you authorized to pull transactions; leave it off, which is the default, and the only way data gets in is you dropping in statements. It's worth knowing so "local" means exactly what you think it does — the app stays local until you deliberately open a door, and that door stays shut unless you open it.

## Keeping it running

The flip side of owning the software is that the upkeep is yours. It's light, but it's real:

- **Updates** are a `git pull` and a reinstall, whenever you want new features. Nothing forces an auto-update; you move when you're ready.
- **Backups** are the best thing about a single-file database: `cp data/pare.db somewhere-safe` is the whole strategy, and restoring is copying it back. Do it on a cadence you'll actually keep — a monthly copy after you upload statements is plenty.
- **Your phone still works.** Pare is an installable PWA, so once it's running you can open it in your phone's browser and add it to the home screen. Making it reachable away from home is a small networking exercise — a reverse proxy, a tunnel, or a VPN back to the machine — rather than anything Pare-specific.

## The honest trade-offs

Self-hosting moves the work to you, and that's the whole trade:

- **You run the updates.** New features land in the repo; a `git pull` and a reinstall is on you, not an automatic push.
- **You run the backups.** The upside of "it's just one file" is that backing up is `cp data/pare.db somewhere-safe`. The flip side is that nobody does it for you.
- **It's your machine's uptime.** No managed infrastructure means no one's on call but you. For a personal finance tool that you open a few times a month, that's usually fine — but it's yours to keep running.
- **A couple of conveniences are hosted-only.** The claude.ai remote MCP connector is a hosted feature; self-host uses the local stdio MCP server instead (which is arguably the more private option anyway). The hosted version also runs a managed daily bank-sync in the background, where self-host syncs when you open the app.

If reading "long-running process" and "environment variable" made you tired, that's genuinely a signal the hosted free tier is the better fit. There's no wrong answer here.

## Who should self-host

Self-host if you want the strongest version of the privacy claim — your financial data in one file, on one machine, with no third party in the loop at all — and you don't mind a few minutes of setup and the occasional update. That's the same reasoning behind [why we don't connect to your bank](/blog/why-we-dont-connect-to-your-bank), taken to its logical end: not just no aggregator, but no hosted service either.

The code is [on GitHub](https://github.com/itsgotpower/pare). Clone it and you own the whole thing — and if hosted Pare ever disappears, your self-hosted copy keeps working exactly as it did. That's the point of it being a file you hold.
