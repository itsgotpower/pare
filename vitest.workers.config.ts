import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

// Vitest config for the Workers-runtime (workerd) tests that prove the live DO
// SQL data path: DoSqlBackend + the better-sqlite3-shaped adapter + the unchanged
// lib/db/* query layer + SqliteRepo, all running against a REAL ctx.storage.sql
// inside a Durable Object. Separate from the Node `tsx --test` suites (test:repo)
// because those exercise the better-sqlite3 file/blob backends, which cannot load
// in workerd. Run with: npm run test:do-sql.
export default defineWorkersConfig({
  // Mirror tsconfig's "@/*" -> project-root path alias so lib/db/profile.ts's
  // `@/lib/db` import resolves the same way under vite/workerd as it does in Next.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Both the DO-SQL data-path specs (lib/repo) and the P4 queue-consumer spec
    // (lib/queue) run inside workerd: the consumer test needs a REAL per-user DO
    // (ctx.storage.sql) plus miniflare R2 + KV, which only exist here.
    include: ["lib/repo/**/*.workers-spec.ts", "lib/queue/**/*.workers-spec.ts"],
    poolOptions: {
      workers: {
        main: "./lib/repo/test-worker.ts",
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2024-12-30",
          compatibilityFlags: ["nodejs_compat"],
          durableObjects: {
            // useSQLite enables ctx.storage.sql on this class (equivalent to
            // wrangler's `new_sqlite_classes`), which is what the adapter targets.
            TEST_SQL: { className: "TestSqlObject", useSQLite: true },
          },
          // R2 + KV for the P4 queue-consumer round-trip test: the PDF bytes live
          // in real (miniflare) R2 and the job-status records in real KV, exactly
          // the bindings the production consumer resolves off env.
          r2Buckets: { PDF_BUCKET: "pdf-bucket" },
          kvNamespaces: { PARSE_JOBS: "parse-jobs" },
        },
      },
    },
  },
});
