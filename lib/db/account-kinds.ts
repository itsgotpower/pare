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

// Universe A — "card spend": the charts that count only credit-card purchases
// (summary / baseline / heatmap / goals / insights). Part 2 replaces the inline
// `flow = 'spend' AND source IN ('amex','cibc_visa')` with this.
export const CARD_SPEND_WHERE = `flow = 'spend' AND account_kind = 'card'`;

// Universe B — "total outflow" (cashflow / forecast / income): card spend plus
// chequing debits, fees, and categorized chequing transfers (rent). Card
// payments stay excluded to avoid double-counting. Part 2 replaces the three
// duplicated inline copies of this block with this constant.
export const OUTFLOW_WHERE = `(
  (flow = 'spend' AND account_kind = 'card')
  OR (account_kind = 'chequing' AND flow = 'spend')
  OR (account_kind = 'chequing' AND flow = 'fee_interest')
  OR (account_kind = 'chequing' AND flow = 'transfer' AND effective_category != 'Banking')
)`;

// Map a parser `source` to its account kind. The PDF parser only ever emits
// these three sources; anything else (e.g. a future import that neglected to
// set a kind) falls back to 'unknown' so the row is simply ABSENT from the
// charts rather than silently miscounted.
export function sourceToKind(source: string): AccountKind {
  if (source === "amex" || source === "cibc_visa") return "card";
  if (source === "cibc_chequing") return "chequing";
  return "unknown";
}
