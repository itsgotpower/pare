// ---------------------------------------------------------------------------
// insertImportedRows — the commit path for the cross-app importer. Sibling to
// insertParsedStatement (lib/repo/insert-parsed.ts); the two are deliberately
// parallel but DIVERGE in three load-bearing ways, all required:
//
//   1. account_kind comes from the row (the user's account MAPPING), NOT from
//      sourceToKind(source) — imported sources are foreign, so sourceToKind
//      would return 'unknown' and the rows would be invisible to every chart.
//   2. createImport() runs OUTSIDE repo.batch(). We need the real importId
//      synchronously to stamp every row's import_id, and on the hosted/DO backend
//      writes buffered INSIDE batch() return a placeholder (do-repo-client.ts), so
//      a batched create() would yield undefined. The single insertMany() is then
//      the FIRST (and only) write in the batch, so the DO's hardcoded
//      returnIndex:0 hands back its real {inserted, skipped} counts.
//   3. recategorizeAll() is NOT called. Imported categories are authoritative —
//      the user migrated them on purpose. (recategorizeAll also now skips
//      import_id rows, so this is belt-and-suspenders, and it avoids a wasteful
//      full-table scan on every import.)
//
// Like insertParsedStatement, dedup `seq` gives genuine same-day/same-amount
// duplicates within ONE import distinct keys. Because `source` is a STABLE slug
// derived from the foreign account, re-committing the same file yields identical
// dedup_keys → INSERT OR IGNORE skips them → a double-submit is a no-op.
// ---------------------------------------------------------------------------

import { computeDedupKey } from "../db/transactions";
import type { Repo, NewTransaction, ImportWatermark } from "./types";
import type { NormalizedRow, AccountMapping } from "../import/normalizer";

export async function insertImportedRows(
  repo: Repo,
  provider: string,
  rows: NormalizedRow[],
  accountMap: Record<string, AccountMapping>
): Promise<{ importId: number; inserted: number; skipped: number; watermarks: ImportWatermark[] }> {
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  for (const r of rows) {
    if (dateMin === null || r.txn_date < dateMin) dateMin = r.txn_date;
    if (dateMax === null || r.txn_date > dateMax) dateMax = r.txn_date;
  }

  // Create the imports row FIRST (outside the batch) so its id can tag every txn.
  const importId = await repo.imports.create({
    provider,
    row_count: rows.length,
    account_map: JSON.stringify(accountMap),
    date_min: dateMin,
    date_max: dateMax,
  });

  const seqMap = new Map<string, number>();
  const newTxns: NewTransaction[] = rows.map((row) => {
    const seqKey = `${row.source}|${row.txn_date}|${row.description}|${row.amount}`;
    const seq = (seqMap.get(seqKey) || 0) + 1;
    seqMap.set(seqKey, seq);

    return {
      statement_id: null,
      source: row.source,
      account: row.account,
      period: row.period,
      txn_date: row.txn_date,
      description: row.description,
      amount: row.amount,
      category: row.category,
      flow: row.flow,
      dedup_key: computeDedupKey(row.source, row.txn_date, row.description, row.amount, seq),
      account_kind: row.account_kind,
      import_id: importId,
    };
  });

  // insertMany is the ONLY write in the batch -> the DO's returnIndex:0 returns
  // its real counts. No recategorizeAll (imported categories are authoritative).
  const { inserted, skipped } = await repo.batch(async () => {
    return repo.transactions.insertMany(newTxns);
  });

  const watermarks = await repo.imports.watermarks();
  return { importId, inserted, skipped, watermarks };
}
