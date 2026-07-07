import fs from "fs";
import path from "path";
import type { AccountKind } from "./account-kinds";

/**
 * SimpleFIN connection state — self-host only, persisted to a gitignored JSON
 * file alongside the DB (the user-rules.json / vapid.json pattern), NOT to
 * SQLite. Deliberate:
 *
 *   - the access URL is a bearer secret; it stays out of the DB (and out of
 *     `?format=backup` exports, which copy the DB byte-for-byte),
 *   - it survives the /api/data WIPE + re-ingest like rules and goals do,
 *   - it avoids widening the Repo contract (and the hosted DO backend) for a
 *     feature that is self-host-only in this phase.
 *
 * The per-account `kind` is the user's one-time classification (SimpleFIN has
 * no account-type field). It is FROZEN after the account's first sync: the
 * kind is stamped onto every inserted row, so changing it later would fork the
 * account's history across two kinds. Reconnect to reclassify.
 */

const FILE = path.join(process.cwd(), "data", "simplefin.json");

export interface SimplefinAccountState {
  name: string; // bridge's account name (display)
  org?: string; // institution name, for the account list UI
  currency?: string;
  kind: AccountKind;
  enabled: boolean;
  synced?: boolean; // true once rows have landed → kind is frozen
}

export interface SimplefinConfig {
  accessUrl: string;
  autoSync: boolean;
  accounts: Record<string, SimplefinAccountState>; // keyed by SimpleFIN account id
  lastSyncedAt?: string; // ISO — successful syncs only (the watermark)
  lastAttemptAt?: string; // ISO — any sync attempt (failure cooldown)
  lastSyncStatus?: string; // "ok" or the last error, shown on the card
  lastSyncErrors?: string[]; // bridge-reported errors (protocol: must display)
}

export function loadSimplefinConfig(): SimplefinConfig | null {
  try {
    if (!fs.existsSync(FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    if (!parsed || typeof parsed.accessUrl !== "string") return null;
    return {
      autoSync: true,
      accounts: {},
      ...parsed,
    } as SimplefinConfig;
  } catch {
    return null;
  }
}

export function saveSimplefinConfig(config: SimplefinConfig): void {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// Disconnect: forget the connection entirely. Already-ingested transactions
// stay (they're normal statement rows — the user can WIPE separately).
export function clearSimplefinConfig(): void {
  if (fs.existsSync(FILE)) fs.rmSync(FILE);
}

// Kill switch for self-hosters who never want the aggregator path visible.
// Same envFlag semantics as PARE_SIGNUP_DISABLED ("0"/"false"/"off"/"no" = off).
export function simplefinDisabled(): boolean {
  const v = (process.env.PARE_SIMPLEFIN_DISABLED ?? "").trim().toLowerCase();
  return v !== "" && !["0", "false", "off", "no"].includes(v);
}
