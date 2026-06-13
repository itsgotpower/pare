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
  // Try the Workers binding first via the shared getBinding helper. `DB` is wired
  // via wrangler.toml on the Cloudflare target; the generated CloudflareEnv type
  // isn't checked into source, so it's resolved untyped. When unavailable (not on
  // Workers, package absent, or binding unwired) we fall through to the local shim.
  const { getBinding } = await import("@/lib/cf-bindings");
  const binding = await getBinding<D1Like>("DB");
  if (binding) return binding;

  const { getDb } = await import("@/lib/db");
  const db = getDb();
  await ensureShimAuthSchema(db);
  // The shim is a deliberately PARTIAL D1Database surface (only what kysely-d1's
  // D1Dialect calls — prepare/bind/all/run/first/batch/exec). Now that
  // @cloudflare/workers-types resolves the full D1Database interface (it's a
  // devDep for the workers-spec typecheck gate), cast through `unknown`: the shim
  // intentionally omits methods like withSession that the auth path never uses.
  return makeD1Shim(db) as unknown as D1Like;
}

// Local hosted-dev only: the shim wraps the app's better-sqlite3 file DB, whose
// migrations (001-005) deliberately exclude the auth schema (that lives in the D1
// auth DB, d1/migrations/0001_better_auth.sql). So for `next dev` in hosted mode
// we apply that auth schema to the shim DB once. Idempotent (CREATE … IF NOT
// EXISTS). Node/dev-only: on Workers getD1() returns env.DB above and never
// reaches here, so the fs import is not exercised on the Cloudflare target.
const authSchemaApplied = new WeakSet<BetterSqliteDb>();
async function ensureShimAuthSchema(db: BetterSqliteDb): Promise<void> {
  if (authSchemaApplied.has(db)) return;
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sql = fs.readFileSync(
    path.join(process.cwd(), "d1/migrations/0001_better_auth.sql"),
    "utf-8"
  );
  db.exec(sql);
  authSchemaApplied.add(db);
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
