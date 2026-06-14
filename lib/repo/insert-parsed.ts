// ---------------------------------------------------------------------------
// insertParsedStatement — the ONE shared "write a parsed statement's rows into a
// Repo" routine. Both the hosted queue consumer (lib/queue/consumer.ts) and the
// self-host upload route (app/api/upload/route.ts) used a byte-identical copy of
// this logic, flagged with a "do NOT diverge" comment. This is that single source
// of truth; both call it so the insert + dedup-seq + batch(insertMany +
// recategorizeAll) behaviour can never drift between the two paths.
//
// Behaviour preserved EXACTLY from the originals:
//   - statement row inserted from rows[0].{source,account,period} + metas[0];
//   - per-row dedup `seq` derived from a (source|txn_date|description|amount) key
//     so genuine same-day same-amount duplicates within ONE statement each get a
//     distinct dedup_key (seq 1,2,3…) and are NOT collapsed by INSERT OR IGNORE;
//   - insertMany + recategorizeAll inside ONE repo.batch(): the counts come off
//     the BATCH return (insertMany's real result), never off a buffered write
//     mid-closure (on the DO backend that return is a placeholder). recategorizeAll
//     runs unconditionally (idempotent + cheap) — see the route/consumer notes.
//
// The caller is responsible for `repo.categories.seed()` BEFORE calling this (both
// originals seed first); empty `rows` is the caller's concern (each path treats an
// empty parse differently), so this assumes rows.length > 0.
// ---------------------------------------------------------------------------

import { computeDedupKey } from "../db/transactions";
import { sourceToKind } from "../db/account-kinds";
import type { Repo, NewTransaction } from "./types";
import type { ParsedTransaction, ParsedStatementMeta } from "../parser/run-parser";

export async function insertParsedStatement(
  repo: Repo,
  filename: string,
  rows: ParsedTransaction[],
  metas: ParsedStatementMeta[]
): Promise<{ inserted: number; skipped: number; statementId: number }> {
  const source = rows[0].source;
  const account = rows[0].account;
  const period = rows[0].period;
  const meta = metas[0];

  const statementId = await repo.statements.insert({
    filename,
    source,
    account,
    period,
    row_count: rows.length,
    closing_balance: meta?.closing_balance ?? null,
    closing_date: meta?.closing_date ?? null,
    account_kind: sourceToKind(source),
  });

  const seqMap = new Map<string, number>();
  const newTxns: NewTransaction[] = rows.map((row) => {
    const seqKey = `${row.source}|${row.txn_date}|${row.description}|${row.amount}`;
    const seq = (seqMap.get(seqKey) || 0) + 1;
    seqMap.set(seqKey, seq);

    return {
      statement_id: statementId || null,
      source: row.source,
      account: row.account,
      period: row.period,
      txn_date: row.txn_date,
      description: row.description,
      amount: row.amount,
      category: row.category,
      flow: row.flow,
      dedup_key: computeDedupKey(row.source, row.txn_date, row.description, row.amount, seq),
      account_kind: sourceToKind(row.source),
    };
  });

  // One write boundary: insert every row, then recategorize once. On the
  // encrypted/DO backend this serialises+encrypts a single time instead of per
  // row, and writes inside batch() return a PLACEHOLDER (the real result only
  // exists once the batch is shipped) — so we must NOT branch on the insertMany
  // result here. recategorizeAll() is idempotent and cheap, so running it
  // unconditionally is correct; it applies the DB's full rule set (incl. the
  // gitignored personal taxonomy) since the parser taxonomy is generic. The
  // batch's return value (insertMany's real result, returnIndex 0) supplies the
  // counts on both backends.
  const { inserted, skipped } = await repo.batch(async () => {
    const result = await repo.transactions.insertMany(newTxns);
    await repo.categories.recategorizeAll();
    return result;
  });

  return { inserted, skipped, statementId };
}
