"""Statement verifier — the automatic correctness oracle (the "reward signal").

Phase 2 of the self-improving parser (see internal/self-improving-parser-plan.md).
Lifts the reconciliation that lives inside parse_statements (`_walk_chequing` /
`chequing_report`) into a standalone, source-agnostic check, and adds a card check
that uses the newly-captured opening balance.

    verify(transactions, meta, text) -> VerifyResult

Confidence reflects how strong the available check is. Chequing prints a running
balance, so it reconciles row-by-row and ties to the printed closing (high
confidence). Cards have no running balance, so the check is a one-sided balance
bound until payment-side rows or the printed new-transactions total are extracted
(medium confidence) — see the plan, sections 4.1 and 4.4.

NOT wired into the live pipeline yet: Phase 3 rebuilds the orchestrator into the
Tier 1/2/3 ladder and uses this as the gate. Today this is a tested library.
"""
from dataclasses import dataclass, field
from typing import List, Optional

import parse_statements as ps

TOL = 0.01
_CHARGE_FLOWS = ("spend", "fee_interest", "transfer")   # increase card balance owed
_CREDIT_FLOWS = ("payment", "income")                   # reduce it (refunds/credits)


@dataclass
class Check:
    name: str
    expected: Optional[float]
    actual: Optional[float]
    passed: bool


@dataclass
class VerifyResult:
    ok: bool
    method: str            # running_balance | card_balance | none
    confidence: float
    residual: float
    checks: List[Check] = field(default_factory=list)


def verify(transactions, meta, text: str = "") -> VerifyResult:
    """Verify a parsed statement reconciles. `meta` is the statement_meta() dict
    (must include opening_balance + closing_balance for cards); `text` is the raw
    pdftotext output (used to re-walk chequing)."""
    if not meta:
        return VerifyResult(False, "none", 0.0, 0.0, [])
    source = meta.get("source")
    if source == "cibc_chequing":
        return _verify_chequing(meta, text)
    if source in ("amex", "cibc_visa"):
        return _verify_card(transactions, meta)
    return VerifyResult(False, "none", 0.0, 0.0, [])


def _verify_chequing(meta, text: str) -> VerifyResult:
    # Re-walk the statement text: every row must reconcile against the printed
    # running balance, and the final balance must tie to the printed closing.
    # (Phase 3 will instead verify the extractor's own balance-carrying rows; for
    # the deterministic Tier-1 parser, re-walking is equivalent.)
    _period, txns = ps._walk_chequing_text(text)
    reconciled = [x for x in txns if x["direction"] != "unreconciled"]
    unreconciled = len(txns) - len(reconciled)
    parsed_closing = reconciled[-1]["balance"] if reconciled else None
    closing = meta.get("closing_balance")

    checks = [
        Check("has_rows", None, float(len(reconciled)), len(reconciled) > 0),
        Check("no_unreconciled", 0.0, float(unreconciled), unreconciled == 0),
    ]
    residual = 0.0
    if parsed_closing is not None and closing is not None:
        residual = round(parsed_closing - closing, 2)
        checks.append(Check("closing_ties", closing, round(parsed_closing, 2),
                            abs(residual) < TOL))

    ok = all(c.passed for c in checks)
    return VerifyResult(ok, "running_balance", 1.0 if ok else 0.3, residual, checks)


def _verify_card(transactions, meta) -> VerifyResult:
    opening = meta.get("opening_balance")
    closing = meta.get("closing_balance")
    if opening is None or closing is None:
        return VerifyResult(False, "card_balance", 0.0, 0.0,
                            [Check("balances_present", None, None, False)])

    charges = round(sum(r[5] for r in transactions if r[7] in _CHARGE_FLOWS), 2)
    credits = round(sum(r[5] for r in transactions if r[7] in _CREDIT_FLOWS), 2)
    # closing = opening + charges - credits  ->  (charges - credits) - delta == 0
    delta = round(closing - opening, 2)
    residual = round(charges - credits - delta, 2)
    two_sided = any(r[7] in _CREDIT_FLOWS for r in transactions)

    if two_sided:
        # Both sides present — the identity should hold exactly.
        passed, confidence = abs(residual) <= TOL, 0.9
    else:
        # Payments aren't parsed yet, so residual == total unaccounted payments,
        # which must be >= 0 for a correct parse. One-sided lower bound: catches
        # under-captured charges and gross balance misreads, not phantom charges.
        passed, confidence = residual >= -TOL, 0.6

    checks = [Check("card_balance", delta, round(charges - credits, 2), passed)]
    return VerifyResult(passed, "card_balance", confidence if passed else 0.2,
                        residual, checks)
