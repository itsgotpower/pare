// ---------------------------------------------------------------------------
// insertOfxImport — write a parsed OFX/QFX file's accounts + transactions into a
// Repo. The OFX sibling of insert-parsed.ts (the PDF path): one statement row per
// account (so re-uploading the same file UPSERTs by filename and net worth picks
// up the closing balance), dedup keyed on the bank-assigned FITID, and a single
// recategorizeAll() over one write boundary.
//
// Why OFX rows are STATEMENTS, not `imports` (import_id stays NULL): an OFX file
// carries raw bank data with NO categories, so we WANT the rule engine to
// categorize it exactly like a PDF statement. recategorizeAll() deliberately
// SKIPS import_id rows (those are a migration's authoritative categories), so
// tagging OFX as an import would freeze every row at its crude insert-time default.
//
// The caller must run repo.categories.seed() before calling this (the upload route
// does); empty input is the caller's concern.
// ---------------------------------------------------------------------------

import { computeDedupKey, computeOfxDedupKey } from "../db/transactions";
import type { Repo, NewTransaction } from "./types";
import type { OfxImport } from "../import/ofx";

export async function insertOfxImport(
  repo: Repo,
  filename: string,
  parsed: OfxImport
): Promise<{ inserted: number; skipped: number; total: number; accounts: number }> {
  const accounts = parsed.accounts;
  const multi = accounts.length > 1;

  // Positional fallback only when a row lacks a FITID — keep genuine same-day,
  // same-amount duplicates within one account distinct (seq 1,2,3…).
  const seqMap = new Map<string, number>();
  const newTxns: NewTransaction[] = [];

  for (const acct of accounts) {
    // statements.filename is UNIQUE; suffix per account so a multi-account file
    // upserts each account independently instead of colliding on one filename.
    const statementFilename = multi ? `${filename} (${acct.source})` : filename;

    const statementId = await repo.statements.insert({
      filename: statementFilename,
      source: acct.source,
      account: acct.account,
      period: acct.period,
      row_count: acct.transactions.length,
      closing_balance: acct.closing_balance,
      closing_date: acct.closing_date,
      account_kind: acct.account_kind,
    });

    for (const t of acct.transactions) {
      let dedupKey: string;
      if (t.fitId) {
        dedupKey = computeOfxDedupKey(acct.source, t.fitId);
      } else {
        const seqKey = `${acct.source}|${t.txn_date}|${t.description}|${t.amount}`;
        const seq = (seqMap.get(seqKey) || 0) + 1;
        seqMap.set(seqKey, seq);
        dedupKey = computeDedupKey(acct.source, t.txn_date, t.description, t.amount, seq);
      }

      newTxns.push({
        statement_id: statementId || null,
        source: acct.source,
        account: acct.account,
        period: acct.period,
        txn_date: t.txn_date,
        description: t.description,
        amount: t.amount,
        category: t.category,
        flow: t.flow,
        dedup_key: dedupKey,
        account_kind: acct.account_kind,
      });
    }
  }

  // One durability boundary: insert every row, then recategorize once — same
  // pattern as insert-parsed.ts. The batch return (insertMany's real result)
  // supplies the counts on both backends.
  const { inserted, skipped } = await repo.batch(async () => {
    const result = await repo.transactions.insertMany(newTxns);
    await repo.categories.recategorizeAll();
    return result;
  });

  return { inserted, skipped, total: newTxns.length, accounts: accounts.length };
}
