import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfx, looksLikeOfx } from "./ofx";
import { computeOfxDedupKey, computeDedupKey } from "../db/transactions";

// ---------------------------------------------------------------------------
// Synthetic OFX fixtures — no real financial data. They exercise both wire
// formats: OFX 1.x SGML (unclosed leaf tags) and OFX 2.x / QFX XML (closed tags).
// ---------------------------------------------------------------------------

// OFX 1.x SGML, credit card. Note the UNCLOSED leaf tags (<TRNAMT>-52.30 then a
// newline) — the hallmark of SGML OFX that trips naive XML parsers.
const SGML_CARD = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>CAD
<CCACCTFROM>
<ACCTID>4000111122224321
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000
<TRNAMT>-52.30
<FITID>CC0001
<NAME>COFFEE BAR
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260120
<TRNAMT>200.00
<FITID>CC0002
<NAME>PAYMENT THANK YOU
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-852.30
<DTASOF>20260131
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;

// OFX 2.x XML, chequing account, all tags closed.
const XML_CHEQUING = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <CURDEF>CAD</CURDEF>
    <BANKACCTFROM><ACCTID>1234567890</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20260201</DTSTART><DTEND>20260228</DTEND>
      <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260201</DTPOSTED><TRNAMT>2500.00</TRNAMT><FITID>BK1</FITID><NAME>PAYROLL DEPOSIT</NAME></STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260203</DTPOSTED><TRNAMT>-80.00</TRNAMT><FITID>BK2</FITID><NAME>GROCERY MART</NAME><MEMO>STORE 17</MEMO></STMTTRN>
      <STMTTRN><TRNTYPE>FEE</TRNTYPE><DTPOSTED>20260205</DTPOSTED><TRNAMT>-4.50</TRNAMT><FITID>BK3</FITID><NAME>MONTHLY FEE</NAME></STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>3415.50</BALAMT><DTASOF>20260228</DTASOF></LEDGERBAL>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

test("parses an SGML credit-card statement (unclosed leaf tags)", () => {
  const { accounts } = parseOfx(SGML_CARD);
  assert.equal(accounts.length, 1);

  const card = accounts[0];
  assert.equal(card.account_kind, "card");
  assert.equal(card.source, "ofx_card_4321");
  assert.equal(card.transactions.length, 2);

  const [purchase, payment] = card.transactions;
  // Charge: stored positive magnitude, flow=spend.
  assert.equal(purchase.flow, "spend");
  assert.equal(purchase.amount, 52.3);
  assert.equal(purchase.txn_date, "2026-01-05");
  assert.equal(purchase.description, "COFFEE BAR");
  assert.equal(purchase.fitId, "CC0001");
  // Positive amount on a card = payment, excluded from spend.
  assert.equal(payment.flow, "payment");
  assert.equal(payment.amount, 200);

  // Card closing balances are left NULL (issuer sign is inconsistent).
  assert.equal(card.closing_balance, null);
  assert.equal(card.period, "2026-01-01 to 2026-01-31");
});

test("parses an XML chequing statement with income / spend / fee flows", () => {
  const { accounts } = parseOfx(XML_CHEQUING);
  assert.equal(accounts.length, 1);

  const acct = accounts[0];
  assert.equal(acct.account_kind, "chequing");
  assert.equal(acct.source, "ofx_chequing_7890");
  assert.deepEqual(
    acct.transactions.map((t) => [t.flow, t.amount]),
    [
      ["income", 2500],
      ["spend", 80],
      ["fee_interest", 4.5],
    ]
  );
  // NAME + MEMO are joined when they differ.
  assert.equal(acct.transactions[1].description, "GROCERY MART STORE 17");

  // Deposit-account closing balance IS captured (unambiguous sign) → net worth.
  assert.equal(acct.closing_balance, 3415.5);
  assert.equal(acct.closing_date, "2026-02-28");
});

test("reads multiple accounts from one file", () => {
  const combined = XML_CHEQUING.replace("</OFX>", "") + SGML_CARD.split("<OFX>")[1];
  const { accounts } = parseOfx(combined);
  assert.equal(accounts.length, 2);
  assert.deepEqual(
    accounts.map((a) => a.account_kind).sort(),
    ["card", "chequing"]
  );
});

test("skips zero-amount rows and tolerates a file with no transactions", () => {
  const empty = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><ACCTID>9999</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
    <BANKTRANLIST></BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const { accounts } = parseOfx(empty);
  // No transactions and no balance → the account is dropped entirely.
  assert.equal(accounts.length, 0);
});

test("looksLikeOfx detects both header styles and rejects other content", () => {
  assert.equal(looksLikeOfx(SGML_CARD), true);
  assert.equal(looksLikeOfx(XML_CHEQUING), true);
  assert.equal(looksLikeOfx("%PDF-1.4 ..."), false);
  assert.equal(looksLikeOfx("date,amount,desc\n2026-01-01,1,x"), false);
});

test("FITID dedup key is stable, account-namespaced, and distinct from the PDF key", () => {
  const a = computeOfxDedupKey("ofx_card_4321", "CC0001");
  // Re-importing the same row in the same account → identical key (idempotent).
  assert.equal(a, computeOfxDedupKey("ofx_card_4321", "CC0001"));
  // Same FITID under a different account → different key.
  assert.notEqual(a, computeOfxDedupKey("ofx_chequing_7890", "CC0001"));
  // Different FITID → different key.
  assert.notEqual(a, computeOfxDedupKey("ofx_card_4321", "CC0002"));
  // Namespaced away from the positional PDF dedup key space.
  assert.notEqual(a, computeDedupKey("ofx_card_4321", "2026-01-05", "COFFEE BAR", 52.3, 1));
});
