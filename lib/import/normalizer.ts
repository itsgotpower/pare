// The normalizer: turn a foreign CSV row into pare's canonical transaction shape
// (ParsedTransaction) plus an account_kind and the retained foreign account/
// category strings. This is the highest-correctness-risk module — every chart
// downstream trusts the {amount, flow, account_kind, category} it produces.

import type { ParsedTransaction } from "../parser/run-parser";
import type { AccountKind } from "../db/account-kinds";
import { type Preset, columnIndex } from "./presets";
import { inferFlow } from "./flow-rules";
import { UNCATEGORIZED } from "./category-defaults";

// How a foreign account name maps into pare. `source` is a deterministic slug
// (stable across re-imports → identical dedup_keys → re-commit is a no-op) and
// is distinct from the PDF sources (amex/cibc_visa/cibc_chequing) so a later PDF
// of the same account does NOT hash-collide (the fuzzy overlap guard handles
// that seam instead). `account_kind` drives the analytics universes.
export interface AccountMapping {
  source: string;
  account_kind: AccountKind;
}

export interface NormalizeContext {
  preset: Preset;
  accountMap: Record<string, AccountMapping>;
  categoryMap: Record<string, string>; // foreign category -> pare category
}

export interface NormalizedRow extends ParsedTransaction {
  account_kind: AccountKind;
  foreignAccount: string;
  foreignCategory: string;
}

export interface DropReason {
  row: number; // 1-based data-row index (excludes header)
  reason: string;
  raw: string[]; // the offending cells, for the preview
}

// --- Foreign-account → {source slug, account_kind} ------------------------

export function slugifySource(foreignAccount: string): string {
  const slug = foreignAccount
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `import:${slug || "account"}`;
}

// Guess an account_kind from the account name (the user can override in the
// wizard). Order matters — "credit card" must beat "savings card", etc.
export function guessKind(foreignAccount: string): AccountKind {
  const n = foreignAccount.toLowerCase();
  if (/(credit|visa|mastercard|amex|american express|\bcard\b)/.test(n)) return "card";
  if (/(invest|brokerage|401k|rrsp|tfsa|ira|stock)/.test(n)) return "investment";
  if (/saving/.test(n)) return "savings";
  if (/(che(qu|ck)ing|debit|current account|\bbank\b)/.test(n)) return "chequing";
  if (/cash|wallet/.test(n)) return "cash";
  return "unknown";
}

export function suggestAccountMapping(foreignAccount: string): AccountMapping {
  return { source: slugifySource(foreignAccount), account_kind: guessKind(foreignAccount) };
}

// --- Field parsing --------------------------------------------------------

// Parse a money cell: handles "$1,234.56", "(12.34)" (negative), "-5", "". NaN
// when not a number.
export function parseMoney(cell: string): number {
  if (!cell) return NaN;
  const neg = /^\(.*\)$/.test(cell.trim());
  const cleaned = cell.replace(/[(),$\s]/g, "").replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return NaN;
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

// Parse a date cell to YYYY-MM-DD, or null if unrecognized. Accepts ISO
// (YYYY-MM-DD) and US slash dates (M/D/YYYY, M/D/YY); 2-digit years => 2000+.
export function parseDate(cell: string): string | null {
  const s = (cell || "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`;
    return null;
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, mm, dd, yy] = slash;
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    const year = yy.length === 2 ? `20${yy}` : yy;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

// Signed amount for a row given the preset's sign convention. Returns NaN when
// the amount can't be parsed (the row is then dropped).
function signedAmount(row: string[], headers: string[], preset: Preset): number {
  if (preset.signConvention === "outflow_inflow") {
    const oi = columnIndex(headers, preset.columns.outflow);
    const ii = columnIndex(headers, preset.columns.inflow);
    const out = oi !== -1 ? parseMoney(row[oi]) : 0;
    const inn = ii !== -1 ? parseMoney(row[ii]) : 0;
    const o = Number.isNaN(out) ? 0 : Math.abs(out);
    const i = Number.isNaN(inn) ? 0 : Math.abs(inn);
    if (o === 0 && i === 0 && (oi === -1 || ii === -1)) return NaN;
    return i - o;
  }

  const ai = columnIndex(headers, preset.columns.amount);
  if (ai === -1) return NaN;
  const amt = parseMoney(row[ai]);
  if (Number.isNaN(amt)) return NaN;

  if (preset.signConvention === "type") {
    // Mint: amount is positive; the type column carries the direction.
    const ti = columnIndex(headers, preset.columns.txnType);
    const type = (ti !== -1 ? row[ti] : "").toLowerCase();
    const mag = Math.abs(amt);
    return type === "debit" ? -mag : mag;
  }
  // "signed": amount already carries its sign (negative = money out).
  return amt;
}

function cell(row: string[], headers: string[], candidates: string[] | undefined): string {
  const i = columnIndex(headers, candidates);
  return i !== -1 ? row[i] ?? "" : "";
}

// --- Normalize one row / all rows -----------------------------------------

export function normalizeRow(
  row: string[],
  headers: string[],
  ctx: NormalizeContext,
  index: number
): NormalizedRow | DropReason {
  const { preset, accountMap, categoryMap } = ctx;

  const foreignAccount = cell(row, headers, preset.columns.account) || "Imported account";
  const foreignCategory = cell(row, headers, preset.columns.category);
  const rawDesc = cell(row, headers, preset.columns.description);

  const txnDate = parseDate(cell(row, headers, preset.columns.date));
  if (!txnDate) {
    return { row: index, reason: "Unrecognized or missing date", raw: row };
  }

  const signed = signedAmount(row, headers, preset);
  if (Number.isNaN(signed)) {
    return { row: index, reason: "Unparseable amount", raw: row };
  }

  const mapping = accountMap[foreignAccount] ?? suggestAccountMapping(foreignAccount);
  const account_kind = mapping.account_kind;
  const flow = inferFlow({ signedAmount: signed, foreignCategory, accountKind: account_kind });
  const category = categoryMap[foreignCategory] ?? UNCATEGORIZED;
  const description = rawDesc.trim() || foreignCategory.trim() || "(imported)";

  return {
    source: mapping.source,
    account: foreignAccount,
    period: txnDate.slice(0, 7),
    txn_date: txnDate,
    description,
    amount: Math.abs(signed),
    category,
    flow,
    account_kind,
    foreignAccount,
    foreignCategory,
  };
}

function isDrop(r: NormalizedRow | DropReason): r is DropReason {
  return (r as DropReason).reason !== undefined;
}

export function normalizeAll(
  rows: string[][],
  headers: string[],
  ctx: NormalizeContext
): { rows: NormalizedRow[]; dropped: DropReason[] } {
  const out: NormalizedRow[] = [];
  const dropped: DropReason[] = [];
  rows.forEach((row, i) => {
    const r = normalizeRow(row, headers, ctx, i + 1);
    if (isDrop(r)) dropped.push(r);
    else out.push(r);
  });
  return { rows: out, dropped };
}
