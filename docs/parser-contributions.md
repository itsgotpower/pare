# Pare — Parser contribution guide

Only **CIBC (Visa + chequing) and Amex** are tuned against real PDFs. The other
six banks — **RBC, TD, Scotia, BMO, Tangerine, Wealthsimple** — are *scaffolds*:
regexes reconstructed from documented layouts, covered by synthetic fixtures
only. They will need a regex pass on the first real statement of each.

This guide shows you how to do that pass yourself, **locally and privately**,
against your own PDFs — and how to feed the result back so everyone's parser
gets better, without your statement ever leaving your machine.

> **External code PRs are not accepted yet** (see
> [CONTRIBUTING.md](../CONTRIBUTING.md)) — but parser tuning doesn't need one.
> The whole contribution is a handful of regexes plus a synthetic fixture,
> which fits in a GitHub issue. See [Contributing your tuning
> back](#contributing-your-tuning-back).

## How routing works

`lib/parser/registry.py` routes each PDF: every parser registers a `matches`
predicate (run against the raw `pdftotext` output) plus an integer priority,
and `registry.select()` picks the **lowest-priority match**:

| priority | parser | origin |
|---|---|---|
| 10 | `cibc_visa` | builtin (real-PDF tuned) |
| 20 | `cibc_chequing` | builtin (real-PDF tuned) |
| 30–41 | the scaffold banks (`_SCAFFOLD_BANKS`) | scaffold |
| 90 | `amex` | builtin — **always last**: chequing PDFs contain the literal "American Express" |

Two shared engines back the scaffolds (in `lib/parser/parse_statements.py`):

- **Ledger engine** (`_walk_ledger_text` + `LedgerProfile`) — chequing/savings.
  Direction comes from reconciling each row against the printed running balance,
  so it *fails safe*: a mistuned regex yields skipped rows (logged to stderr),
  never corrupt totals.
- **Card engine** (`_parse_card` + `CardProfile`) — two-date credit-card rows.
  Cards print **no running balance**, so this is the riskiest surface; the only
  checksum is the balance identity `charges - credits == closing - opening`,
  which `verify.py` checks when both balances are captured.

A scaffold bank is pure data: a profile (regex bundle) + a detector, assembled
in the **`_SCAFFOLD_BANKS` list — the only place you should touch**. Two rules:

- **Never edit the shared `_scaffold_ledger()` helper.** All eight ledger
  scaffolds currently share its one generic regex set — changing it to fit your
  bank silently changes the other seven. Tuning means replacing your bank's
  instance (e.g. `RBC_CHEQUING = _scaffold_ledger(...)`) with a bespoke
  `LedgerProfile(...)` carrying its real anchors.
- **Keep detector ordering intact.** For a brand with chequing *and* savings
  (Tangerine, Wealthsimple) the savings handler is listed first — its detector
  keys on a SAVINGS marker. And Amex must stay the last-priority fallback.

Source names follow `<bank>_<kind>` (`rbc_visa`, `tangerine_savings`, …) —
`sourceToKind()` in `lib/db/account-kinds.ts` derives the account kind from the
suffix, so a tuned bank lights up every chart with no TypeScript changes.

## Tune your bank

Work against your own statement, kept **outside the repo** (the parent
directory is fine — `data/` and `../` are never tracked).

```bash
# 1. See exactly what the regexes run against (layout mode is what the parser uses)
pdftotext -layout ../your-statement.pdf - | less

# 2. Run the tuning report
python3 lib/parser/parse_statements.py --report ../your-statement.pdf
```

If no parser matches, the report exits 1 and echoes the first lines of the
`pdftotext` output — pick brand/shape markers for the detector from those. If
the wrong parser matches, tighten your bank's detector.

Once routed, loop: edit your bank's profile in `parse_statements.py`, re-run
`--report`, and read the signal —

- **Ledger banks:** the headline is `unreconciled rows` — drive it to **0**.
  Every skipped row is logged to stderr with its `prev/amt/bal` triple, which
  tells you whether the amount, the balance column, or the opening anchor is
  mis-captured. The report also ties parsed inflow/outflow/closing to the
  printed summary box, and `VERIFY ok=True` confirms the closing ties out.
- **Card banks:** there is no checksum, so capture the opening balance
  (`opening_rx`, "PREVIOUS BALANCE") and closing balance (`balance_rx`) so the
  report can run the verify identity — `VERIFY ok=True method=card_balance` is
  your pass. Until both anchors capture, the report prints an explicit warning:
  compare the row count and total against the printed statement by hand.

```text
FILE       your-statement.pdf
PARSER     rbc_chequing (scaffold, priority 31)
ACCOUNT    RBC Chequing
PERIOD     October 1, 2026 to October 31, 2026
OPENING    1,000.00
CLOSING    2,380.00 on 2026-10-31
ROWS       3
  spend        1
  income       1
  transfer     1
DATES      2026-10-03 .. 2026-10-12

LEDGER RECONCILIATION  (tuning target: unreconciled = 0)
  unreconciled rows            0
  parsed inflow         2,000.00   summary deposits        2,000.00
  parsed outflow          620.00   summary withdrawals       620.00
  parsed closing        2,380.00   summary closing         2,380.00
VERIFY     ok=True method=running_balance confidence=1.0 residual=+0.00
```

The report is read-only — it never writes CSV/JSON and never touches the
database, so you can loop as often as you like.

## Add a fixture + tests

Every tuned bank needs a fixture in `tests/test_parser.py` so the regexes stay
pinned. **Fixtures must be synthetic** (see [SECURITY.md](../SECURITY.md)):

- **Fabricate** every merchant name, amount, date, and account fragment — never
  paste text from a real statement.
- **Preserve the layout** — column offsets, header/footer wording, the summary
  box — because the layout is the only thing the profiles key on. The easiest
  way: copy your `pdftotext -layout` output and rewrite every value.
- **Make the math reconcile.** Ledger fixtures need opening ± each row ==
  printed balance == closing; card fixtures should satisfy
  `charges - credits == closing - opening` so the verifier passes.

Add the fixture as a module-level `UPPERCASE` string constant, then extend the
existing `CASES` tables rather than writing new test classes:

- `TestScaffoldCards.CASES` — `(profile, fixture, source, closing_balance, closing_date)`
- `TestScaffoldLedgers.CASES` — `(profile, fixture, source)` (this also feeds
  `TestVerifyScaffolds`, so verification coverage comes free)
- `TestScaffoldRouting.CASES` — `(fixture, source)`: proves the detector routes
  your fixture and that `registry.select` and `statement_meta` agree
- `TestScaffoldMeta` — closing/opening balance extraction, if your anchors
  changed shape

Run just your bank while iterating, then the whole suite:

```bash
python3 -m unittest -k Rbc tests.test_parser   # one bank's classes (case-sensitive substring)
npm test                                       # the full parser suite
```

(`-k` matches case-sensitively against test ids, so `-k Rbc` hits the
`TestRbcVisa`/`TestRbcChequing` classes while `-k rbc` only hits lowercase
method names. Banks that live only in the shared `CASES` tables run as part of
those tables' tests — filter on the table's class, e.g. `-k ScaffoldLedgers`.)

## Definition of done

- [ ] `--report` on your real statement: `unreconciled = 0` (ledger) or
      `VERIFY ok=True` (card)
- [ ] Synthetic fixture added; the `CASES` tables extended; `npm test` green
- [ ] `components/upload/bank-guides.tsx`: flip your bank's `status` from
      `"beta"` to `"pdf"` (the upload page's PDF TUNED badge)
- [ ] `CLAUDE.md` "Coverage status" paragraph: move the bank out of the
      scaffold list

## Contributing your tuning back

Code PRs aren't open yet (CLA/DCO is unsettled — the full story is in
[CONTRIBUTING.md](../CONTRIBUTING.md)), so tuning lands through an issue:

1. Open a GitHub issue titled e.g. `parser: tuned RBC chequing against real
   PDFs`.
2. Include the **tuned profile** (the `LedgerProfile(...)`/`CardProfile(...)`
   arguments and any detector change) and your **synthetic fixture** with the
   `--report` output it produces.
3. **Never include real statement text** — no merchant names, amounts, dates,
   account or transit numbers, not even "redacted" screenshots. The synthetic
   fixture that preserves the layout is exactly enough to land the change.

The maintainer lands it from there. When code contributions open up,
CONTRIBUTING.md will say so — until then this path gets your bank tuned
upstream just as fast.

## Privacy

Your PDFs never leave your machine: `--report` prints to your terminal only,
the parser makes zero network calls, and real statements belong **outside the
repo**. Everything that gets committed — fixtures, regexes, docs — must be
synthetic and generic (no personal merchants, handles, or absolute home paths).
