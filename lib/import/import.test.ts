import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "./csv";
import { detectPreset, PRESETS } from "./presets";
import { inferFlow } from "./flow-rules";
import { suggestCategory } from "./category-defaults";
import { jaccard, descSimilar, normalizeDesc } from "./overlap";
import { normalizeAll, slugifySource, guessKind, parseMoney, parseDate } from "./normalizer";
import { analyzeCsv } from "./preview";

// --- CSV hygiene -----------------------------------------------------------

test("parseCsv strips BOM + CRLF and honours quoted commas", () => {
  const text = '﻿a,b,c\r\n1,"x, y",3\r\n';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ["a", "b", "c"]);
  assert.deepEqual(rows, [["1", "x, y", "3"]]);
});

// --- Provider detection ----------------------------------------------------

test("detectPreset identifies each provider by fingerprint", () => {
  assert.equal(detectPreset(["Date", "Merchant", "Category", "Account", "Original Statement", "Amount"]), "monarch");
  assert.equal(detectPreset(["Date", "Description", "Amount", "Transaction Type", "Category", "Account Name"]), "mint");
  assert.equal(detectPreset(["Account", "Date", "Payee", "Category", "Outflow", "Inflow"]), "ynab");
  assert.equal(detectPreset(["foo", "bar"]), null);
});

// --- Field parsers ---------------------------------------------------------

test("parseMoney handles $, commas, parentheses, signs", () => {
  assert.equal(parseMoney("$1,234.56"), 1234.56);
  assert.equal(parseMoney("(12.34)"), -12.34);
  assert.equal(parseMoney("-5"), -5);
  assert.ok(Number.isNaN(parseMoney("")));
  assert.ok(Number.isNaN(parseMoney("abc")));
});

test("parseDate accepts ISO and US slash, rejects junk", () => {
  assert.equal(parseDate("2026-03-01"), "2026-03-01");
  assert.equal(parseDate("3/5/2026"), "2026-03-05");
  assert.equal(parseDate("03/05/26"), "2026-03-05");
  assert.equal(parseDate("not a date"), null);
  assert.equal(parseDate("13/40/2026"), null);
});

test("slugifySource is stable + distinct from PDF sources; guessKind reads the name", () => {
  assert.equal(slugifySource("Amex Gold Card"), "import:amex_gold_card");
  assert.equal(slugifySource("Amex Gold Card"), slugifySource("Amex Gold Card"));
  assert.equal(guessKind("Chase Sapphire Credit Card"), "card");
  assert.equal(guessKind("TD Chequing"), "chequing");
  assert.equal(guessKind("Ally Savings"), "savings");
  assert.equal(guessKind("Wealthsimple TFSA"), "investment");
  assert.equal(guessKind("Mystery"), "unknown");
});

// --- Flow inference --------------------------------------------------------

test("inferFlow covers the five flows + the double-count seam", () => {
  // outbound purchase
  assert.equal(inferFlow({ signedAmount: -5, foreignCategory: "Coffee", accountKind: "card" }), "spend");
  // inbound to a bank account = income
  assert.equal(inferFlow({ signedAmount: 2000, foreignCategory: "Paycheck", accountKind: "chequing" }), "income");
  // CC payment — BOTH legs map to payment (excluded from outflow)
  assert.equal(inferFlow({ signedAmount: 300, foreignCategory: "Credit Card Payment", accountKind: "card" }), "payment");
  assert.equal(inferFlow({ signedAmount: -300, foreignCategory: "Credit Card Payment", accountKind: "chequing" }), "payment");
  // transfer + fee
  assert.equal(inferFlow({ signedAmount: -50, foreignCategory: "Transfer", accountKind: "chequing" }), "transfer");
  assert.equal(inferFlow({ signedAmount: -3, foreignCategory: "Bank Fee", accountKind: "chequing" }), "fee_interest");
  // a positive amount on a CARD (a refund) is NOT income
  assert.equal(inferFlow({ signedAmount: 20, foreignCategory: "Shopping", accountKind: "card" }), "payment");
});

// --- Category defaults -----------------------------------------------------

test("suggestCategory maps known, falls back unknown", () => {
  assert.deepEqual(suggestCategory("Groceries"), { category: "Groceries", known: true });
  assert.deepEqual(suggestCategory("Restaurants & Bars"), { category: "Restaurants & takeout", known: true });
  assert.equal(suggestCategory("Coffee Shops").category, "Coffee");
  assert.equal(suggestCategory("Ready to Assign").known, false);
});

// --- Overlap similarity ----------------------------------------------------

