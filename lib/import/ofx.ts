// ---------------------------------------------------------------------------
// OFX / QFX statement parser — pure, no DB access.
//
// OFX is the interchange format almost every bank/CC issuer can export ("Download
// to Quicken/Money", a .ofx or .qfx file), so ONE parser unlocks most institutions
// — versus writing a separate PDF parser per bank. QFX is Intuit's OFX variant;
// the extra Intuit tags are ignored, so the same code reads both.
//
// This is the dedup-safe replacement for the removed CSV import: each transaction
// carries a stable, bank-assigned FITID, so re-importing an overlapping file (or
// the same file twice) collapses to the existing rows instead of silently
// doubling every metric the way the period-start-dated CSV import did. The FITID
// is hashed into the transactions.dedup_key in the insert layer (insert-ofx.ts).
//
// Two wire formats, one code path:
//   - OFX 1.x is SGML: leaf elements are often UNCLOSED (`<TRNAMT>-12.34` then a
//     newline / the next tag). Aggregates (STMTRS, STMTTRN, LEDGERBAL, …) ARE
//     closed, per the spec.
//   - OFX 2.x / QFX is XML: every element is closed (`<TRNAMT>-12.34</TRNAMT>`).
// `leaf()` reads a value as "everything after <TAG> up to the next '<' or newline",
// which is correct for both: SGML stops at the newline, XML stops at the closing
// tag's '<'. Aggregate blocks are sliced with non-greedy `<TAG>…</TAG>` matches,
// which the spec guarantees are present.
//
// account_kind is derived from the OFX account type (CHECKING→chequing,
// SAVINGS/MONEYMRKT→savings, credit-card block→card). That is what lights up the
// spend/outflow charts (see lib/db/account-kinds.ts), so an imported account is a
// first-class citizen the moment it lands.
// ---------------------------------------------------------------------------

import type { AccountKind } from "../db/account-kinds";

export interface OfxTransaction {
  fitId: string; // bank-assigned, stable per account; "" if the file omitted it
  txn_date: string; // YYYY-MM-DD
  description: string;
  amount: number; // POSITIVE magnitude; `flow` encodes direction
  flow: "spend" | "payment" | "income" | "transfer" | "fee_interest";
  category: string; // crude default; recategorizeAll() applies the rule set after insert
}

export interface OfxAccount {
  source: string; // stable per-account id, e.g. "ofx_chequing_4567"
  account: string; // human label, e.g. "OFX CHEQUING ••4567"
  account_kind: AccountKind;
  period: string; // "YYYY-MM-DD to YYYY-MM-DD"
  closing_balance: number | null; // LEDGERBAL, bank accounts only (see header)
  closing_date: string | null; // LEDGERBAL DTASOF, YYYY-MM-DD
  transactions: OfxTransaction[];
}

export interface OfxImport {
  accounts: OfxAccount[];
}

// True for anything that smells like OFX/QFX — the SGML header line or the OFX
// root element. Used by the upload route to reject non-OFX bytes before parsing.
export function looksLikeOfx(text: string): boolean {
  return /OFXHEADER|<OFX>/i.test(text);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&apos;": "'",
  "&quot;": '"',
  "&nbsp;": " ",
};

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|apos|quot|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

// Read a leaf element value: everything after `<TAG>` up to the next '<' or line
// break. Correct for unclosed SGML leaves AND closed XML leaves (see header).
function leaf(scope: string, tag: string): string | null {
  const m = scope.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? decode(m[1]).trim() : null;
}

