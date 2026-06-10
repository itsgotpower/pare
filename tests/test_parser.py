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
from categories import categorize  # noqa: E402


# --- Synthetic fixtures -------------------------------------------------------

AMEX = """\
American Express
Prepared For              Account Number        Opening Date          Closing Date
TEST USER                 XXXX X1003            Dec 03, 2025          Jan 02, 2026
       Previous Balance                                      $100.00
Equals New Balance                                            $169.12
New Transactions for TEST USER
Dec 15        Dec 16        TEST MERCHANT VANCOUVER          12.34
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
Total for 4500 XXXX XXXX 1003
Previous balance                                                                 $163.24
Total balance                                                       =            $8,401.31
Amount Due1                                                                      $8,401.31
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


def _rows(parse_fn, fixture):
    with mock.patch.object(P, "text", return_value=fixture):
        return parse_fn("dummy.pdf")


class TestAmex(unittest.TestCase):
    def setUp(self):
        self.rows = _rows(P.parse_amex, AMEX)

    def test_count_and_period(self):
        self.assertEqual(len(self.rows), 2)
        # period must be the CLOSING date, not the opening date
        self.assertEqual(self.rows[0][2], "Jan 02, 2026")

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
        self.assertAlmostEqual(m["closing_balance"], 169.12)
        self.assertEqual(m["closing_date"], "2026-01-02")

    def test_visa_total_balance(self):
        m = self._meta(CIBC_VISA)
        self.assertEqual(m["source"], "cibc_visa")
        self.assertAlmostEqual(m["closing_balance"], 8401.31)
        # period "February 28 to March 27, 2026" -> full month names
        self.assertEqual(m["closing_date"], "2026-03-27")

    def test_chequing_closing_balance(self):
        m = self._meta(CIBC_CHEQUING)
        self.assertEqual(m["source"], "cibc_chequing")
        self.assertAlmostEqual(m["closing_balance"], 2766.00)
        self.assertEqual(m["closing_date"], "2026-03-31")

    def test_unrecognized_returns_none(self):
        self.assertIsNone(self._meta("Some random unrelated PDF text"))

    def test_period_end_shapes(self):
        self.assertEqual(P.period_end("Jan 02, 2026"), "2026-01-02")
        self.assertEqual(P.period_end("Apr 1 to Apr 30, 2026"), "2026-04-30")
        self.assertEqual(
            P.period_end("January 28 to September 27, 2026"), "2026-09-27"
        )
        self.assertIsNone(P.period_end("cibc_visa"))


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


if __name__ == "__main__":
    unittest.main()
