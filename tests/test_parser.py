"""Regression tests for the statement parser and categorizer.

All fixtures are SYNTHETIC (fabricated merchants/amounts/handles) — no real
financial data. They mimic the `pdftotext -layout` output of each statement type
so the parse functions can be exercised without real PDFs (we monkeypatch the
module-level `text()` extractor).

Run:  python3 -m unittest discover -s tests   (from the parse/ dir)

These guard the bugs fixed during development:
  - chequing balance reconciliation + multi-line folding + FX-note exclusion
  - CIBC Visa "Spend Categories" vocabulary split (no truncated descriptions)
  - Amex closing-date period + Dec→prior-year inference
  - the PHO / PAYBYPHONE substring collision
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib", "parser"))

import parse_statements as P  # noqa: E402
import verify as V  # noqa: E402
from categories import categorize  # noqa: E402


# --- Synthetic fixtures -------------------------------------------------------

AMEX = """\
American Express
Prepared For              Account Number        Opening Date          Closing Date
TEST USER                 XXXX X1003            Dec 03, 2025          Jan 02, 2026
       Previous Balance                                      $100.00
Equals New Balance                                            $144.12
New Transactions for TEST USER
Dec 15        Dec 16        TEST MERCHANT VANCOUVER          12.34
Dec 20        Dec 21        GADGET SHOP REFUND VANCOUVER          -25.00
Jan 01        Jan 02        ANOTHER STORE TORONTO          56.78
Total of New Transactions
"""

CIBC_VISA = """\
CIBC Aeroplan Visa
Account statement for the period February 28 to March 27, 2026
Your new charges and credits
Trans date     Post date     Description                  Spend Categories            Amount($)
Feb 28         Mar 01        BLENZ COFFEE BAR         VANCOUVER  BC     Restaurants                 7.35
Mar 02         Mar 03        Q REAL CDN SUPERSTORE    VANCOUVER  BC     Retail and Grocery         30.72
Mar 05         Mar 06        BALANCE TRANSFER                           Retail and Grocery       8,000.00
Mar 06         Mar 06        CASH ADV/BT/CONV CHQ FEE                   Professional and Financial Services    200.00
Mar 08         Mar 09        AMZN MKTP CA REFUND      VANCOUVER  BC     Retail and Grocery         20.00 CR
Total for 4500 XXXX XXXX 1003
Previous balance                                                                 $163.24
Total balance                                                       =            $8,381.31
Amount Due1                                                                      $8,381.31
"""

CIBC_CHEQUING = """\
CIBC Account Statement
For Mar 1 to Mar 31, 2026
Account summary
Opening balance on Mar 1, 2026                                      $1,000.00
Withdrawals                                       -                 1,234.00
Deposits                                          +                 3,000.00
                                                  =                 $2,766.00
Closing balance on Mar 31, 2026
Transaction details
Date          Description                                 Withdrawals ($)       Deposits ($)                Balance ($)
Mar 1         Opening balance                                                                                $1,000.00
Mar 2         PAY                                                                     2,500.00                  3,500.00
              81A8D21BD1CB285
              PEOPLE CENTER
Mar 3         E-TRANSFER        000000111             1,200.00                                                 2,300.00
              testhandle
Mar 5         INTERNET CARD PAYMENT                        34.00                                              2,266.00
              CIBC CARD PRODUCTS DIVISION
              20.00 USD @ 1.7000
Mar 10        DEPOSIT                                                              500.00                      2,766.00
              Rembours. d'impot/Tax Refund
