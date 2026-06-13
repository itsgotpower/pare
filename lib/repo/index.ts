import { FileBackend } from "./file-backend";
import { SqliteRepo } from "./sqlite-repo";
import type { Repo } from "./types";

export * from "./types";

// The process-wide Repo for local/self-host + MCP, backed by the better-sqlite3
// file singleton. Routes and the MCP server consume the app's persistence through
// this factory: `import { getRepo } from "lib/repo"`.
//
// Phase 2 replaces this with an auth-scoped, per-user factory (one Durable Object
// per user) — the Repo contract stays the same, so call sites don't change.
let _repo: Repo | null = null;

export function getRepo(): Repo {
  if (!_repo) _repo = new SqliteRepo(new FileBackend());
  return _repo;
}
