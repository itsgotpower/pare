import { getDb } from "../db";
import { sourceToKind, type AccountKind } from "./account-kinds";

// Account management (migration 009): per-source nickname / hidden / closed.
// "Account" here = a distinct `source` string with data behind it (transactions
// or statements). Meta rows are keyed by source so they survive the /api/data
// WIPE the same way rules/goals/marks do.
//
// Semantics:
// - nickname: display-label override (profile data health and anywhere else
//   sourceLabel() is used). Never touches the stored source string — dedup keys
//   are source-namespaced and must not change.
// - hidden:   excluded from every chart/total/list read through v_transactions
//   (the migration filters the view), plus the statement-side readers
//   (net worth, forecast anchor). Exports and data health still include it.
// - closed:   history stays in the charts; staleness nudges stop, net-worth
//   carry-forward stops after its last observation, and it can no longer
//   anchor the cash-flow forecast.

// Only the labels that differ from the derived `<bank>_<kind>` form below.
const SOURCE_LABELS: Record<string, string> = {
  cibc_chequing: "CHEQUING",
  wealthsimple_cash: "WS CASH",
  wealthsimple_savings: "WS SAVINGS",
  manual: "CASH", // in-app quick-added rows, not a bank feed
};

// Human label for a parser `source`. Explicit overrides win; otherwise derive a
// readable label from the `<bank>_<kind>` convention (rbc_chequing → "RBC
// CHEQUING") so a newly-added bank renders sensibly without a map entry.
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").toUpperCase();
}

export interface AccountMeta {
  source: string;
  nickname: string | null;
  hidden: boolean;
  closed: boolean;
}

export interface AccountInfo extends AccountMeta {
  kind: AccountKind;
  label: string; // nickname if set, else the derived source label
  txn_count: number;
  statement_count: number;
  last_txn_date: string | null;
}

export interface AccountMetaInput {
  nickname?: string | null;
  hidden?: boolean;
  closed?: boolean;
}

// SQL fragment for readers of the `statements` table (net worth, forecast
// anchor) — v_transactions already filters hidden sources at the view level.
export const NOT_HIDDEN_SOURCE_SQL = `source NOT IN (SELECT source FROM account_meta WHERE hidden = 1)`;

interface MetaRow {
  source: string;
  nickname: string | null;
  hidden: number;
  closed: number;
}

export function getAccountMetaMap(): Map<string, AccountMeta> {
  const db = getDb();
  const rows = db
    .prepare("SELECT source, nickname, hidden, closed FROM account_meta")
    .all() as MetaRow[];
  return new Map(
    rows.map((r) => [
      r.source,
      {
        source: r.source,
        nickname: r.nickname,
        hidden: r.hidden === 1,
        closed: r.closed === 1,
      },
    ])
  );
}

// Every source with data behind it (transactions or statements — a freshly
// synced source can briefly have a statement row and no transactions), joined
// with its meta. Reads the BASE table: hidden accounts must stay listed so the
// user can unhide them.
export function listAccounts(): AccountInfo[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.source,
              COALESCE(t.txn_count, 0) AS txn_count,
              COALESCE(st.stmt_count, 0) AS statement_count,
              t.last_txn_date
       FROM (
         SELECT source FROM transactions
         UNION
         SELECT source FROM statements
       ) s
       LEFT JOIN (
         SELECT source, COUNT(*) AS txn_count, MAX(txn_date) AS last_txn_date
         FROM transactions GROUP BY source
       ) t ON t.source = s.source
       LEFT JOIN (
         SELECT source, COUNT(*) AS stmt_count FROM statements GROUP BY source
       ) st ON st.source = s.source
       ORDER BY s.source`
    )
    .all() as {
    source: string;
    txn_count: number;
    statement_count: number;
    last_txn_date: string | null;
  }[];

  const meta = getAccountMetaMap();
  return rows.map((r) => {
    const m = meta.get(r.source);
    return {
      source: r.source,
      kind: sourceToKind(r.source),
      nickname: m?.nickname ?? null,
      hidden: m?.hidden ?? false,
      closed: m?.closed ?? false,
      label: m?.nickname?.trim() || sourceLabel(r.source),
      txn_count: r.txn_count,
      statement_count: r.statement_count,
      last_txn_date: r.last_txn_date,
    };
  });
}

// Partial upsert: only the fields present in `input` change; absent fields keep
// their stored value (or the default on first write). Returns false when the
// source has no data behind it — meta for unknown sources would be junk rows.
export function setAccountMeta(source: string, input: AccountMetaInput): boolean {
  const db = getDb();
  const exists = db
    .prepare(
      `SELECT 1 FROM (
         SELECT source FROM transactions WHERE source = @source
         UNION
         SELECT source FROM statements WHERE source = @source
       ) LIMIT 1`
    )
    .get({ source });
  if (!exists) return false;

  // Nickname: empty/whitespace clears back to the derived label.
  const nickname =
    input.nickname === undefined ? undefined : input.nickname?.trim() || null;

  db.prepare(
    `INSERT INTO account_meta (source, nickname, hidden, closed, updated_at)
     VALUES (@source, @nickname, @hidden, @closed, datetime('now'))
     ON CONFLICT(source) DO UPDATE SET
       nickname   = CASE WHEN @has_nickname THEN @nickname ELSE nickname END,
       hidden     = CASE WHEN @has_hidden   THEN @hidden   ELSE hidden   END,
       closed     = CASE WHEN @has_closed   THEN @closed   ELSE closed   END,
       updated_at = datetime('now')`
  ).run({
    source,
    nickname: nickname ?? null,
    hidden: input.hidden === undefined ? 0 : input.hidden ? 1 : 0,
    closed: input.closed === undefined ? 0 : input.closed ? 1 : 0,
    has_nickname: input.nickname === undefined ? 0 : 1,
    has_hidden: input.hidden === undefined ? 0 : 1,
    has_closed: input.closed === undefined ? 0 : 1,
  });
  return true;
}
