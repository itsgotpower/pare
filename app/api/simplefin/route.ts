import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { isHostedMode } from "@/lib/auth/resolve";
import {
  claimAccessUrl,
  fetchSimplefinAccounts,
  toOfxImport,
  guessKind,
  simplefinSource,
  redactAccessUrl,
  type SimplefinAccountSet,
} from "@/lib/import/simplefin";
import {
  loadSimplefinConfig,
  saveSimplefinConfig,
  clearSimplefinConfig,
  simplefinDisabled,
  type SimplefinConfig,
} from "@/lib/db/simplefin-config";
import { insertOfxImport } from "@/lib/repo/insert-ofx";
import type { Repo } from "@/lib/repo";
import type { AccountKind } from "@/lib/db/account-kinds";

// ===========================================================================
// /api/simplefin — the opt-in SimpleFIN Bridge sync (self-host only).
//
//   GET                      → connection status (never includes the access URL)
//   POST { action: "claim", token }        → claim a setup token, discover accounts
//   POST { action: "configure", accounts?, autoSync? } → classify accounts / toggle
//   POST { action: "sync", auto? }         → fetch + ingest; auto=true no-ops
//                                            unless the watermark says a sync is due
//   POST { action: "disconnect" }          → forget the connection (rows stay)
//
// Hosted mode gets a clean 501 (like /api/push) until the Phase-2 D1 +
// cron work lands; PARE_SIMPLEFIN_DISABLED=1 hides the feature entirely.
// The middleware gates this route (not in PUBLIC_PATHS).
// ===========================================================================

const HOSTED_501 = () =>
  Response.json(
    { error: "SimpleFIN sync is not available on hosted yet." },
    { status: 501 }
  );
const DISABLED_404 = () =>
  Response.json({ error: "SimpleFIN is disabled." }, { status: 404 });

// Auto-sync cadence: the bridge refreshes roughly daily and allows ~24
// requests/day — sync when the last SUCCESS is >20h old, with a 1h cooldown
// after any attempt so a failing bridge isn't hammered on every page load.
const AUTO_SYNC_AFTER_MS = 20 * 60 * 60 * 1000;
const ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;

// First connect backfills this far, in ≤90-day windows (the bridge's cap).
const BACKFILL_DAYS = 360;
const WINDOW_DAYS = 90;

function statusPayload(config: SimplefinConfig | null) {
  if (!config) return { connected: false as const };
  return {
    connected: true as const,
    bridge: redactAccessUrl(config.accessUrl),
    autoSync: config.autoSync,
    lastSyncedAt: config.lastSyncedAt ?? null,
    lastSyncStatus: config.lastSyncStatus ?? null,
    lastSyncErrors: config.lastSyncErrors ?? [],
    accounts: Object.entries(config.accounts).map(([id, a]) => ({
      id,
      name: a.name,
      org: a.org ?? null,
      currency: a.currency ?? null,
      kind: a.kind,
      enabled: a.enabled,
      synced: !!a.synced,
    })),
  };
}

export async function GET(request: NextRequest) {
  if (isHostedMode()) return HOSTED_501();
  if (simplefinDisabled()) return DISABLED_404();
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  return Response.json(statusPayload(loadSimplefinConfig()));
}

