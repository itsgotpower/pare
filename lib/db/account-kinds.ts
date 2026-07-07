// Account "kind" — the analytics-facing classification of a transaction's
// account, decoupled from the concrete `source` string. The query layer keys
// its spend/outflow universes off this (see Part 2), so imported data
// (Monarch / Mint / YNAB) lights up every chart simply by setting account_kind
// — instead of the hardcoded `source IN ('amex','cibc_visa')` /
// `source = 'cibc_chequing'` lists the queries used to carry.

export type AccountKind =
  | "card"
  | "chequing"
  | "savings"
  | "cash"
  | "investment"
  | "unknown";

// Deposit accounts — chequing/savings/investment share one categorization
// contract (see recategorizeAll / recategorizeMatching): rules apply only to
// spend/transfer rows, income/payment/fee rows are never reclassified, and
// unmatched spend stays 'Banking' (never 'Other / uncategorized', which is the
// card-spend catch-all). Card + cash are the "purchase" universe instead. Keyed
// off this set so a NEW deposit source (a SimpleFIN savings account, an OFX
// MONEYMRKT block) gets the deposit contract automatically — the checks used to
// hardcode `account_kind = 'chequing'`, so savings/investment rows fell through
// to the card branch and their unmatched spend landed 'Other / uncategorized'.
export const DEPOSIT_KINDS: readonly AccountKind[] = ["chequing", "savings", "investment"];

export function isDepositKind(kind: string): boolean {
  return (DEPOSIT_KINDS as readonly string[]).includes(kind);
}

// SQL list literal for the same set, e.g. `account_kind IN ${DEPOSIT_KINDS_SQL}`.
export const DEPOSIT_KINDS_SQL = `('${DEPOSIT_KINDS.join("', '")}')`;

// Universe A — "discretionary spend": the charts that count direct purchases
// (summary / baseline / heatmap / goals / insights / subscriptions / merchants).
// Card purchases plus manually recorded cash spending — cash is spent the same
// way a card is swiped, so it belongs in "where did my money go". Chequing
// debits stay in Universe B only.
export const SPEND_WHERE = `flow = 'spend' AND account_kind IN ('card', 'cash')`;

// Universe B — "total outflow" (cashflow / forecast / income): the spend
// universe plus chequing debits, fees, and categorized chequing transfers
// (rent). Card payments stay excluded to avoid double-counting.
export const OUTFLOW_WHERE = `(
  (flow = 'spend' AND account_kind IN ('card', 'cash'))
  OR (account_kind = 'chequing' AND flow = 'spend')
  OR (account_kind = 'chequing' AND flow = 'fee_interest')
  OR (account_kind = 'chequing' AND flow = 'transfer' AND effective_category != 'Banking')
)`;

// Map a parser `source` to its account kind. As the parser grows to cover more
// banks (rbc_visa, td_chequing, tangerine_savings, …), keying off an explicit
// per-source list would mean editing this map for every new handler — and a
// missed entry silently drops the account to 'unknown', making it ABSENT from
// every chart. So the mapping is CONVENTION-DRIVEN: scaffolded parser sources
// follow a `<bank>_<kind>` naming scheme, and the suffix decides the kind. The
// three original sources keep explicit cases (amex / cibc_visa have no suffix).
export function sourceToKind(source: string): AccountKind {
  // Original sources (no `_<kind>` suffix convention).
  if (source === "amex" || source === "cibc_visa") return "card";
  if (source === "cibc_chequing") return "chequing";

  // In-app quick-add rows (no statement behind them) — real cash spending.
  if (source === "manual") return "cash";

  // Convention: `<bank>_<kind>` — the suffix names the account kind.
  if (/_chequing$/.test(source)) return "chequing";
  if (/_savings$/.test(source)) return "savings";
  if (/_investment$/.test(source)) return "investment";
  if (/_cash$/.test(source)) return "chequing"; // Wealthsimple Cash spends like chequing
  if (/_(visa|mastercard|mc|amex|card|aeroplan|infinite|cashback)$/.test(source))
    return "card";

  return "unknown";
}
