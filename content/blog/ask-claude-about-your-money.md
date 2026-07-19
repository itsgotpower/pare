---
title: "Ask Claude about your money: a private finance MCP server"
description: "Pare ships a local MCP server so you can ask Claude about your own spending in plain language — and on self-host, the data never leaves your machine. Here's how it works."
publishedAt: "2026-07-18"
keywords:
  - "ask AI about finances"
  - "finance MCP server"
  - "Claude personal finance"
  - "private AI budgeting"
  - "chat with your bank statements"
  - "MCP finance tools"
canonical: "https://pare.money/blog/ask-claude-about-your-money"
---

Most finance apps make you hunt for answers by clicking through views. You want to know what you spent on restaurants last quarter, so you find the right chart, set the right date range, and read it off. Pare has those views too. But it also ships something most finance tools don't: a way to just ask, in plain language — "how much did I spend on restaurants in Q1?" — and get the answer from your actual transactions. On a self-hosted copy, that whole exchange happens without your financial data ever leaving your machine.

## What an MCP server is, and why it matters here

MCP — the Model Context Protocol — is a standard way to hand an AI assistant like Claude a set of tools it can call. Pare ships one for your finances. It gives Claude a bounded menu of tools that read (and lightly manage) *your* database: spending summaries, category breakdowns, income vs. spend, cash-flow, the discretionary baseline, detected subscriptions, goals, insights. You ask a question in normal English; Claude picks the right tool, runs it against your numbers, and answers from real data instead of guessing.

That's the important part. The assistant isn't making up plausible-sounding figures — it's calling a function that reads your transactions and reporting what came back.

## What you can actually ask

The point is that you don't have to know Pare's UI. You ask the question you actually have:

- "What did I spend on restaurants last month versus the month before?"
- "Which subscriptions went up in price this year?"
- "Was my net cash flow positive in Q1?"
- "Set a $400 monthly goal on groceries."
- "Re-tag that Amazon charge as home office."

The first three read; the last two write. Across the server there are about twenty tools — eleven that read your data and nine that manage it (goals, category rules, manual cash entries, re-tagging, deleting a mis-parsed statement).

## Grounded in your data, not guessing

There's a real difference between this and pasting a screenshot of your spending into a general chatbot and asking it to "analyze" — and it's the difference between an answer and a guess. When you paste numbers into a chat, the model works from whatever fits in that message and fills the gaps with plausible-sounding inference. When Claude has the MCP server, it doesn't have to guess: your question becomes a tool call, the tool runs a real query against your database, and the reply is built from the rows that came back.

Ask "which subscriptions went up this year?" and it isn't scanning a paragraph you pasted — it calls the subscription tool, which already knows what recurs and what stepped up in price, and reads you the list. Ask "was my net cash flow positive in Q1?" and it runs the actual cash-flow numbers instead of eyeballing them. You get to ask loosely, in the words you'd really use, and still get an answer anchored to the ledger. That's the part a chatbot with a pasted-in table can't promise: it might be right, but it can't be checked. The MCP answer traces to a query you could run yourself.

## The two ways it runs — and what each means for privacy

This is the part to be precise about, because "private AI" is a phrase people throw around loosely.

- **Self-host: a local server, no network.** Run Pare yourself and start the MCP server with `npm run mcp`. It reuses your local database and talks to Claude Code or Claude Desktop over a local connection — no outbound calls, nothing uploaded. The assistant reads your numbers where they already live, on your machine. This is the fully private version, and it's the one to pick if "my finances never leave my laptop" is the whole point.
- **Hosted: a remote connector for claude.ai.** The hosted version exposes the same tools as a claude.ai Connector, authorized through a sign-in flow. It's convenient — nothing to run — but be clear-eyed about the shape: in this mode Claude reads your data through Pare's hosted service, out of your account's isolated database, not off your own hardware. That data is never sold or used to train anything, but it isn't the same claim as the local server's "never leaves the machine."

Same tools, two honestly different privacy stories. If the locality is what you care about, self-host is the answer.

## It reads, it can tidy — it can't move money

Worth stating plainly, because handing an AI assistant access to "your finances" sounds alarming: none of these tools touch your bank, and none of them move money. Pare works off statements, so there's no payment rail wired into the app for a tool to reach. The write tools only edit things inside Pare's own database: a goal, a category rule, a transaction's label. The worst a confused prompt can do is mis-tag a charge you can fix in a click, not initiate a transfer. There's no transfer to initiate.

## A note on trust, since you're handing over the keys

Letting an assistant manage your categories and goals only works if you trust it not to make a mess, so it's worth knowing where the guardrails are. Every write is reversible from inside Pare: a goal you didn't want is one click to delete, a mis-applied rule is one click to remove, a re-tagged transaction can be re-tagged back. Nothing the assistant does leaves Pare's own database, and nothing it does is hidden — the changes show up in the same screens you'd edit by hand. In practice most people use the read tools constantly and the write tools occasionally, when it's genuinely faster to say "set a $400 grocery goal" than to click through to the goals page.

## Who this is for

If you already live in Claude, this is a genuinely different way to use a finance app — three questions, three answers, done, without opening the dashboard at all. If you don't use Claude, you're not missing the product: every one of these answers is also a view in Pare, and the MCP server is a bonus door, not the only one. It's especially natural if you already use Claude for other work and would rather your finances be one more thing you can just ask about, in the same window, instead of a separate app you have to remember to open.

## Setting it up

Pare's [/connect page](/connect) generates the exact config for your machine — the snippet for Claude Code (`~/.claude.json`) or Claude Desktop, with the right absolute paths filled in. Paste it, restart the client, and start asking. The whole thing is read/write over one local SQLite file; there's no account to create and no data to upload for the self-hosted server.

This is the same idea behind [the optional eleventh minute](/blog/the-10-minute-monthly-review) of our monthly-review routine; for a lot of people, asking three questions *is* the review. It only works this cleanly because Pare keeps your data in one local file to begin with, which is the whole argument in [why we don't connect to your bank](/blog/why-we-dont-connect-to-your-bank). Hosted signup is open, so you can [create an account](/login) or clone the repo and run the local server today.
