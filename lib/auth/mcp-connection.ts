import type { D1Like } from "./hosted";

// Is the remote MCP connector (claude.ai Connectors) currently linked to this
// user? A successful connect leaves an OAuth token row in the D1 AUTH database
// (`oauthAccessToken`, better-auth `mcp` plugin — d1/migrations/0007_mcp_oauth.sql),
// keyed by userId. This reads that table to render the CONNECTED state on
// /connect. Hosted-only: self-host has no OAuth provider (it uses the local
// stdio server), so this is never called there.
//
// Caveat: there is no perfectly authoritative "connected" signal. If a user
// disconnects INSIDE Claude, claude.ai does not reliably hit a token-revocation
// endpoint, so a lingering-but-unexpired token can still read as connected until
// it expires. We key off the refresh token's lifetime (the longest-lived, and
// what claude.ai keeps exchanging for fresh access tokens) to minimise false
// negatives; the residual false-positive window is the known limitation.

export interface McpConnectionStatus {
  connected: boolean;
  /** ISO timestamp of the earliest still-live token — "connected since". */
  connectedAt: string | null;
  /** OAuth client display name (e.g. "Claude"), when the client registered one. */
  clientName: string | null;
}

interface TokenRow {
  accessTokenExpiresAt: string | number | null;
  refreshTokenExpiresAt: string | number | null;
  createdAt: string | number | null;
  clientName: string | null;
}

const DISCONNECTED: McpConnectionStatus = {
  connected: false,
  connectedAt: null,
  clientName: null,
};

// better-auth writes dates to D1 as ISO strings (see cloud/* `new Date().toISOString()`
// precedent); tolerate a numeric epoch-ms too so a future adapter change can't
// silently flip everyone to "disconnected".
function toMillis(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// A token is a live connection while its REFRESH token is unexpired — claude.ai
// keeps trading it for short-lived access tokens, so an expired access token
// alone does NOT mean disconnected. Fall back to the access-token expiry when no
// refresh expiry was issued.
function isLive(row: TokenRow, now: number): boolean {
  const refresh = toMillis(row.refreshTokenExpiresAt);
  if (refresh != null) return refresh > now;
  const access = toMillis(row.accessTokenExpiresAt);
  return access != null && access > now;
}

export async function getMcpConnection(
  db: D1Like,
  userId: string,
  now: number = Date.now()
): Promise<McpConnectionStatus> {
  const res = await db
    .prepare(
      `SELECT t."accessTokenExpiresAt"  AS accessTokenExpiresAt,
              t."refreshTokenExpiresAt" AS refreshTokenExpiresAt,
              t."createdAt"             AS createdAt,
              a."name"                  AS clientName
         FROM "oauthAccessToken" t
    LEFT JOIN "oauthApplication" a ON a."clientId" = t."clientId"
        WHERE t."userId" = ?`
    )
    .bind(userId)
    .all();

  const rows = ((res?.results ?? []) as unknown as TokenRow[]).filter((r) => isLive(r, now));
  if (rows.length === 0) return DISCONNECTED;

  // "Connected since" = the earliest live token; take a client name from any row
  // that carries one (DCR clients don't always register a display name).
  let earliest = Infinity;
  let clientName: string | null = null;
  for (const r of rows) {
    const created = toMillis(r.createdAt);
    if (created != null && created < earliest) earliest = created;
    if (!clientName && r.clientName) clientName = r.clientName;
  }

  return {
    connected: true,
    connectedAt: Number.isFinite(earliest) ? new Date(earliest).toISOString() : null,
    clientName,
  };
}
