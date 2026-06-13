import type { D1Like } from "./hosted";

// Resolve the D1 database binding for the current request.
//
// On Cloudflare Workers (hosted target, via @opennextjs/cloudflare), D1 lives
// on the per-request env as `env.DB`. We import getCloudflareContext lazily so
// this module loads fine in the plain Node/dev runtime where that package
// isn't installed.
//
// Local/dev fallback: wrap the existing better-sqlite3 file DB (lib/db) in a
// tiny D1-compatible shim so the hosted auth path can be exercised end-to-end
// without a Worker. This is dev/test plumbing only — production always uses the
// real D1 binding.

export async function getD1(): Promise<D1Like> {
  // Try the Workers binding first.
  try {
    // @ts-expect-error optional dep, only present on the Cloudflare target
    const mod = await import("@opennextjs/cloudflare");
    const ctx = await mod.getCloudflareContext({ async: true });
    const db = ctx?.env?.DB;
    if (db) return db as D1Like;
  } catch {
    // Not on Workers (or package absent) — fall through to the local shim.
  }

  const { getDb } = await import("@/lib/db");
  return makeD1Shim(getDb()) as D1Like;
}

// Minimal D1Database surface over a better-sqlite3 connection, sufficient for
// kysely-d1's D1Dialect (which calls prepare().bind().all()/run()/first() and
// batch()). Local-only; not used on the real Cloudflare target.
type BetterSqliteDb = import("better-sqlite3").Database;

function makeD1Shim(db: BetterSqliteDb) {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...args: unknown[]) {
        params = args;
        return api;
      },
      async all() {
        const results = stmt.reader ? stmt.all(...params) : [];
        if (!stmt.reader) stmt.run(...params);
        return { results, success: true, meta: {} };
      },
      async run() {
        const info = stmt.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        };
      },
      async first(col?: string) {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? (row[col] ?? null) : row;
      },
      async raw() {
        return stmt.reader ? (stmt.raw().all(...params) as unknown[]) : [];
      },
    };
    return api;
  };

  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
}
