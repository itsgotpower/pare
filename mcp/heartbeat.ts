import fs from "fs";
import path from "path";

/**
 * Self-host MCP liveness heartbeat — a tiny gitignored JSON file
 * (data/mcp-heartbeat.json, the user-rules.json / simplefin.json pattern) that
 * the stdio server touches on startup and every few minutes while an MCP
 * client keeps the process alive. The /profile CLAUDE indicator reads it to
 * answer "has Claude ever been hooked up here, and how recently?" — the web
 * app can't observe the stdio transport directly (it bypasses HTTP entirely).
 *
 * Node-only (fs): written by mcp/server.ts, read by /api/profile's SELF-HOST
 * branch via dynamic import. Never import this from shared tool code or
 * anything the hosted Workers bundle reaches — hosted "connected" comes from
 * the OAuth token table instead (lib/auth/mcp-connection.ts).
 */

// Touch cadence for the long-lived stdio process; readers treat anything
// within ~3 intervals as "an MCP client is running right now".
export const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

// Data-dir convention from user-rules.ts: <cwd>/data, PARE_DATA_DIR overrides.
// Resolved lazily so tests can point PARE_DATA_DIR at a temp dir per-case.
const file = () =>
  path.join(
    process.env.PARE_DATA_DIR || path.join(process.cwd(), "data"),
    "mcp-heartbeat.json"
  );

export function touchMcpHeartbeat(now: Date = new Date()): void {
  try {
    const f = file();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ lastSeenAt: now.toISOString() }, null, 2));
  } catch {
    // Liveness is best-effort — a read-only data dir must never break the server.
  }
}

/** ISO timestamp of the last heartbeat, or null if the server has never run. */
export function readMcpHeartbeat(): string | null {
  try {
    const f = file();
    if (!fs.existsSync(f)) return null;
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return typeof parsed?.lastSeenAt === "string" ? parsed.lastSeenAt : null;
  } catch {
    return null;
  }
}
