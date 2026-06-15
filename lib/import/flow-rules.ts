// Flow inference: map a normalized foreign row to one of pare's five legal
// `flow` values. The flow CHECK constraint is ('spend','payment','income',
// 'transfer','fee_interest') — emit anything else and INSERT OR IGNORE silently
// drops the row. First-match-wins, mirroring categorizeByRules.
//
// The load-bearing case is the transfer/payment seam: a "Credit Card Payment"
// exports as TWO legs (an outflow on the funding account, an inflow on the
// card). The OUTFLOW_WHERE universe excludes `payment` entirely and counts a
// chequing `transfer` only when categorized away from 'Banking', so steering
// BOTH payment legs to `payment` is what prevents the payment from being
// double-counted as outflow on top of the card purchases it settles.

import type { AccountKind } from "../db/account-kinds";

export type Flow = "spend" | "payment" | "income" | "transfer" | "fee_interest";

export interface FlowInput {
  signedAmount: number; // negative = money out, positive = money in
  foreignCategory: string; // the provider's category string (any case)
  accountKind: AccountKind;
}

const PAYMENT_RE = /credit card payment|card payment|cc payment|payment\/?transfer/;
const TRANSFER_RE = /transfer|transferencia|move money|balance adjustment/;
const FEE_RE =
  /interest|finance charge|service charge|bank fee|atm fee|overdraft|\bnsf\b|\bfees?\b/;

export function inferFlow({ signedAmount, foreignCategory, accountKind }: FlowInput): Flow {
  const c = foreignCategory.toLowerCase();

  // 1. Credit-card payment, EITHER leg (funding-account outflow or card inflow).
  if (PAYMENT_RE.test(c)) return "payment";
  // 2. Recognizable between-account transfers (either direction).
  if (TRANSFER_RE.test(c)) return "transfer";
  // 3. Fees / interest (either direction; usually a charge).
  if (FEE_RE.test(c)) return "fee_interest";

  // 4. Inbound money.
  if (signedAmount > 0) {
    // A positive amount on a CARD is money back to the card (a refund/credit),
    // not earnings — keep it out of the income charts.
    if (accountKind === "card") return "payment";
    return "income";
  }

  // 5. Everything else outbound is spend.
  return "spend";
}
