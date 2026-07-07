// runSimplefinSync — the SimpleFIN sync core, shared verbatim by all three
// callers: the self-host route (file store), the hosted route (D1 store +
// account-cap gate), and the hosted cron (same, per user). Everything
// deploy-specific is injected: the config store, an optional per-account gate
// (the hosted plan cap — lib/ must not import cloud/, so the gate closure is
// built at the composition root), an optional fresh-rows callback (self-host
// push), and fetch (tests).
//
// Dedup safety is inherited from the adapter (content-positional keys — see
// lib/import/simplefin.ts) plus this module's window discipline: incremental
// windows floored to UTC midnight, backfill windows strictly disjoint.

import {
  fetchSimplefinAccounts,
  toOfxImport,
  simplefinSource,
  type SimplefinAccountSet,
} from "../import/simplefin";
import { insertOfxImport } from "../repo/insert-ofx";
import type { Repo } from "../repo/types";
import type { SimplefinConfig } from "../db/simplefin-config";
import type { SimplefinConfigStore } from "./config-store";

// Auto-sync cadence: the bridge refreshes roughly daily and allows ~24
// requests/day — sync when the last SUCCESS is >20h old, with a 1h cooldown
// after any attempt so a failing bridge isn't hammered on every trigger.
export const AUTO_SYNC_AFTER_MS = 20 * 60 * 60 * 1000;
export const ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;

// First connect backfills this far, in ≤90-day windows (the bridge's cap).
const BACKFILL_DAYS = 360;
const WINDOW_DAYS = 90;

// Per-plan account cap, decided at the composition root (cloud/billing's
// checkAccountLimit on hosted; absent on self-host). Called only for sources
// that don't already have rows — an already-synced account always re-syncs.
export type AccountGate = (
  newSource: string,
  existingSources: readonly string[]
) => Promise<{ allowed: boolean; reason?: string }> | { allowed: boolean; reason?: string };

