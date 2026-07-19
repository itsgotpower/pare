---
title: "Why we don't connect to your bank (and why that's the point)"
description: "Most finance apps ask for your bank login. Here's what an aggregator actually does with it, where your credentials end up, and the case for reading statements instead."
publishedAt: "2026-06-24"
keywords:
  - "bank aggregator privacy"
  - "Plaid alternative"
  - "personal finance without bank login"
  - "does Mint sell your data"
  - "PDF statement finance app"
  - "privacy personal finance app"
canonical: "https://pare.money/blog/why-we-dont-connect-to-your-bank"
updatedAt: "2026-07-18"
tldr:
  - "\"Connecting your bank\" usually means handing your login to a data aggregator that logs in as you on a schedule."
  - "Once linked, three parties can see your history — you, the app, and the aggregator — and the connection often outlives the app."
  - "Pare reads statements you download instead; data lives in a file you own, with an optional bridge sync you control."
faq:
  - q: "What does a finance app do with your bank login?"
    a: "It usually hands your credentials to a data aggregator (Plaid, MX, Finicity, Yodlee) that logs in as you on a schedule to scrape transactions. Sometimes it's a scoped OAuth token instead of your raw password — better, but still a standing automated line into your account held by a company you never signed up with directly."
  - q: "Is a Plaid bank connection safe?"
    a: "The good aggregators are careful and spend heavily on security. The narrower point is that a live connection to your bank exists, held by someone other than you, for every app you've linked — and it often outlives the app you deleted. You can accept that trade; you just deserve to make it on purpose."
  - q: "How does Pare work without connecting to my bank?"
    a: "It reads the PDF or OFX/QFX statements you already download — authoritative records that reconcile to a real closing balance — and parses, categorizes, and charts them locally in a single file you own. No aggregator, no stored password. An optional SimpleFIN sync exists that you turn on and pay the bridge for directly."
---

Every personal-finance app opens the same way: a screen that asks you to pick your bank and type in the username and password you use for everything. It feels normal now. You do it, a spinner runs, and your transactions appear. The question nobody makes you ask is: where did that login just go, and who is holding it now?

Pare doesn't have that screen. It reads the PDF and OFX statements you already download from your bank. That's a deliberate choice, and it costs you something real — so it's worth explaining exactly what you give up and what you get back.

## What an aggregator actually does

When an app "connects to your bank," it almost never talks to your bank the way you do. It hands your credentials to a data aggregator — Plaid, MX, Finicity, Yodlee — a middle company whose entire business is standing between you and your accounts.

There are two ways that connection works, and most people never learn which one they got:

- **Credential-based.** You type your bank password into the aggregator's screen. The aggregator stores it (or a token derived from it) and logs in as you, on a schedule, to scrape your transactions. If your bank has no formal API, this is what happens.
- **OAuth / token-based.** Newer, better: the bank shows you its own login, you approve access, and the aggregator gets a scoped token instead of your raw password. This is the version everyone points to when they say credentials are safe.

The problem is that you rarely get to choose, and the marketing copy blurs the two. "Bank-level encryption" describes how the data moves, not who ends up holding the keys. A token you can revoke is genuinely better than a stored password — but it's still a standing, automated line into your account held by a company you never signed up with directly.

## Where your credentials end up

Follow the actual path. You give your login to App A. App A doesn't want to build bank integrations, so it uses Aggregator B under the hood. Aggregator B connects to your bank. Now three parties can see your transaction history: you, the app, and the aggregator — and the aggregator can see it for every app you've ever linked, not just this one.

That aggregator is now a concentrated target. It holds live access to millions of people's accounts in one place. You didn't choose it, you can't audit it, and when you delete the app, the aggregator connection often outlives it — sitting in a dashboard you've never seen, quietly pulling data until someone remembers to cut it off.

:::pare-widget
{
  "component": "Stepper",
  "props": {
    "title": "Follow the actual path",
    "steps": [
      { "title": "You hand over your login", "body": "You type your bank username and password into the app's connect screen, the same credentials you use for everything." },
      { "title": "The app passes it to an aggregator", "body": "The app doesn't build bank integrations itself — it uses a middle company (Plaid, MX, Finicity, Yodlee) under the hood." },
      { "title": "The aggregator logs into your bank", "body": "Now three parties can see your transaction history: you, the app, and the aggregator — and the aggregator sees it for every app you've ever linked." },
      { "title": "The connection outlives the app", "body": "Delete the app and the aggregator connection often lives on in a dashboard you've never seen, quietly pulling data until someone cuts it off." }
    ]
  }
}
:::

