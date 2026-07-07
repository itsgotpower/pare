/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * The daily SimpleFIN cron: worker.ts's `scheduled()` handler calls this once
 * per trigger (wrangler.full.toml `[triggers] crons`). It scans the D1
 * `simplefin_integration` table and runs the SAME sync core the routes use
 * (lib/simplefin/sync.ts) for every user whose integration is due — the core's
 * auto gate (autoSync on, last success >20h old, 1h attempt cooldown) is the
 * single source of truth for "due", so a user who already synced today via the
 * dashboard trigger is skipped here for free.
 *
 * Constraints inherited from the queue consumer's hard-won lesson: inside a
 * scheduled() invocation getCloudflareContext() is not reliably available, so
 * EVERYTHING resolves off the `env` parameter — D1 via env.DB (threaded into
 * resolvePlanFrom / the config store), the per-user repo via env.USER_DATA
 * (threaded into getRepoForUser). Never call getD1()/getScopedRepo() here.
 *
 * Per-user failures are isolated: one revoked token or hiccuping bridge must
 * not stop the rest of the fleet's daily sync. Users are processed
 * sequentially — the bridge quota is per user (so parallelism buys little) and
 * a slow trickle is kinder to the bridge than a thundering herd.
 */

import {
  d1SimplefinStore,
  listSimplefinIntegrations,
} from "@/lib/simplefin/config-store";
import { runSimplefinSync } from "@/lib/simplefin/sync";
import { getRepoForUser, type DoNamespaceLike } from "@/lib/repo";
import type { D1Like } from "@/lib/auth/hosted";
import { checkAccountLimit, hasFeature } from "../billing/enforce";
import { resolvePlanFrom } from "../billing/store";

export interface SimplefinCronEnv {
  DB: unknown; // D1 auth database (simplefin_integration + subscription)
  USER_DATA: unknown; // per-user Durable Object namespace
}

export interface SimplefinCronReport {
  integrations: number;
  synced: number;
  skipped: number;
  failed: number;
}

export async function scheduledSimplefinSync(
  env: SimplefinCronEnv
): Promise<SimplefinCronReport> {
  const db = env.DB as D1Like;
  const ns = env.USER_DATA as DoNamespaceLike;
  const report: SimplefinCronReport = { integrations: 0, synced: 0, skipped: 0, failed: 0 };

  const integrations = await listSimplefinIntegrations(db);
  report.integrations = integrations.length;

  for (const { userId } of integrations) {
    try {
      // Entitlement re-check every run: a user who connected on Plus and later
      // downgraded stops syncing (the connection stays visible on the card so
      // they can disconnect or re-upgrade). hasFeature reads PARE_CLOUD; on a
      // non-cloud hosted deploy it allows everything, matching the routes.
      const planId = await resolvePlanFrom(db, userId);
      if (!hasFeature(planId, "simplefin")) {
        report.skipped++;
        continue;
      }

      const repo = await getRepoForUser(userId, ns);
      const result = await runSimplefinSync(repo, d1SimplefinStore(db, userId), {
        auto: true,
        accountGate: (newSource, existingSources) =>
          checkAccountLimit({ planId, existingSources: [...existingSources], newSource }),
      });

      if (result.kind === "ok") report.synced++;
      else if (result.kind === "fetch_error") report.failed++;
      else report.skipped++;
    } catch (err) {
      report.failed++;
      // userId is safe to log; access URLs never are (and aren't in scope here).
      console.error(
        `[simplefin cron] sync failed for user ${userId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[simplefin cron] ${report.synced} synced, ${report.skipped} skipped, ` +
      `${report.failed} failed of ${report.integrations} integrations`
  );
  return report;
}
