---
title: "Is Plaid safe? What connecting your bank actually shares"
description: "When an app asks to 'securely connect your bank,' that's usually Plaid. Here's what Plaid does, what it can access, and why 'is it safe' is the wrong question."
publishedAt: "2026-07-18"
keywords:
  - "is Plaid safe"
  - "Plaid alternative"
  - "what does Plaid do"
  - "Plaid privacy"
  - "is Plaid secure"
  - "personal finance without Plaid"
canonical: "https://pare.money/blog/is-plaid-safe"
---

When a budgeting app asks you to "securely connect your bank," the company behind that box is usually Plaid. So people search the obvious thing: is Plaid safe? It's a fair question with a frustrating answer — Plaid is careful and well-funded, and "safe" is still the wrong frame. The question that actually helps you is narrower: what access did you just grant, and to whom? We make Pare, an app that deliberately doesn't use Plaid, so read this with that in mind — but the mechanics below are just how the thing works.

## What Plaid actually is

Plaid is a data aggregator — the middle company that sits between a finance app and your bank. The app you signed up for usually doesn't build its own connection to hundreds of banks; it hands that job to Plaid, which holds connections to a huge number of accounts in one place. When you "link your bank" in most apps, you're really linking to Plaid, and Plaid links to your bank on the app's behalf.

There are two ways that link is built, and you rarely get to choose which:

- **Credential-based.** You type your bank username and password into Plaid's screen. Plaid stores a credential or a derived token and logs in as you, on a schedule, to pull your transactions. If your bank has no formal API, this is the fallback.
- **OAuth / token-based.** The bank shows you its own login, you approve access there, and Plaid receives a scoped token instead of your raw password. This is the newer, better version, and it's what everyone points to when they say your credentials are safe.

## So is it "safe"?

On the axis people usually mean — is Plaid a careful security company — the honest answer is broadly yes. It encrypts data in transit, a revocable OAuth token beats a stored password, and Plaid doesn't make money showing you ads against your spending. If your worry is "will this company get casually breached tomorrow," Plaid is not a reckless operator.

Two things get lost in that reassurance, though.

The first is **breadth**. A bank connection isn't a narrow pipe. Depending on what the app requests, Plaid can read your balances, full transaction history, and in some cases account and routing numbers and identity details. The permission is wide by default because the apps on top of it want to do many things.

The second is **scope over time**. In 2022, Plaid settled a class-action lawsuit for a reported $58 million over allegations that it collected more financial data than it needed and stored bank login credentials. That wasn't a breach story — nobody's accounts were drained — but it was a scope story, and scope is exactly the thing "is it encrypted?" doesn't answer. (The details are a matter of public record; look them up rather than taking our summary as the last word.)

## The question "safe" is hiding

Here's the thing a yes-or-no on safety skips: a Plaid connection is a **standing, automated line into your bank, held by a company you never signed up with directly, that tends to outlive your attention.**

You linked one app. Plaid now has a connection it can maintain. Delete the app, and the connection often keeps sitting in a dashboard you've never seen until someone remembers to cut it off. Companies also get acquired, change terms, and fold — and the access you granted a friendly budgeting startup comes along for whatever ride that company takes next. None of that is hypothetical; it's the ordinary lifecycle of software applied to a key that happens to open your bank account. We walked through that full argument in [why we don't connect to your bank](/blog/why-we-dont-connect-to-your-bank).

## What you can actually do about it

If you've already connected accounts through Plaid and this has you wanting to take stock, you're not stuck. Plaid runs a consumer portal (at my.plaid.com — check their site for the current address, it's changed before) where you can see which apps you've linked to your financial accounts and disconnect the ones you don't recognize or no longer use. It's worth a look even if you're staying put: most people find at least one connection to an app they forgot they'd ever linked.

Disconnecting there cuts the aggregator's side of the access. Separately, it's worth removing the connection inside the app itself, and — for the thorough version — checking whether your bank keeps its own list of authorized third parties you can prune. The same connection can live in more than one place, and that diffuseness is exactly what makes "is Plaid safe" hard to answer with a clean yes or no: the access isn't in one spot you can point at.

## The alternative: don't grant the access at all

The cleanest way to keep a third party from holding a line into your bank is to never open one. Your bank already produces an authoritative record every month — your statement — and you can download it yourself without giving anyone a password.

That's what Pare reads. You drop in a PDF or OFX statement, and it parses every transaction, categorizes it, and builds the trends, forecasts, and subscription alerts on top, all in a single file on your own machine. No Plaid, no stored login, nothing scraping your account in the background. Pare does offer an optional sync for people who want it, but it runs through SimpleFIN — a bridge you sign up for and pay directly, so the connection answers to you, and Pare never sees your bank credentials either way.

## The honest trade-offs

Not using Plaid costs you something real, and pretending otherwise would be its own kind of dishonesty:

- **No real-time balances.** Statements lag the calendar, so the current month is always a little incomplete. If you need your balance to the minute, your bank's own app does that better than any third party.
- **You do the downloading.** Once a month you fetch statements and drop them in. It's a few minutes, and it's undeniably more work than a feed that updates itself.

If those are dealbreakers, a Plaid-based app is a legitimate choice — the point of this post isn't that connecting is reckless.

## When a Plaid-based app is the right call

If you have many accounts, you want balances that update on their own, and you've decided a standing connection held by a careful third party is an acceptable trade, then an aggregator-based app is the right tool and you should use one without guilt. The goal here isn't fear. It's that you get to make that trade on purpose, with the breadth and the lifespan of the connection in view — not because a button said "securely connect" and you clicked it.

If you'd rather not open the connection in the first place, the practical starting point is getting your history out of wherever it lives now — we wrote a plain [switching guide](/blog/how-to-leave-mint-monarch-copilot) for exactly that. Hosted signup is open — [create an account](/login) and start on the free tier, or clone the repo and run it yourself today.