None of this means aggregators are reckless. The good ones are careful and spend heavily on security. The point is narrower: **a live connection to your bank is a thing that exists, held by someone other than you, whether or not you ever think about it again.** You can decide that's an acceptable trade. You just deserve to make that decision on purpose.

And the connection tends to outlast your attention. Companies get acquired, change their terms, pivot their business model, or fold — and your standing bank connection comes along for whatever ride the company takes next. The permission you granted a friendly budgeting startup in 2021 may now belong to whoever bought it, under terms you never read. Nothing about that is hypothetical; it's the ordinary lifecycle of software companies applied to a key that happens to open your bank account.

## What the data is worth to everyone but you

Free finance apps are rarely free. Mint was the clearest example — it cost nothing because your spending data was the product. It showed you "offers," sold your attention to card issuers and lenders, and fed an ad engine. That's not a scandal; it was in the terms. But it does answer the question of who a free tool is really built for. (We wrote more about that in [the Mint alternative built after the shutdown](/blog/pare-vs-mint).)

Aggregated transaction data is valuable precisely because it's so revealing. Where you shop, what you earn, whether your income is steady, which subscriptions you carry, whether you're building savings or slipping — all of it is legible in a transaction feed. Even when a company promises not to sell it, the data still has to sit somewhere, get backed up, and survive the next acquisition or breach. Data that doesn't exist in a third party's vault can't be sold, leaked, or repurposed later.

## The PDF-first alternative

Here's the other path. Your bank already produces a perfect, authoritative record every month: your statement. It reconciles to a real closing balance. It's the same document your bank would hand a court. And you can download it yourself, without giving anyone a password.

Pare reads those. You drop in a PDF (or an OFX/QFX export, which most banks also offer), and it parses every transaction, categorizes it with rules you can edit, and builds the trends, forecasts, net-worth history, and subscription alerts on top. Everything lands in a single SQLite file on the machine running Pare. There's no aggregator, no stored bank password, and no background process logging into your accounts.

One honest asterisk, because this post is arguing against blurry marketing: Pare does have an optional sync. It's off by default, and it works through SimpleFIN — a bridge service you sign up for and pay directly, so the connection answers to you, not to us. Pare never sees your bank login; it just reads the feed you've authorized at the bridge, and you can cut it off there any time. If you never turn it on, everything above describes Pare exactly as it comes: statements first.

Because the data lives with you, the ownership question gets simple. Want to leave? Copy the file. Want to inspect what Pare knows? It's one database you can open. Want to run the whole thing yourself and trust no hosted service at all? The code is [open source on GitHub](https://github.com/itsgotpower/pare) and self-hostable.

## The honest trade-offs

This approach is not free of cost, and pretending otherwise would be the exact kind of marketing this post is arguing against. Here's what you give up:

- **No real-time balances.** Statements lag the calendar. A statement closes, then arrives a few days later. So the current month is always partial, and Pare is honest about that everywhere it shows a number. If you need to know your balance to the minute, your bank's own app does that better than any third party.
- **You do the downloading.** Once a month, you fetch statements and drop them in. It's a few minutes. It is, undeniably, more work than a feed that updates itself. Some people will find that disqualifying. That's a fair reaction.
- **It's on you to keep going.** Nobody nudges you with a push notification the instant you overspend, because nothing is watching your account in real time. The upside is that nothing is watching your account in real time.

If those trade-offs sound intolerable, an aggregator-based app is probably the right tool for you, and that's a legitimate choice — [our Monarch comparison](/blog/pare-vs-monarch) says exactly when we'd point you there.

## Who this is (and isn't) for

Pare is built for people who would rather do a little manual work than hand a live key to their financial life to a company they didn't choose. People who want to own the file, read the code, and know that the current month being a little stale is the price of nobody scraping their account in the background.

It is not for people who want a hands-off feed that updates itself and pings them in real time. That's a real preference and we're not going to talk you out of it.

If the trade sounds right, the next practical step is getting your history out of wherever it lives now — we wrote a plain [switching guide](/blog/how-to-leave-mint-monarch-copilot) for exactly that. Hosted signup is open — [create an account](/login) and start on the free tier, or clone the repo and run it yourself today.
