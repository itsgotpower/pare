import { NextRequest } from "next/server";
import { unauthorized } from "@/lib/repo/scoped";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import {
  claimAccessUrl,
  fetchSimplefinAccounts,
  guessKind,
  redactAccessUrl,
} from "@/lib/import/simplefin";
import { simplefinDisabled, type SimplefinConfig } from "@/lib/db/simplefin-config";
import {
  fileSimplefinStore,
  d1SimplefinStore,
  type SimplefinConfigStore,
} from "@/lib/simplefin/config-store";
import { runSimplefinSync, type AccountGate } from "@/lib/simplefin/sync";
import { getRepo, getRepoForUser } from "@/lib/repo";
import type { Repo } from "@/lib/repo";
import type { AccountKind } from "@/lib/db/account-kinds";

// ===========================================================================
// /api/simplefin — the opt-in SimpleFIN Bridge sync. Both deploy targets:
//
//   GET                      → connection status (never includes the access URL)
//   POST { action: "claim", token }        → claim a setup token, discover accounts
//   POST { action: "configure", accounts?, autoSync? } → classify accounts / toggle
//   POST { action: "sync", auto? }         → fetch + ingest; auto=true no-ops
//                                            unless the watermark says a sync is due
//   POST { action: "disconnect" }          → forget the connection (rows stay)
//
// SELF-HOST: connection state in gitignored data/simplefin.json; no plan gates;
// fresh rows fire the web-push + safe-to-spend heads-up.
//
// HOSTED: connection state in D1 `simplefin_integration` (one row per user);
// connecting requires the `simplefin` plan feature (402 + upgrade flag when the
// plan lacks it — cloud/billing is loaded dynamically at this composition root,
// the AGPL core never imports it); syncing enforces the per-plan ACCOUNT cap
// per NEW source (over-cap accounts are skipped with a PLAN CAP notice in
// `errors`, never silently dropped). The daily cron (cloud/simplefin/scheduled)
// runs the same core. No push on hosted (web-push is Node-only; /api/push 501s).
//
// PARE_SIMPLEFIN_DISABLED=1 hides the feature on either target. The middleware
// gates this route on self-host; hosted resolves the caller per request.
// ===========================================================================

const DISABLED_404 = () =>
  Response.json({ error: "SimpleFIN is disabled." }, { status: 404 });

interface Ctx {
  repo: Repo;
  store: SimplefinConfigStore;
  hosted: boolean;
  userId: string | null;
}

// Resolve the caller's repo + config store for the active deploy target.
async function resolveCtx(request: NextRequest): Promise<Ctx | null> {
  if (!isHostedMode()) {
    // Self-host: the middleware session gate fronts the route; single user.
    return { repo: await getRepo(), store: fileSimplefinStore(), hosted: false, userId: null };
  }
  const { createHostedAuth } = await import("@/lib/auth/hosted");
  const { getD1 } = await import("@/lib/auth/d1");
  const d1 = await getD1();
  const resolved = await resolveUser(request, createHostedAuth(d1));
  if (!resolved) return null;
  return {
    repo: await getRepoForUser(resolved.userId),
    store: d1SimplefinStore(d1, resolved.userId),
    hosted: true,
    userId: resolved.userId,
  };
}

// Whether the hosted caller's plan unlocks SimpleFIN. Fail OPEN on billing-infra
// errors (same posture as the upload route) — never lock a paying user out
// because the billing store hiccuped.
async function planAllowsSimplefin(userId: string): Promise<boolean> {
  try {
    const { requireFeature } = await import("@/cloud/billing/gate");
    return await requireFeature(userId, "simplefin");
  } catch (err) {
    console.warn(
      "[billing] simplefin feature check failed open:",
      err instanceof Error ? err.message : err
    );
    return true;
  }
}