Page 1 of 1
"""


# --- Scaffolded banks (RBC / TD / Scotia / BMO / Tangerine / Wealthsimple) ----
# All SYNTHETIC and UNVERIFIED against real PDFs — they pin the scaffold parsers'
# current behaviour and the registry routing, not real-world fidelity.

RBC_VISA = """\
RBC Royal Bank
Visa Classic
STATEMENT FROM October 1, 2026 TO October 31, 2026
TRANSACTION  POSTING   ACTIVITY DESCRIPTION                AMOUNT ($)
DATE         DATE
Oct 02       Oct 03    STARBUCKS #1234 VANCOUVER            5.75
Oct 04       Oct 05    REAL CDN SUPERSTORE VANCOUVER       42.10
Oct 10       Oct 11    PAYMENT - THANK YOU              -150.00
Oct 15       Oct 16    AMZN MKTP CA REFUND               -20.00
NEW BALANCE                                            $1,234.56
"""

RBC_CHEQUING = """\
RBC Royal Bank
Your account statement
From October 1, 2026 to October 31, 2026
Opening Balance                                                    $1,000.00
Date          Description                          Withdrawals ($)    Deposits ($)      Balance ($)
Oct 1         Opening Balance                                                            1,000.00
Oct 3         Payroll Deposit                                          2,000.00          3,000.00
              PAYROLL ACME CORP
Oct 5         e-Transfer sent                       500.00                               2,500.00
              jdoe