test("overlap: token jaccard + first-token fallback", () => {
  assert.deepEqual(normalizeDesc("STARBUCKS #1234 SEATTLE WA"), ["STARBUCKS", "SEATTLE", "WA"]);
  assert.equal(jaccard(["A", "B"], ["A", "B"]), 1);
  assert.ok(descSimilar("STARBUCKS STORE 1234", "STARBUCKS #99 SEATTLE")); // share first token
  assert.ok(!descSimilar("STARBUCKS", "WALMART SUPERCENTER"));
});

// --- Normalizer per provider ----------------------------------------------

test("normalizeAll: Monarch signed amounts + drops bad dates", () => {
  const text = [
    "Date,Merchant,Category,Account,Original Statement,Notes,Amount",
    "2026-03-01,Starbucks,Coffee,Amex Gold,STARBUCKS #1,,-5.50",
    "2026-03-02,Paycheck,Income,TD Chequing,DIRECT DEP,,2000.00",
    "2026-03-04,Visa Payment,Credit Card Payment,Amex Gold,PAYMENT,,300.00",
    ",NoDate,Coffee,Amex Gold,,,-3.00",
  ].join("\n");
  const { headers, rows } = parseCsv(text);
  const preset = PRESETS.monarch;
  const accountMap = {
    "Amex Gold": { source: "import:amex_gold", account_kind: "card" as const },
    "TD Chequing": { source: "import:td_chequing", account_kind: "chequing" as const },
  };
  const categoryMap = { Coffee: "Coffee", Income: "Banking", "Credit Card Payment": "Banking" };
  const { rows: out, dropped } = normalizeAll(rows, headers, { preset, accountMap, categoryMap });

  assert.equal(dropped.length, 1); // the no-date row
  assert.equal(out.length, 3);

  const coffee = out[0];
  assert.equal(coffee.amount, 5.5);
  assert.equal(coffee.flow, "spend");
  assert.equal(coffee.account_kind, "card");
  assert.equal(coffee.source, "import:amex_gold");
  assert.equal(coffee.category, "Coffee");

  assert.equal(out[1].flow, "income"); // paycheck into chequing
  assert.equal(out[2].flow, "payment"); // CC payment leg
});

test("normalizeAll: Mint debit/credit sign + YNAB outflow/inflow", () => {
  const mint = parseCsv(
    [
      "Date,Description,Amount,Transaction Type,Category,Account Name",
      "3/5/2026,Whole Foods,45.00,debit,Groceries,Chase Card",
      "3/6/2026,Refund,20.00,credit,Shopping,Chase Card",
    ].join("\n")
  );
  const mintOut = normalizeAll(mint.rows, mint.headers, {
    preset: PRESETS.mint,
    accountMap: { "Chase Card": { source: "import:chase", account_kind: "card" } },
    categoryMap: { Groceries: "Groceries", Shopping: "Shopping / retail" },
  }).rows;
  assert.equal(mintOut[0].flow, "spend");
  assert.equal(mintOut[0].amount, 45);
  assert.equal(mintOut[1].flow, "payment"); // positive card credit

  const ynab = parseCsv(
    [
      "Account,Date,Payee,Category,Outflow,Inflow",
      "Checking,03/07/2026,Landlord,Rent,1200.00,0.00",
      "Checking,03/08/2026,Employer,Ready to Assign,0.00,2500.00",
    ].join("\n")
  );
  const ynabOut = normalizeAll(ynab.rows, ynab.headers, {
    preset: PRESETS.ynab,
    accountMap: { Checking: { source: "import:checking", account_kind: "chequing" } },
    categoryMap: { Rent: "Rent / housing", "Ready to Assign": "Other / uncategorized" },
  }).rows;
  assert.equal(ynabOut[0].amount, 1200);
  assert.equal(ynabOut[0].flow, "spend");
  assert.equal(ynabOut[1].amount, 2500);
  assert.equal(ynabOut[1].flow, "income");
});

// --- Preview assembly ------------------------------------------------------

test("analyzeCsv builds a usable preview", () => {
  const text = [
    "Date,Merchant,Category,Account,Original Statement,Notes,Amount",
    "2026-03-01,Starbucks,Coffee,Amex Gold,S,,-5.50",
    "2026-03-02,Costco,Groceries,Amex Gold,C,,-80.00",
    "2026-03-02,Paycheck,Some Mystery Cat,TD Chequing,P,,2000.00",
  ].join("\n");
  const res = analyzeCsv(text);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const p = res.preview;
  assert.equal(p.provider, "monarch");
  assert.equal(p.detected, true);
  assert.equal(p.rowCount, 3);
  assert.equal(p.dateRange.min, "2026-03-01");
  assert.equal(p.dateRange.max, "2026-03-02");
  assert.equal(p.accounts.length, 2);
  // "Some Mystery Cat" should be flagged unknown for review.
  const mystery = p.categories.find((c) => c.foreignCategory === "Some Mystery Cat");
  assert.ok(mystery?.isUnknown);
  assert.ok(p.sample.length >= 3);
});