// The hosted per-plan ACCOUNT cap, applied per NEW source inside the sync core.
// Fail-open shape mirrors planAllowsSimplefin.
async function hostedAccountGate(userId: string): Promise<AccountGate | undefined> {
  try {
    const { checkAccountLimit } = await import("@/cloud/billing/enforce");
    const { resolvePlan } = await import("@/cloud/billing/store");
    const planId = await resolvePlan(userId);
    return (newSource, existingSources) =>
      checkAccountLimit({ planId, existingSources: [...existingSources], newSource });
  } catch (err) {
    console.warn(
      "[billing] simplefin account gate failed open:",
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}

function statusPayload(config: SimplefinConfig | null, upgradeRequired = false) {
  if (!config) return { connected: false as const, upgradeRequired };
  return {
    connected: true as const,
    upgradeRequired: false,
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
  if (simplefinDisabled()) return DISABLED_404();
  const ctx = await resolveCtx(request);
  if (!ctx) return unauthorized();

  const config = await ctx.store.load();
  // Surface the upsell to signed-in hosted users whose plan lacks the feature
  // (the card renders an UPGRADE link instead of the connect form). An existing
  // connection still reports its status — downgraded users can see + disconnect.
  const upgradeRequired =
    ctx.hosted && !config ? !(await planAllowsSimplefin(ctx.userId!)) : false;
  return Response.json(statusPayload(config, upgradeRequired));
}

export async function POST(request: NextRequest) {
  if (simplefinDisabled()) return DISABLED_404();
  const ctx = await resolveCtx(request);
  if (!ctx) return unauthorized();

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
        return await handleClaim(ctx, body.token ?? "");
      case "configure":
        return await handleConfigure(ctx, body.accounts ?? {}, body.autoSync);
      case "sync":
        return await handleSync(ctx, !!body.auto);
      case "disconnect":
        await ctx.store.clear();
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
async function handleClaim(ctx: Ctx, token: string) {
  if (!token.trim()) {
    return Response.json({ error: "Paste a setup token first." }, { status: 400 });
  }
  if (await ctx.store.load()) {
    return Response.json(
      { error: "Already connected — disconnect first." },
      { status: 409 }
    );
  }
  // Hosted: connecting is the Plus-gated step (server-side; the card's gating
  // is cosmetic). 402 carries `upgrade` so the client links to /pricing.
  if (ctx.hosted && !(await planAllowsSimplefin(ctx.userId!))) {
    return Response.json(
      { error: "SimpleFIN sync is a Plus feature.", upgrade: true },
      { status: 402 }
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
  await ctx.store.save(config);
  return Response.json(statusPayload(config));
}

// Update per-account classification/enablement and the auto-sync toggle. A
// kind is frozen once the account has synced rows (changing it would fork the
// account's history across two kinds — reconnect to reclassify).
async function handleConfigure(
  ctx: Ctx,
  updates: Record<string, { kind?: AccountKind; enabled?: boolean }>,
  autoSync?: boolean
) {
  const config = await ctx.store.load();
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

  await ctx.store.save(config);
  return Response.json(statusPayload(config));
}

async function handleSync(ctx: Ctx, auto: boolean) {
  const result = await runSimplefinSync(ctx.repo, ctx.store, {
    auto,
    accountGate: ctx.hosted ? await hostedAccountGate(ctx.userId!) : undefined,
    onFreshRows: ctx.hosted ? undefined : notifyFreshRows(ctx.repo),
  });

  switch (result.kind) {
    case "not_connected":
      return Response.json({ error: "Not connected." }, { status: 400 });
    case "skipped":
      return Response.json({ skipped: true });
    case "fetch_error":
      return Response.json({ error: result.message }, { status: 502 });
    case "ok":
      return Response.json({
        inserted: result.inserted,
        skipped: result.skipped,
        total: result.total,
        errors: result.errors,
        lastSyncedAt: result.lastSyncedAt,
      });
  }
}

// Self-host only: fresh rows landed without the user touching /upload — tell
// them (and warn if the projection now dips below zero), mirroring the PDF
// upload path. Fire-and-forget; web-push is Node-only, so hosted never wires this.
function notifyFreshRows(repo: Repo) {
  return (inserted: number, skipped: number) => {
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
  };
}