Oct 12        Hydro Bill Payment                    120.00                               2,380.00
Closing Balance                                                       $2,380.00
Page 1 of 1
"""

TD_VISA = """\
TD Canada Trust
TD Visa Infinite
STATEMENT PERIOD September 1 to September 30, 2026
Sep 03   Sep 04   TIM HORTONS #456 TORONTO        4.25
Sep 10   Sep 11   PAYMENT - THANK YOU            -300.00
NEW BALANCE                                       $842.00
"""

SCOTIA_VISA = """\
Scotiabank
Scotia Momentum Visa
For the period August 1 to August 31, 2026
Aug 05   Aug 06   SAFEWAY #123 CALGARY            58.40
Aug 20   Aug 21   PAYMENT THANK YOU             -200.00
NEW BALANCE                                     $1,005.55
"""

BMO_MC = """\
BMO Bank of Montreal
BMO CashBack Mastercard
Statement period July 1 to July 31, 2026
Jul 07   Jul 08   SHELL #9001 EDMONTON            62.10
Jul 15   Jul 16   PAYMENT RECEIVED              -150.00 CR
NEW BALANCE                                       $512.34
"""


def _ledger_fixture(brand_lines, period_phrase="From"):
    """Build a synthetic chequing/savings fixture with the common scaffold shape:
    opening 1,000 → +2,000 payroll → -500 e-transfer → -120 bill → closing 2,380.
    Reconciles: inflow 2,000, outflow 620, closing 2,380; flows income/transfer/spend.
    """
    return (
        brand_lines + "\n"
        + period_phrase + " October 1, 2026 to October 31, 2026\n"
        + "Opening Balance                                   $1,000.00\n"
        + "Date          Description            Withdrawals ($)   Deposits ($)   Balance ($)\n"
        + "Oct 1         Opening Balance                                          1,000.00\n"
        + "Oct 3         Payroll Deposit                          2,000.00        3,000.00\n"
        + "              PAYROLL ACME CORP\n"
        + "Oct 5         e-Transfer sent        500.00                            2,500.00\n"
        + "              jdoe\n"
        + "Oct 12        Hydro Bill Payment     120.00                            2,380.00\n"
        + "Closing Balance                                   $2,380.00\n"
        + "Page 1 of 1\n"
    )


TD_CHEQUING_FIX = _ledger_fixture("TD Canada Trust\nEveryday Chequing")
SCOTIA_CHEQUING_FIX = _ledger_fixture("Scotiabank\nBasic Bank Account")
BMO_CHEQUING_FIX = _ledger_fixture("BMO Bank of Montreal\nPerformance Chequing")
TANGERINE_CHEQUING_FIX = _ledger_fixture("Tangerine\nNo-Fee Chequing Account")
TANGERINE_SAVINGS_FIX = _ledger_fixture("Tangerine\nSavings Account")
WS_CASH_FIX = _ledger_fixture("Wealthsimple\nWealthsimple Cash")
WS_SAVINGS_FIX = _ledger_fixture("Wealthsimple\nWealthsimple Savings Account")


def _rows(parse_fn, fixture):
    with mock.patch.object(P, "text", return_value=fixture):
        return parse_fn("dummy.pdf")


class TestAmex(unittest.TestCase):
    def setUp(self):
        self.rows = _rows(P.parse_amex, AMEX)

    def test_count_and_period(self):
        self.assertEqual(len(self.rows), 3)
        # period must be the CLOSING date, not the opening date
        self.assertEqual(self.rows[0][2], "Jan 02, 2026")

    def test_negative_amount_is_credit_not_spend(self):
        # A refund ("-25.00") must store a POSITIVE amount with flow='income',
        # not a negative flow='spend' row that skews the spend charts.
        refund = next(r for r in self.rows if "GADGET SHOP REFUND" in r[4])
        self.assertEqual(refund[7], "income")
        self.assertAlmostEqual(refund[5], 25.00)

    def test_dec_rolls_back_to_prior_year(self):
        dec = next(r for r in self.rows if "TEST MERCHANT" in r[4])
        self.assertEqual(dec[3], "2025-12-15")

    def test_jan_stays_closing_year(self):
        jan = next(r for r in self.rows if "ANOTHER STORE" in r[4])
        self.assertEqual(jan[3], "2026-01-01")

    def test_amounts_positive(self):
        self.assertTrue(all(r[5] > 0 for r in self.rows))


class TestCibcVisa(unittest.TestCase):
    def setUp(self):
        self.rows = _rows(P.parse_cibc_visa, CIBC_VISA)

    def test_full_description_not_truncated(self):
        # The core Visa bug: the description used to get truncated at the
        # Spend-Categories boundary (e.g. "BLENZ COFFEE BAR" -> "BLENZ").
        bb = next(r for r in self.rows if r[4].startswith("BLENZ"))
        self.assertIn("BLENZ COFFEE BAR", bb[4])
        self.assertEqual(bb[6], "Coffee")

    def test_grocery_vocab_split(self):
        rc = next(r for r in self.rows if "REAL CDN" in r[4])
        self.assertEqual(rc[6], "Groceries")
        self.assertAlmostEqual(rc[5], 30.72)

    def test_balance_transfer_and_cash_adv_flows(self):
        bt = next(r for r in self.rows if r[4] == "BALANCE TRANSFER")
        self.assertEqual(bt[7], "transfer")
        self.assertAlmostEqual(bt[5], 8000.00)
        ca = next(r for r in self.rows if "CASH ADV" in r[4])
        self.assertEqual(ca[7], "fee_interest")
        self.assertAlmostEqual(ca[5], 200.00)

    def test_trailing_cr_is_credit_not_spend(self):
        # The section header says "charges and credits" — a "20.00 CR" refund
        # must store a positive amount with flow='income', not spend.
        refund = next(r for r in self.rows if "REFUND" in r[4])
        self.assertEqual(refund[7], "income")
        self.assertAlmostEqual(refund[5], 20.00)

    def test_amounts_positive(self):
        self.assertTrue(all(r[5] > 0 for r in self.rows))


class TestCibcChequing(unittest.TestCase):
    def setUp(self):
        self.rows = _rows(P.parse_cibc_chequing, CIBC_CHEQUING)

    def test_four_transactions(self):
        # The FX note "20.00 USD @ 1.7000" must NOT become a transaction.
        self.assertEqual(len(self.rows), 4)

    def test_flows(self):
        self.assertEqual(
            [r[7] for r in self.rows],
            ["income", "transfer", "payment", "income"],
        )

    def test_payroll_is_income(self):
        pay = next(r for r in self.rows if "PEOPLE CENTER" in r[4])
        self.assertEqual(pay[7], "income")

    def test_etransfer_recipient_folded(self):
        et = next(r for r in self.rows if r[7] == "transfer")
        self.assertIn("testhandle", et[4])
        self.assertAlmostEqual(et[5], 1200.00)

    def test_card_payment_amount_not_fx(self):
        pay = next(r for r in self.rows if r[7] == "payment")
        self.assertAlmostEqual(pay[5], 34.00)  # not 20.00 from the USD note

    def test_reconciliation_report_ties_to_summary(self):
        with mock.patch.object(P, "text", return_value=CIBC_CHEQUING):
            rep = P.chequing_report("dummy.pdf")
        self.assertEqual(rep["unreconciled"], 0)
        self.assertAlmostEqual(rep["parsed_outflow"], 1234.00)
        self.assertAlmostEqual(rep["parsed_inflow"], 3000.00)
        self.assertAlmostEqual(rep["parsed_closing"], 2766.00)
        self.assertAlmostEqual(rep["summary"]["withdrawals"], 1234.00)
        self.assertAlmostEqual(rep["summary"]["deposits"], 3000.00)


class TestStatementMeta(unittest.TestCase):
    """Closing balance + closing date extraction (statement-cadence net worth)."""

    def _meta(self, fixture):
        with mock.patch.object(P, "text", return_value=fixture):
            return P.statement_meta("dummy.pdf")

    def test_amex_new_balance(self):
        m = self._meta(AMEX)
        self.assertEqual(m["source"], "amex")
        self.assertAlmostEqual(m["closing_balance"], 144.12)
        self.assertEqual(m["closing_date"], "2026-01-02")

    def test_visa_total_balance(self):
        m = self._meta(CIBC_VISA)
        self.assertEqual(m["source"], "cibc_visa")
        self.assertAlmostEqual(m["closing_balance"], 8381.31)
        # period "February 28 to March 27, 2026" -> full month names
        self.assertEqual(m["closing_date"], "2026-03-27")

    def test_chequing_closing_balance(self):
        m = self._meta(CIBC_CHEQUING)
        self.assertEqual(m["source"], "cibc_chequing")
        self.assertAlmostEqual(m["closing_balance"], 2766.00)
        self.assertEqual(m["closing_date"], "2026-03-31")

    def test_unrecognized_returns_none(self):
        self.assertIsNone(self._meta("Some random unrelated PDF text"))

    def test_opening_balances(self):
        # Phase 2: opening (previous) balance captured for cards + chequing,
        # so verify.py can reconcile card balances.
        self.assertAlmostEqual(self._meta(AMEX)["opening_balance"], 100.00)
        self.assertAlmostEqual(self._meta(CIBC_VISA)["opening_balance"], 163.24)
        self.assertAlmostEqual(self._meta(CIBC_CHEQUING)["opening_balance"], 1000.00)

    def test_period_end_shapes(self):
        self.assertEqual(P.period_end("Jan 02, 2026"), "2026-01-02")
        self.assertEqual(P.period_end("Apr 1 to Apr 30, 2026"), "2026-04-30")
        self.assertEqual(
            P.period_end("January 28 to September 27, 2026"), "2026-09-27"
        )
        self.assertIsNone(P.period_end("cibc_visa"))


class TestRegistryRouting(unittest.TestCase):
    """Phase 1 of the self-improving parser: routing moved from main()'s if/elif
    into registry.select() + orchestrator.parse_file(). These guard that the new
    path picks the SAME parser the old precedence did (Visa -> chequing -> Amex
    fallback) and produces identical rows."""

    def setUp(self):
        import registry
        registry.register_builtins(P)  # idempotent
        self.registry = registry

    def test_precedence_matches_original_if_elif(self):
        # Visa and chequing fixtures must NOT fall through to the Amex fallback
        # (both contain "American Express" via card-payment lines).
        self.assertEqual(self.registry.select(CIBC_VISA).id, "cibc_visa")
        self.assertEqual(self.registry.select(CIBC_CHEQUING).id, "cibc_chequing")
        self.assertEqual(self.registry.select(AMEX).id, "amex")

    def test_unrecognized_returns_none(self):
        self.assertIsNone(self.registry.select("Some unrelated PDF text"))

    def test_orchestrator_reproduces_direct_parse(self):
        import orchestrator
        with mock.patch.object(P, "text", return_value=CIBC_CHEQUING):
            rows, meta = orchestrator.parse_file(
                "dummy.pdf", text_fn=P.text, meta_fn=P.statement_meta)
        # Routing through the orchestrator yields the same rows as calling the
        # parser directly, plus the statement metadata.
        self.assertEqual(rows, _rows(P.parse_cibc_chequing, CIBC_CHEQUING))
        self.assertEqual(meta["source"], "cibc_chequing")

    def test_orchestrator_skips_unrecognized(self):
        import orchestrator
        with mock.patch.object(P, "text", return_value="Some unrelated PDF text"):
            self.assertIsNone(orchestrator.parse_file(
                "dummy.pdf", text_fn=P.text, meta_fn=P.statement_meta))


class TestVerify(unittest.TestCase):
    """Phase 2: the standalone verifier (verify.py). Chequing reconciles via the
    running-balance chain; cards via opening/closing balance. Failure cases must
    be caught (the whole point of the verifier)."""

    def _rows_meta(self, parse_fn, fixture):
        with mock.patch.object(P, "text", return_value=fixture):
            return parse_fn("dummy.pdf"), P.statement_meta("dummy.pdf")

    def test_chequing_reconciles(self):
        rows, meta = self._rows_meta(P.parse_cibc_chequing, CIBC_CHEQUING)
        r = V.verify(rows, meta, CIBC_CHEQUING)
        self.assertTrue(r.ok)
        self.assertEqual(r.method, "running_balance")
        self.assertEqual(r.confidence, 1.0)

    def test_chequing_wrong_closing_is_caught(self):
        rows, meta = self._rows_meta(P.parse_cibc_chequing, CIBC_CHEQUING)
        meta = {**meta, "closing_balance": 9999.99}  # tamper the printed closing
        self.assertFalse(V.verify(rows, meta, CIBC_CHEQUING).ok)

    def test_amex_card_balance_reconciles(self):
        rows, meta = self._rows_meta(P.parse_amex, AMEX)
        r = V.verify(rows, meta, AMEX)
        self.assertTrue(r.ok)
        self.assertEqual(r.method, "card_balance")
        self.assertAlmostEqual(r.residual, 0.0)
        # The fixture has a refund row, so both sides are present and the
        # identity holds exactly (two-sided, high confidence).
        self.assertAlmostEqual(r.confidence, 0.9)

    def test_visa_card_balance_reconciles(self):
        rows, meta = self._rows_meta(P.parse_cibc_visa, CIBC_VISA)
        r = V.verify(rows, meta, CIBC_VISA)
        self.assertTrue(r.ok)
        self.assertAlmostEqual(r.residual, 0.0)

    def test_card_undercapture_is_caught(self):
        # Dropping a charge makes Σcharges too small -> residual negative -> fail.
        rows, meta = self._rows_meta(P.parse_cibc_visa, CIBC_VISA)
        rows = [r for r in rows if r[4] != "BALANCE TRANSFER"]  # drop an 8000 charge
        r = V.verify(rows, meta, CIBC_VISA)
        self.assertFalse(r.ok)
        self.assertLess(r.residual, 0)

    def test_missing_opening_balance_does_not_pass(self):
        rows, meta = self._rows_meta(P.parse_amex, AMEX)
        meta = {**meta, "opening_balance": None}
        self.assertFalse(V.verify(rows, meta, AMEX).ok)


class TestCategorizer(unittest.TestCase):
    def test_paybyphone_is_transport_not_restaurants(self):
        # The PHO substring collision regression.
        self.assertEqual(
            categorize("CITY OF VAN PAYBYPHONE VANCOUVER"),
            "Transport / gas / parking",
        )

    def test_pho_restaurant_still_matches(self):
        self.assertEqual(categorize("PHO DON 001 VANCOUVER"), "Restaurants & takeout")

    def test_known_merchants(self):
        cases = {
            "STARBUCKS #1234 VANCOUVER": "Coffee",
            "REAL CDN SUPERSTORE #1": "Groceries",
            "DOWNTOWN DENTAL CLINIC": "Health / pharmacy",
            "GOOGLE*YOUTUBEPREMIUM G G.CO HELPPAY#": "Subscriptions",
        }
        for desc, expected in cases.items():
            self.assertEqual(categorize(desc), expected, desc)

    def test_unknown_is_uncategorized(self):
        self.assertEqual(categorize("ZZZ NONSENSE 999"), "Other / uncategorized")


class TestRbcVisa(unittest.TestCase):
    """RBC Visa scaffold via the shared two-date card engine."""

    def setUp(self):
        self.rows = _rows(P.parse_rbc_visa, RBC_VISA)

    def test_count(self):
        self.assertEqual(len(self.rows), 4)

    def test_period_is_closing_date(self):
        self.assertEqual(self.rows[0][2], "October 31, 2026")
        self.assertEqual(self.rows[0][3], "2026-10-02")

    def test_spend_rows(self):
        sb = next(r for r in self.rows if r[4].startswith("STARBUCKS"))
        self.assertEqual(sb[6], "Coffee")
        self.assertEqual(sb[7], "spend")
        self.assertAlmostEqual(sb[5], 5.75)

    def test_payment_credit(self):
        pay = next(r for r in self.rows if "PAYMENT" in r[4])
        self.assertEqual(pay[7], "payment")
        self.assertAlmostEqual(pay[5], 150.00)  # stored positive

    def test_refund_credit_is_income(self):
        rf = next(r for r in self.rows if "REFUND" in r[4])
        self.assertEqual(rf[7], "income")
        self.assertAlmostEqual(rf[5], 20.00)

    def test_source(self):
        self.assertTrue(all(r[0] == "rbc_visa" for r in self.rows))


class TestRbcChequing(unittest.TestCase):
    """RBC chequing scaffold via the shared balance-reconciling ledger engine."""

    def setUp(self):
        self.rows = _rows(lambda p: P._parse_ledger(p, P.RBC_CHEQUING), RBC_CHEQUING)

    def test_three_transactions(self):
        self.assertEqual(len(self.rows), 3)

    def test_flows(self):
        self.assertEqual(
            [r[7] for r in self.rows], ["income", "transfer", "spend"]
        )

    def test_source_and_category(self):
        self.assertTrue(all(r[0] == "rbc_chequing" for r in self.rows))
        self.assertTrue(all(r[6] == "Banking" for r in self.rows))

    def test_reconciliation(self):
        with mock.patch.object(P, "text", return_value=RBC_CHEQUING):
            rep = P.ledger_report("dummy.pdf", P.RBC_CHEQUING)
        self.assertEqual(rep["unreconciled"], 0)
        self.assertAlmostEqual(rep["parsed_inflow"], 2000.00)
        self.assertAlmostEqual(rep["parsed_outflow"], 620.00)
        self.assertAlmostEqual(rep["parsed_closing"], 2380.00)


class TestScaffoldCards(unittest.TestCase):
    """TD / Scotia / BMO card scaffolds via the shared _parse_card engine."""

    CASES = [
        (P.TD_CARD, TD_VISA, "td_visa", 842.00, "2026-09-30"),
        (P.SCOTIA_CARD, SCOTIA_VISA, "scotia_visa", 1005.55, "2026-08-31"),
        (P.BMO_CARD, BMO_MC, "bmo_mastercard", 512.34, "2026-07-31"),
    ]

    def test_parse_and_flows(self):
        for profile, fix, source, _bal, _date in self.CASES:
            rows = _rows(lambda p, _pr=profile: P._parse_card(p, _pr), fix)
            self.assertEqual(len(rows), 2, source)
            self.assertTrue(all(r[0] == source for r in rows), source)
            spend = next(r for r in rows if r[7] == "spend")
            self.assertGreater(spend[5], 0)
            pay = next(r for r in rows if r[7] == "payment")
            self.assertIn("PAYMENT", pay[4].upper())
            self.assertGreater(pay[5], 0)  # stored positive

    def test_meta(self):
        for profile, fix, source, bal, date in self.CASES:
            with mock.patch.object(P, "text", return_value=fix):
                m = P._card_meta("dummy.pdf", profile)
            self.assertEqual(m["source"], source)
            self.assertAlmostEqual(m["closing_balance"], bal)
            self.assertEqual(m["closing_date"], date)


class TestScaffoldLedgers(unittest.TestCase):
    """TD / Scotia / BMO chequing + Tangerine/Wealthsimple chequing & savings,
    all via the shared balance-reconciling _walk_ledger engine."""

    CASES = [
        (P.TD_CHEQUING, TD_CHEQUING_FIX, "td_chequing"),
        (P.SCOTIA_CHEQUING, SCOTIA_CHEQUING_FIX, "scotia_chequing"),
        (P.BMO_CHEQUING, BMO_CHEQUING_FIX, "bmo_chequing"),
        (P.TANGERINE_CHEQUING, TANGERINE_CHEQUING_FIX, "tangerine_chequing"),
        (P.TANGERINE_SAVINGS, TANGERINE_SAVINGS_FIX, "tangerine_savings"),
        (P.WS_CASH, WS_CASH_FIX, "wealthsimple_cash"),
        (P.WS_SAVINGS, WS_SAVINGS_FIX, "wealthsimple_savings"),
    ]

    def test_parse_and_reconcile(self):
        for profile, fix, source in self.CASES:
            rows = _rows(lambda p, _pr=profile: P._parse_ledger(p, _pr), fix)
            self.assertEqual([r[7] for r in rows], ["income", "transfer", "spend"], source)
            self.assertTrue(all(r[0] == source for r in rows), source)
            self.assertTrue(all(r[6] == "Banking" for r in rows), source)
            with mock.patch.object(P, "text", return_value=fix):
                rep = P.ledger_report("dummy.pdf", profile)
            self.assertEqual(rep["unreconciled"], 0, source)
            self.assertAlmostEqual(rep["parsed_inflow"], 2000.00, msg=source)
            self.assertAlmostEqual(rep["parsed_outflow"], 620.00, msg=source)
            self.assertAlmostEqual(rep["parsed_closing"], 2380.00, msg=source)


class TestScaffoldRouting(unittest.TestCase):
    """statement_meta() must route every fixture to the right source — proves
    detector specificity + ordering (Amex-last fallback, and the
    savings-before-chequing split for Tangerine/Wealthsimple)."""

    CASES = [
        (AMEX, "amex"),
        (CIBC_VISA, "cibc_visa"),
        (CIBC_CHEQUING, "cibc_chequing"),
        (RBC_VISA, "rbc_visa"),
        (RBC_CHEQUING, "rbc_chequing"),
        (TD_VISA, "td_visa"),
        (TD_CHEQUING_FIX, "td_chequing"),
        (SCOTIA_VISA, "scotia_visa"),
        (SCOTIA_CHEQUING_FIX, "scotia_chequing"),
        (BMO_MC, "bmo_mastercard"),
        (BMO_CHEQUING_FIX, "bmo_chequing"),
        (TANGERINE_CHEQUING_FIX, "tangerine_chequing"),
        (TANGERINE_SAVINGS_FIX, "tangerine_savings"),
        (WS_CASH_FIX, "wealthsimple_cash"),
        (WS_SAVINGS_FIX, "wealthsimple_savings"),
    ]

    def test_routes_to_expected_source(self):
        for fix, source in self.CASES:
            with mock.patch.object(P, "text", return_value=fix):
                m = P.statement_meta("dummy.pdf")
            self.assertIsNotNone(m, source)
            self.assertEqual(m["source"], source, source)

    def test_registry_routes_scaffolds(self):
        # The routing registry (registry.select) must also pick the scaffold
        # parsers once registered, keeping Amex the last-priority fallback.
        import registry
        registry.register_builtins(P)
        registry.register_scaffolds(P)
        self.assertEqual(registry.select(RBC_VISA).id, "rbc_visa")
        self.assertEqual(registry.select(WS_SAVINGS_FIX).id, "wealthsimple_savings")
        self.assertEqual(registry.select(AMEX).id, "amex")  # fallback intact


class TestScaffoldMeta(unittest.TestCase):
    """Scaffold statement_meta (closing balance + date). No opening_balance yet
    (scaffolds aren't verified against real PDFs)."""

    def _meta(self, fixture):
        with mock.patch.object(P, "text", return_value=fixture):
            return P.statement_meta("dummy.pdf")

    def test_rbc_visa_new_balance(self):
        m = self._meta(RBC_VISA)
        self.assertEqual(m["source"], "rbc_visa")
        self.assertAlmostEqual(m["closing_balance"], 1234.56)
        self.assertEqual(m["closing_date"], "2026-10-31")

    def test_rbc_chequing_closing_balance(self):
        m = self._meta(RBC_CHEQUING)
        self.assertEqual(m["source"], "rbc_chequing")
        self.assertAlmostEqual(m["closing_balance"], 2380.00)
        self.assertEqual(m["closing_date"], "2026-10-31")


if __name__ == "__main__":
    unittest.main()
