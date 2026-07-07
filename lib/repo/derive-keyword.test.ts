import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeyword } from "../db/derive-keyword";

// All fixtures are SYNTHETIC merchants (no personal data) that exercise the same
// shapes as real statements: trailing store #, city + province, processor
// prefixes, and the substring-contiguity contract.

test("cuts the store number and everything after it (contiguous prefix)", () => {
  assert.equal(deriveKeyword("COFFEE HOUSE #4821 TORONTO ON"), "COFFEE HOUSE");
  assert.equal(deriveKeyword("FUEL DEPOT 8842 CALGARY AB"), "FUEL DEPOT");
});

test("pops trailing province / country codes but keeps the city word", () => {
  // No number to cut on, so the city stays — over-specific is the safe failure.
  assert.equal(deriveKeyword("PLANT MARKET PORT ALICE BC"), "PLANT MARKET PORT ALICE");
  assert.equal(deriveKeyword("BOOK NOOK VANCOUVER BC"), "BOOK NOOK VANCOUVER");
});

test("strips leading processor / terminal prefixes", () => {
  assert.equal(deriveKeyword("TST* BURGER BARN VANCOUVER BC"), "BURGER BARN VANCOUVER");
  assert.equal(deriveKeyword("SQ *THE PLANT SHOP"), "PLANT SHOP"); // leading "THE" dropped
  assert.equal(deriveKeyword("POS PURCHASE GARDEN CENTRE"), "GARDEN CENTRE");
});

test("the result is always a contiguous substring of the upper-cased description", () => {
  const cases = [
    "COFFEE HOUSE #4821 TORONTO ON",
    "TST* BURGER BARN VANCOUVER BC",
    "PLANT MARKET PORT ALICE BC",
    "SINGLEWORDCAFE MONTREAL QC",
  ];
  for (const desc of cases) {
    const kw = deriveKeyword(desc);
    assert.ok(kw, `expected a keyword for ${desc}`);
    assert.ok(
      desc.toUpperCase().replace(/\s+/g, " ").includes(kw!),
      `"${kw}" must be a contiguous substring of "${desc}" (else recategorizeMatching's LIKE fails)`
    );
  }
});

test("returns null when nothing safe can be derived", () => {
  assert.equal(deriveKeyword(""), null);
  assert.equal(deriveKeyword("12345 FIRST"), null); // starts with a number
  assert.equal(deriveKeyword("ON"), null); // too short + stopword
  assert.equal(deriveKeyword("POS PURCHASE 000123"), null); // all stopwords after the cut
  assert.equal(deriveKeyword("THE OF"), null); // all stopwords
});

test("keeps a single specific token", () => {
  assert.equal(deriveKeyword("SUNFLOWER 7781 KELOWNA BC"), "SUNFLOWER");
});