// Slice the first `<TAG>…</TAG>` aggregate out of `scope` (aggregates are always
// closed). Returns "" if absent so leaf() lookups inside simply miss.
function block(scope: string, tag: string): string {
  const m = scope.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

function blocks(scope: string, tag: string): string[] {
  return [...scope.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);
}

// OFX dates are YYYYMMDD optionally followed by HHMMSS[.SSS][TZ]. We only keep the
// calendar day (statements have no intraday meaning for spend charts).
function ofxDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function last4(acctId: string | null, fallback: number): string {
  const cleaned = (acctId ?? "").replace(/[^A-Za-z0-9]/g, "");
  return cleaned ? cleaned.slice(-4) : `acct${fallback}`;
}

function acctTypeToKind(acctType: string | null): AccountKind {
  switch ((acctType ?? "").toUpperCase()) {
    case "CHECKING":
      return "chequing";
    case "SAVINGS":
    case "MONEYMRKT":
      return "savings";
    case "CREDITLINE":
      return "card";
    default:
      return "chequing"; // a bank STMTRS with an unknown type is still a deposit account
  }
}

// Map (account kind, OFX transaction type, signed amount) to Pare's flow taxonomy.
// Amount sign convention: bank deposits and card credits are POSITIVE; bank
// withdrawals and card charges are NEGATIVE. We store the magnitude and let `flow`
// carry direction (matching the chequing parser's "amounts stored positive" rule).
function classify(
  kind: AccountKind,
  trnType: string | null,
  amount: number
): { flow: OfxTransaction["flow"]; category: string } {
  const t = (trnType ?? "").toUpperCase();

  if (kind === "card") {
    // Card: a positive amount is a payment/credit TO the card (excluded from spend
    // and outflow); anything negative is a purchase, fee, or interest CHARGE.
    return amount > 0
      ? { flow: "payment", category: "Banking" }
      : { flow: "spend", category: "Other / uncategorized" };
  }

  // Deposit accounts (chequing / savings).
  if (amount > 0) {
    if (t === "XFER") return { flow: "transfer", category: "Banking" };
    return { flow: "income", category: "Banking" }; // payroll, deposits, interest credit
  }
  if (t === "FEE" || t === "SRVCHG" || t === "INT") {
    return { flow: "fee_interest", category: "Banking" };
  }
  if (t === "XFER") return { flow: "transfer", category: "Banking" };
  return { flow: "spend", category: "Banking" }; // debit/POS/ATM/cheque purchase
}

function parseTransactions(tranlist: string, kind: AccountKind): OfxTransaction[] {
  const out: OfxTransaction[] = [];
  for (const stmttrn of blocks(tranlist, "STMTTRN")) {
    const raw = leaf(stmttrn, "TRNAMT");
    const date = ofxDate(leaf(stmttrn, "DTPOSTED"));
    if (raw === null || date === null) continue;

    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const name = leaf(stmttrn, "NAME") ?? "";
    const memo = leaf(stmttrn, "MEMO") ?? "";
    const parts = [name, memo].filter(Boolean);
    // NAME and MEMO often duplicate; keep one if so, join if they differ.
    const description =
      parts.length === 2 && parts[0] !== parts[1]
        ? `${parts[0]} ${parts[1]}`
        : parts[0] || leaf(stmttrn, "CHECKNUM") || "OFX TRANSACTION";

    const { flow, category } = classify(kind, leaf(stmttrn, "TRNTYPE"), amount);
    out.push({
      fitId: leaf(stmttrn, "FITID") ?? "",
      txn_date: date,
      description,
      amount: Math.abs(amount),
      flow,
      category,
    });
  }
  return out;
}

function periodOf(tranlist: string, txns: OfxTransaction[]): string {
  const start = ofxDate(leaf(tranlist, "DTSTART"));
  const end = ofxDate(leaf(tranlist, "DTEND"));
  if (start && end) return `${start} to ${end}`;
  if (txns.length) {
    const dates = txns.map((t) => t.txn_date).sort();
    return `${dates[0]} to ${dates[dates.length - 1]}`;
  }
  return "imported";
}

function buildAccount(
  scope: string,
  kind: AccountKind,
  acctId: string | null,
  index: number,
  bankBalance: boolean
): OfxAccount {
  const id4 = last4(acctId, index);
  const source = `ofx_${kind}_${id4}`;
  const account = `OFX ${kind.toUpperCase()} ••${id4}`;

  const tranlist = block(scope, "BANKTRANLIST");
  const transactions = parseTransactions(tranlist, kind);

  // LEDGERBAL → closing balance. Set for bank accounts only: a deposit account's
  // BALAMT is unambiguously positive-when-funded, which is exactly what net worth
  // expects. Credit-card BALAMT sign is issuer-inconsistent, so we leave card
  // closing balances NULL rather than risk a wrong-signed net-worth point.
  let closing_balance: number | null = null;
  let closing_date: string | null = null;
  if (bankBalance) {
    const ledger = block(scope, "LEDGERBAL");
    const bal = leaf(ledger, "BALAMT");
    if (bal !== null && Number.isFinite(parseFloat(bal))) {
      closing_balance = parseFloat(bal);
      closing_date = ofxDate(leaf(ledger, "DTASOF")) ?? transactions.at(-1)?.txn_date ?? null;
    }
  }

  return {
    source,
    account,
    account_kind: kind,
    period: periodOf(tranlist, transactions),
    closing_balance,
    closing_date,
    transactions,
  };
}

export function parseOfx(text: string): OfxImport {
  const accounts: OfxAccount[] = [];
  let index = 0;

  // Bank statement responses → deposit accounts (chequing / savings).
  for (const stmtrs of blocks(text, "STMTRS")) {
    const acctFrom = block(stmtrs, "BANKACCTFROM");
    const kind = acctTypeToKind(leaf(acctFrom, "ACCTTYPE"));
    const acct = buildAccount(stmtrs, kind, leaf(acctFrom, "ACCTID"), index++, true);
    if (acct.transactions.length || acct.closing_balance !== null) accounts.push(acct);
  }

  // Credit-card statement responses → card accounts.
  for (const ccstmtrs of blocks(text, "CCSTMTRS")) {
    const acctFrom = block(ccstmtrs, "CCACCTFROM");
    const acct = buildAccount(ccstmtrs, "card", leaf(acctFrom, "ACCTID"), index++, false);
    if (acct.transactions.length) accounts.push(acct);
  }

  return { accounts };
}