export interface SyncOptions {
  auto?: boolean;
  accountGate?: AccountGate;
  // Fired (not awaited) when new rows landed — the self-host route hangs its
  // web-push + safe-to-spend heads-up here. No-op default.
  onFreshRows?: (inserted: number, skipped: number) => void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export type SyncResult =
  | { kind: "not_connected" }
  | { kind: "skipped" } // auto sync, not due
  | { kind: "fetch_error"; message: string }
  | {
      kind: "ok";
      inserted: number;
      skipped: number;
      total: number;
      errors: string[]; // bridge errors + plan-cap notices — MUST reach the user
      lastSyncedAt: string;
    };

export async function runSimplefinSync(
  repo: Repo,
  store: SimplefinConfigStore,
  opts: SyncOptions = {}
): Promise<SyncResult> {
  const now = opts.now ? opts.now() : new Date();
  const config = await store.load();
  if (!config) return { kind: "not_connected" };

  if (opts.auto) {
    const lastOk = config.lastSyncedAt ? Date.parse(config.lastSyncedAt) : 0;
    const lastTry = config.lastAttemptAt ? Date.parse(config.lastAttemptAt) : 0;
    if (
      !config.autoSync ||
      now.getTime() - lastOk < AUTO_SYNC_AFTER_MS ||
      now.getTime() - lastTry < ATTEMPT_COOLDOWN_MS
    ) {
      return { kind: "skipped" };
    }
  }

  config.lastAttemptAt = now.toISOString();

  let set: SimplefinAccountSet;
  try {
    set = await fetchWindows(config, now, opts.fetchImpl);
  } catch (err) {
    config.lastSyncStatus = err instanceof Error ? err.message : "Bridge request failed";
    await store.save(config);
    return { kind: "fetch_error", message: config.lastSyncStatus };
  }

  await repo.categories.seed();
  const { imp } = toOfxImport(set, config.accounts);
  const errors = [...set.errors];

  // Plan-cap pass (hosted): a source that already has rows always re-syncs;
  // a NEW source must clear the gate. Existing-first ordering means known
  // accounts can never be displaced by new ones arriving in the same sync.
  const existingSources = new Set(await repo.transactions.sources());
  const ordered = [...imp.accounts].sort((a, b) => {
    const ax = existingSources.has(a.source) ? 0 : 1;
    const bx = existingSources.has(b.source) ? 0 : 1;
    return ax - bx || a.account.localeCompare(b.account);
  });

  const sourceToId = new Map(
    Object.keys(config.accounts).map((id) => [simplefinSource(id), id])
  );
  let inserted = 0;
  let skipped = 0;
  let total = 0;

  for (const acct of ordered) {
    if (opts.accountGate && !existingSources.has(acct.source)) {
      const verdict = await opts.accountGate(acct.source, [...existingSources]);
      if (!verdict.allowed) {
        errors.push(
          `PLAN CAP: ${acct.account} was not synced — ${verdict.reason ?? "account limit reached"}`
        );
        continue;
      }
    }

    // One insertOfxImport per account so each statement row keeps a STABLE
    // filename (`<source>.sync`) — the UPSERT-by-filename is what refreshes
    // the balance anchor in place instead of accreting rows sync after sync.
    const r = await insertOfxImport(repo, `${acct.source}.sync`, { accounts: [acct] });
    inserted += r.inserted;
    skipped += r.skipped;
    total += r.total;
    existingSources.add(acct.source);

    const id = sourceToId.get(acct.source);
    if (id) config.accounts[id].synced = true;
  }

  config.lastSyncedAt = now.toISOString();
  config.lastSyncStatus = "ok";
  config.lastSyncErrors = errors;
  await store.save(config);

  if (inserted > 0 && opts.onFreshRows) opts.onFreshRows(inserted, skipped);

  return {
    kind: "ok",
    inserted,
    skipped,
    total,
    errors,
    lastSyncedAt: config.lastSyncedAt,
  };
}

// Floor to UTC midnight. Dedup keys are CONTENT-positional with a per-fetch
// seq (see lib/import/simplefin.ts) — the seq numbering is only sound when
// every fetch sees whole days, so a window boundary can never slice a same-day
// group of identical-content transactions.
function utcMidnight(ms: number): Date {
  return new Date(Math.floor(ms / 86400_000) * 86400_000);
}

// Incremental: one request from the watermark minus a 7-day overlap (dedup
// makes the overlap free). First sync: BACKFILL_DAYS in ≤90-day windows,
// newest first, merging per-account.
async function fetchWindows(
  config: SimplefinConfig,
  now: Date,
  fetchImpl?: typeof fetch
): Promise<SimplefinAccountSet> {
  if (config.lastSyncedAt) {
    const start = utcMidnight(
      Math.max(
        Date.parse(config.lastSyncedAt) - 7 * 86400_000,
        now.getTime() - WINDOW_DAYS * 86400_000
      )
    );
    return fetchSimplefinAccounts(
      config.accessUrl,
      { startDate: start, endDate: now },
      fetchImpl
    );
  }

  // Backfill windows are STRICTLY DISJOINT (older windows end 1s before the
  // next boundary), so a well-behaved bridge returns each transaction in
  // exactly one window. But the merge must not TRUST that: bridge txn ids are
  // request-unstable (see lib/import/simplefin.ts), and a bridge that ignores
  // the date params would return the full history in every window — a naive
  // concat would then multiply the whole backfill. So per account we group by
  // content key (UTC day | amount | description) and keep the LARGEST group
  // seen in any SINGLE window: disjoint windows → each group lives in one
  // window and max = its true size (genuine same-day duplicates included);
  // identical windows → max = the true size again, copies collapse. Newest
  // window first, so the account metadata (balance) kept below is current.
  const errors: string[] = [];
  const accounts = new Map<string, SimplefinAccountSet["accounts"][number]>();
  const groups = new Map<string, Map<string, SimplefinAccountSet["accounts"][number]["transactions"]>>();

  for (let back = 0; back < BACKFILL_DAYS; back += WINDOW_DAYS) {
    const end =
      back === 0
        ? now
        : new Date(utcMidnight(now.getTime() - back * 86400_000).getTime() - 1000);
    const start = utcMidnight(now.getTime() - (back + WINDOW_DAYS) * 86400_000);
    const set = await fetchSimplefinAccounts(
      config.accessUrl,
      { startDate: start, endDate: end },
      fetchImpl
    );
    errors.push(...set.errors.filter((e) => !errors.includes(e)));

    for (const acct of set.accounts) {
      if (!accounts.has(acct.id)) {
        accounts.set(acct.id, { ...acct, transactions: [] });
        groups.set(acct.id, new Map());
      }
      const acctGroups = groups.get(acct.id)!;
      const windowGroups = new Map<string, typeof acct.transactions>();
      for (const t of acct.transactions ?? []) {
        const day = new Date(t.posted * 1000).toISOString().slice(0, 10);
        const key = `${day}|${t.amount}|${t.description}`;
        const g = windowGroups.get(key);
        if (g) g.push(t);
        else windowGroups.set(key, [t]);
      }
      for (const [key, txns] of windowGroups) {
        const kept = acctGroups.get(key);
        if (!kept || txns.length > kept.length) acctGroups.set(key, txns);
      }
    }
  }

  for (const [id, acct] of accounts) {
    acct.transactions = [...groups.get(id)!.values()].flat();
  }
  return { accounts: [...accounts.values()], errors };
}
