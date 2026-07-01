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

  // Convention: `<bank>_<kind>` — the suffix names the account kind.
  if (/_chequing$/.test(source)) return "chequing";
  if (/_savings$/.test(source)) return "savings";
  if (/_investment$/.test(source)) return "investment";
  if (/_cash$/.test(source)) return "chequing"; // Wealthsimple Cash spends like chequing
  if (/_(visa|mastercard|mc|amex|card|aeroplan|infinite|cashback)$/.test(source))
    return "card";

  return "unknown";
}