export async function POST(request: NextRequest) {
  if (isHostedMode()) return HOSTED_501();
  if (simplefinDisabled()) return DISABLED_404();
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  let body: {
    action?: string;
    token?: string;
    autoSync?: boolean;
    auto?: boolean;
    accounts?: Record<string, { kind?: AccountKind; enabled?: boolean }>;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "claim":
        return await handleClaim(body.token ?? "");
      case "configure":
        return handleConfigure(body.accounts ?? {}, body.autoSync);
      case "sync":
        return await handleSync(repo, !!body.auto);
      case "disconnect":
        clearSimplefinConfig();
        return Response.json({ connected: false });
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    // Never echo the access URL: our own errors already redact, and a network
    // failure's message only contains the (credential-free) host.
    const message = err instanceof Error ? err.message : "SimpleFIN request failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// Claim the one-time setup token, then hit /accounts once (no window → the
// bridge returns current balances + recent transactions) purely to DISCOVER
// the accounts so the user can classify them. Nothing is ingested here.
async function handleClaim(token: string) {
  if (!token.trim()) {
    return Response.json({ error: "Paste a setup token first." }, { status: 400 });
  }
  if (loadSimplefinConfig()) {
    return Response.json(
      { error: "Already connected — disconnect first." },
      { status: 409 }
    );
  }

  const accessUrl = await claimAccessUrl(token);
  const set = await fetchSimplefinAccounts(accessUrl);

  const config: SimplefinConfig = {
    accessUrl,
    autoSync: true,
    accounts: {},
    lastSyncErrors: set.errors,
  };
  for (const acct of set.accounts) {
    config.accounts[acct.id] = {
      name: acct.name || acct.id,
      org: acct.org?.name,
      currency: acct.currency,
      kind: guessKind(acct.name || ""),
      enabled: true,
    };
  }
  saveSimplefinConfig(config);
  return Response.json(statusPayload(config));
}

// Update per-account classification/enablement and the auto-sync toggle. A
// kind is frozen once the account has synced rows (changing it would fork the
// account's history across two kinds — reconnect to reclassify).
function handleConfigure(
  updates: Record<string, { kind?: AccountKind; enabled?: boolean }>,
  autoSync?: boolean
) {
  const config = loadSimplefinConfig();
  if (!config) {
    return Response.json({ error: "Not connected." }, { status: 400 });
  }

  const KINDS: AccountKind[] = ["card", "chequing", "savings", "investment"];
  for (const [id, patch] of Object.entries(updates)) {
    const acct = config.accounts[id];
    if (!acct) continue;
    if (patch.kind && KINDS.includes(patch.kind) && !acct.synced) {
      acct.kind = patch.kind;
    }
    if (typeof patch.enabled === "boolean") acct.enabled = patch.enabled;
  }
  if (typeof autoSync === "boolean") config.autoSync = autoSync;

  saveSimplefinConfig(config);
  return Response.json(statusPayload(config));
}

async function handleSync(repo: Repo, auto: boolean) {
  const config = loadSimplefinConfig();
  if (!config) {
    return Response.json({ error: "Not connected." }, { status: 400 });
  }

  if (auto) {
    const now = Date.now();
    const lastOk = config.lastSyncedAt ? Date.parse(config.lastSyncedAt) : 0;
    const lastTry = config.lastAttemptAt ? Date.parse(config.lastAttemptAt) : 0;
    if (
      !config.autoSync ||
      now - lastOk < AUTO_SYNC_AFTER_MS ||
      now - lastTry < ATTEMPT_COOLDOWN_MS
    ) {
      return Response.json({ skipped: true });
    }
  }

  config.lastAttemptAt = new Date().toISOString();

  let set: SimplefinAccountSet;
  try {
    set = await fetchWindows(config);
  } catch (err) {
    config.lastSyncStatus =
      err instanceof Error ? err.message : "Bridge request failed";
    saveSimplefinConfig(config);
    return Response.json({ error: config.lastSyncStatus }, { status: 502 });
  }

  await repo.categories.seed();
  const { imp } = toOfxImport(set, config.accounts);

  // One insertOfxImport per account so each statement row keeps a STABLE
  // filename (`<source>.sync`) — the UPSERT-by-filename is what refreshes the
  // balance anchor in place instead of accreting rows sync after sync.
  const sourceToId = new Map(
    Object.keys(config.accounts).map((id) => [simplefinSource(id), id])
  );
  let inserted = 0;
  let skipped = 0;
  let total = 0;
  for (const acct of imp.accounts) {
    const r = await insertOfxImport(repo, `${acct.source}.sync`, {
      accounts: [acct],
    });
    inserted += r.inserted;
    skipped += r.skipped;
    total += r.total;
    const id = sourceToId.get(acct.source);
    if (id) config.accounts[id].synced = true;
  }

  config.lastSyncedAt = new Date().toISOString();
  config.lastSyncStatus = "ok";
  config.lastSyncErrors = set.errors;
  saveSimplefinConfig(config);

  if (inserted > 0) notifyFreshData(repo, inserted, skipped);

  return Response.json({
    inserted,
    skipped,
    total,
    errors: set.errors,
    lastSyncedAt: config.lastSyncedAt,
  });
}

// Floor to UTC midnight. Dedup keys are CONTENT-positional with a per-fetch
// seq (see toOfxImport) — the seq numbering is only sound when every fetch
// sees whole days, so a window boundary can never slice a same-day group of
// identical-content transactions.
function utcMidnight(ms: number): Date {
  return new Date(Math.floor(ms / 86400_000) * 86400_000);
}

// Incremental: one request from the watermark minus a 7-day overlap (dedup
// makes the overlap free). First sync: BACKFILL_DAYS in ≤90-day windows,
// newest first, merging per-account transaction lists.
async function fetchWindows(config: SimplefinConfig): Promise<SimplefinAccountSet> {
  const now = new Date();

  if (config.lastSyncedAt) {
    const start = utcMidnight(
      Math.max(
        Date.parse(config.lastSyncedAt) - 7 * 86400_000,
        now.getTime() - WINDOW_DAYS * 86400_000
      )
    );
    return fetchSimplefinAccounts(config.accessUrl, { startDate: start, endDate: now });
  }

  // Backfill windows are STRICTLY DISJOINT (older windows end 1s before the
  // next boundary), so no transaction can arrive twice and the merge is a
  // plain concat. Merging by bridge txn id is NOT an option — ids are
  // request-unstable on the demo bridge (see toOfxImport), and a missed merge
  // would double-insert boundary rows. Newest window first, so the account
  // metadata (balance) kept by first-seen-wins is the current one.
  const merged = new Map<string, SimplefinAccountSet["accounts"][number]>();
  const errors: string[] = [];

  for (let back = 0; back < BACKFILL_DAYS; back += WINDOW_DAYS) {
    const end =
      back === 0
        ? now
        : new Date(utcMidnight(now.getTime() - back * 86400_000).getTime() - 1000);
    const start = utcMidnight(now.getTime() - (back + WINDOW_DAYS) * 86400_000);
    const set = await fetchSimplefinAccounts(config.accessUrl, {
      startDate: start,
      endDate: end,
    });
    errors.push(...set.errors.filter((e) => !errors.includes(e)));
    for (const acct of set.accounts) {
      const existing = merged.get(acct.id);
      if (!existing) {
        merged.set(acct.id, { ...acct, transactions: [...(acct.transactions ?? [])] });
      } else {
        existing.transactions.push(...(acct.transactions ?? []));
      }
    }
  }

  return { accounts: [...merged.values()], errors };
}

// Fresh rows landed without the user touching /upload — tell them (and warn if
// the projection now dips below zero), mirroring the PDF upload path.
function notifyFreshData(repo: Repo, inserted: number, skipped: number) {
  void import("@/lib/push/webpush")
    .then(({ sendPushToAll }) =>
      sendPushToAll({
        title: "SimpleFIN sync",
        body: `${inserted} new transactions synced${skipped > 0 ? `, ${skipped} duplicates skipped` : ""}.`,
        url: "/dashboard",
      })
    )
    .catch(() => {});

  void (async () => {
    const fc = await repo.cashflowForecast.get();
    if (!fc) return;
    const { deriveSafeToSpend } = await import("@/lib/safe-to-spend");
    const s = deriveSafeToSpend(fc);
    if (s?.status !== "short") return;
    const { formatCurrency, formatDayShort } = await import("@/lib/format");
    const { sendPushToAll } = await import("@/lib/push/webpush");
    await sendPushToAll({
      title: "Forecast heads-up",
      body: `Projected ${formatCurrency(Math.abs(s.cushion))} below zero around ${formatDayShort(s.lowestDate)}, before the next payday.`,
      url: "/dashboard",
    });
  })().catch(() => {});
}
