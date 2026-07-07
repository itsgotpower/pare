import { defineConfig, devices } from "@playwright/test";
import path from "path";

// E2E harness — see .claude/skills/playwright-e2e/SKILL.md for the conventions.
//
// Isolation model: the app server Playwright boots is COMPLETELY sandboxed from
// the developer's real instance.
//   - PARE_DB_PATH points at a scratch SQLite DB under e2e/.tmp (wiped per run).
//   - The server's cwd is e2e/.tmp/cwd, NOT the repo root: user-rules.json,
//     seed-rules.json, and auth-secret all resolve from process.cwd()
//     (lib/db/user-rules.ts), so a repo-root server would seed the developer's
//     PERSONAL taxonomy (machine-dependent tests) and WRITE test rules into
//     their real data/user-rules.json. Next.js accepts the project directory as
//     an argument and does not chdir, which makes this split possible.
//   - PARE_E2E=1 skips the OpenNext/wrangler dev proxy (next.config.ts) — E2E
//     covers the self-host Node path only, and the proxy would race the
//     developer's own `npm run dev`.
//   - PARE_AUTH_SECRET is fixed so the Edge middleware can verify sessions.
//
// Server modes: `next dev` by default. Next 16 allows ONE dev server per
// project — if `npm run dev` is already running, the boot fails with Next's
// "Run kill <pid>" message; either stop it or run `E2E_PROD=1 npm run test:e2e`,
// which builds and serves the production bundle instead (no dev-instance lock).
// CI always uses the production server (the workflow builds as its own step).
const REPO = __dirname;
const TMP = path.join(REPO, "e2e", ".tmp");
const PORT = 3111;
const PROD = !!process.env.CI || !!process.env.E2E_PROD;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  // One worker: the suite shares a single server + SQLite DB, and specs reset
  // state via DELETE /api/data. Parallel workers would stomp each other's data.
  // CI still parallelizes by SHARDING (one server+DB per shard machine).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["blob"], ["github"]]
    : [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Signs in once via the API and saves the pare_session cookie; every spec
    // starts authenticated. See e2e/auth.setup.ts.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(TMP, "auth.json"),
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Fresh scratch dir per run, THEN boot — deleting the DB after the server
    // has opened it doesn't work (the connection is cached in-process; see
    // CLAUDE.md gotchas). CI's build is a separate workflow step; local
    // E2E_PROD builds inline (from the repo root — builds resolve paths there).
    command: [
      `rm -rf "${TMP}"`,
      `mkdir -p "${TMP}/cwd"`,
      ...(PROD && !process.env.CI ? [`(cd "${REPO}" && npx next build)`] : []),
      `cd "${TMP}/cwd"`,
      `exec npx next ${PROD ? "start" : "dev"} "${REPO}" -p ${PORT}`,
    ].join(" && "),
    url: `http://localhost:${PORT}/login`,
    // Never reuse: a leftover server holds an open handle to a DELETED scratch
    // DB and serves stale data.
    reuseExistingServer: false,
    timeout: 300_000, // generous: E2E_PROD runs a full `next build` first
    env: {
      PARE_E2E: "1",
      PARE_DB_PATH: path.join(TMP, "e2e.db"),
      PARE_AUTH_SECRET: "e2e-only-secret-not-production",
    },
  },
});
