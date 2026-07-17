---
title: "How to leave Mint, Monarch, or Copilot: a switching guide"
description: "A step-by-step guide to exporting your data from Mint, Monarch, and Copilot, downloading the statements that matter, and moving into Pare — with honest caveats."
publishedAt: "2026-06-30"
keywords:
  - "export Monarch data"
  - "export Copilot data"
  - "leave Mint"
  - "switch personal finance app"
  - "migrate financial data"
  - "personal finance app switching guide"
canonical: "https://pare.money/blog/how-to-leave-mint-monarch-copilot"
---

The thing that keeps you locked into a finance app isn't the features — it's your history. Years of categorized transactions feel too painful to abandon, so you stay. This guide is about breaking that lock: how to get your data out of Mint, Monarch, and Copilot, what to grab from your banks directly, and how it comes into Pare. It's practical and it's honest about the parts you can't bring with you.

Do the export step **now**, even if you haven't decided where you're going. Access to your old app can lapse, and a CSV sitting on your drive costs nothing to keep.

## First principle: statements are the durable copy

Before touching any app export, download your **PDF (or OFX/QFX) statements** from each bank and card, as far back as they let you. Here's why they matter more than any app's export:

- They're authoritative — they reconcile to a real closing balance.
- They don't depend on any third party staying in business.
- They carry the real per-transaction dates and full merchant descriptions, which app exports sometimes trim.

Most banks keep 12 months to 7 years of statements online, usually under "Statements & documents." Grab them all. This is the copy of your financial history that no company can revoke, and it's exactly what Pare is built to read.

## Leaving Monarch

Monarch has a clean export.

1. Open Monarch on the web (the browser app exports more completely than mobile).
2. Go to **Settings → Data → Export**, or open a transactions view and use the export option there.
3. Download the **transactions CSV**. It includes your categories, which is the part worth keeping.
4. While you're in Settings, note your account list so you remember which is a card vs. chequing when you import.

Monarch's CSV gives you full history plus your categorization work — the most complete export of the three.

## Leaving Mint

Mint shut down in March 2024 and its features were folded into Credit Karma, so there are two cases:

- **You still have a Mint CSV** you exported before the shutdown. Great — that's your best Mint copy. Use it.
- **You don't.** Then Credit Karma is where your Mint-era data landed, and its export is more limited than Mint's was. Pull whatever transaction history it will give you, and treat your **bank statements** (from the first principle above) as the real source of truth for anything Credit Karma won't hand over.

If you're a Mint refugee specifically, it's worth understanding why the replacements haven't felt right — we wrote that up in [the Mint alternative built after the shutdown](/blog/pare-vs-mint).

## Leaving Copilot

Copilot is an Apple-only, subscription app (around $95/year), and it exports too.

1. Open Copilot on iOS or Mac.
2. Go to **Settings / Account → Export Data**.
3. Export the **transactions CSV**.

Copilot's categories and any custom rules you built won't map one-to-one onto another app — that's true of every migration, not a Copilot quirk. Export the raw transactions and plan to re-tag a bit on the other side.

## Getting it into Pare

Pare takes your data two ways, and you'll usually use both:

- **The CSV import**, for your history. Pare reads Monarch, Mint, and YNAB exports directly — it auto-detects the source, maps categories to Pare's, and lets you confirm which account is a card vs. chequing before anything is written. This is how you bring years of past transactions and your existing categorization in one shot.
- **PDF / OFX statements**, for everything else and for going forward. Drop in the statements you downloaded, and Pare parses them into clean, deduplicated transactions. Each month after, you add the new statement.

The two are designed not to fight each other: if your CSV history overlaps with a statement you also upload, Pare deduplicates so a transaction isn't counted twice. Everything lands in a single database file on the machine running Pare — no bank connection, no aggregator. (If you're wondering why it works that way, that's the whole argument in [why we don't connect to your bank](/blog/why-we-dont-connect-to-your-bank).)

A note on timing: Pare's hosted version is in early access, so the import runs once you're in. If you'd rather not wait, Pare is open source — you can [run it yourself from GitHub](https://github.com/itsgotpower/pare) today. Either way, do the exports now so the data is ready when you are.

## What you can't bring with you

Here's the honest part, because a migration guide that promises a perfect copy is lying to you.

- **History older than your records.** Pare doesn't reach into your bank to pull the past — it reads what you give it. If your app export and your downloadable statements only go back three years, then three years is what you have. Anything older than the oldest statement your bank still hosts is gone, and no tool can conjure it back.
- **Categories won't map perfectly.** Every app has its own category names and rules. An import gets you most of the way, but you'll spend a little time re-tagging edge cases and rebuilding a few rules. Budget maybe fifteen minutes for it, not an afternoon.
- **App-specific extras.** Goals, budgets, notes, split-transaction quirks, and other app-specific structures generally don't transfer cleanly between any two finance apps. Your transactions and categories travel; the scaffolding around them usually doesn't.

None of this is unique to Pare — it's the physics of moving between finance tools. The advantage of the statement-first approach is that once your data is in Pare, it's in a file *you* hold, so this is the last migration where you're at the mercy of someone else's export button.

## Keep the old app as insurance for a month

Don't cancel your old subscription or delete your old account the day you export. Overlap them for a month. Do one real monthly review in Pare, confirm your history imported the way you expected, and check that the categories and totals look right against what your old app showed. Only once you've verified Pare has what you need should you cancel the subscription or close the account.

This costs you at most one extra month of a subscription you were leaving anyway, and it saves you from the worst-case switch: deleting the old copy, then discovering the export was incomplete. Exports are your safety net — keep the net up until you've landed.

## A two-minute pre-switch checklist

Before you consider yourself moved, confirm you have:

- Every transaction CSV your old app will export.
- PDF or OFX statements from each bank and card, back as far as they're offered.
- A note of which accounts are cards vs. chequing/savings, so the import maps them correctly.
- A spot-check that your imported totals roughly match a month you remember.

If all four are true, you're not locked into anything anymore — and that was the whole point.

## After you switch

Once your history is in and your statements are flowing, the habit that makes it all worthwhile is a short, regular look — not obsessive balance-checking. We wrote up exactly that routine in [the 10-minute monthly review](/blog/the-10-minute-monthly-review).

Pare's hosted version is free to start — [create an account](/login?signup=1) whenever you're ready, no card needed. Export your data today regardless — future you will be glad the CSV is already sitting on your drive.
