// SimplefinConfigStore — where a SimpleFIN connection (access URL, per-account
// classification, watermarks) lives, per deploy target:
//
//   - self-host: the gitignored data/simplefin.json file (lib/db/simplefin-config
//     owns the format; this wraps it in the async store interface).
//   - hosted:    one row per user in the D1 `simplefin_integration` table
//     (d1/migrations/0006_simplefin.sql), the whole config as a JSON blob —
//     same shape as the file, so the sync core (lib/simplefin/sync.ts) is
//     identical on both targets. A blob (not columns) because the only queries
//     are load/save/clear by userId plus the cron's full scan; if the user
//     count ever makes the scan hurt, promote autoSync/lastSyncedAt to columns.
//
// The access URL is a bearer secret on both targets: never log it, and keep it
// out of anything user-exportable (the file is outside the SQLite DB; the D1
// row is outside the user's Durable Object and its backups).

import type { D1Like } from "../auth/hosted";
import type { SimplefinConfig } from "../db/simplefin-config";
import {
  loadSimplefinConfig,
  saveSimplefinConfig,
  clearSimplefinConfig,
} from "../db/simplefin-config";

export interface SimplefinConfigStore {
  load(): Promise<SimplefinConfig | null>;
  save(config: SimplefinConfig): Promise<void>;
  clear(): Promise<void>;
}

// Self-host: data/simplefin.json.
export function fileSimplefinStore(): SimplefinConfigStore {
  return {
    async load() {
      return loadSimplefinConfig();
    },
    async save(config) {
      saveSimplefinConfig(config);
    },
    async clear() {
      clearSimplefinConfig();
    },
  };
}

function parseConfig(raw: unknown): SimplefinConfig | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.accessUrl !== "string") return null;
    return { autoSync: true, accounts: {}, ...parsed } as SimplefinConfig;
  } catch {
    return null;
  }
}

// Hosted: one D1 row per user.
export function d1SimplefinStore(db: D1Like, userId: string): SimplefinConfigStore {
  return {
    async load() {
      const row = (await db
        .prepare('SELECT "config" FROM "simplefin_integration" WHERE "userId" = ?')
        .bind(userId)
        .first()) as { config?: string } | null;
      return parseConfig(row?.config);
    },
    async save(config) {
      const now = new Date().toISOString();
      await db
        .prepare(
          'INSERT INTO "simplefin_integration" ("userId","config","createdAt","updatedAt") ' +
            "VALUES (?, ?, ?, ?) " +
            'ON CONFLICT("userId") DO UPDATE SET "config" = excluded."config", "updatedAt" = excluded."updatedAt"'
        )
        .bind(userId, JSON.stringify(config), now, now)
        .run();
    },
    async clear() {
      await db
        .prepare('DELETE FROM "simplefin_integration" WHERE "userId" = ?')
        .bind(userId)
        .run();
    },
  };
}

// Cron support: every stored integration. The due/enabled filtering happens in
// the caller (runSimplefinSync's auto gate) — this is just the scan.
export async function listSimplefinIntegrations(
  db: D1Like
): Promise<{ userId: string; config: SimplefinConfig }[]> {
  const res = (await db
    .prepare('SELECT "userId", "config" FROM "simplefin_integration"')
    .bind()
    .all()) as { results?: { userId: string; config: string }[] };
  const out: { userId: string; config: SimplefinConfig }[] = [];
  for (const row of res.results ?? []) {
    const config = parseConfig(row.config);
    if (config) out.push({ userId: row.userId, config });
  }
  return out;
}
