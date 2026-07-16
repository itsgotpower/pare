"""Parse Canadian bank/CC PDF statements into a tidy CSV.

Usage:
    python lib/parser/parse_statements.py /path/to/statements_dir out.csv

Output columns: source, account, period, txn_date, description, amount, category, flow
  - source: 'amex' | 'cibc_visa' | 'cibc_chequing' | 'rbc_visa' | 'rbc_chequing' | …
  - flow:   'spend' | 'payment' | 'income' | 'transfer' | 'fee_interest'
Amounts are positive for spend/outflow. Internal transfers, card payments,
income, and balance transfers are tagged so they can be excluded from "spend".

Routing lives in the registry (registry.py) driven by the orchestrator
(orchestrator.py) — Phase 1 of the self-improving parser. The three verified
built-ins (CIBC Visa → CIBC chequing → Amex fallback) register via
`registry.register_builtins`; the SCAFFOLDED banks (RBC / TD / Scotia / BMO /
Tangerine / Wealthsimple) are declared in `_SCAFFOLD_BANKS` and register via
`registry.register_scaffolds`. Order matters: CIBC chequing PDFs contain the
literal "American Express" (Amex card-payment lines), so the specific titles
outrank the Amex fallback (priority 90, always last); scaffolds slot between
(30–80).

Two shared, bank-agnostic engines back the scaffolds:
  - `_walk_ledger` + `LedgerProfile` (chequing/savings) — direction by balance
    reconciliation, multi-line folding, FX-note exclusion. CIBC chequing is now
    expressed as a profile (CIBC_LEDGER) over this same engine.
  - `_parse_card` + `CardProfile` (two-date credit cards). CIBC Visa + Amex keep
    their bespoke parsers.

SCAFFOLD CAVEAT: only CIBC (Visa + chequing) and Amex are verified against real
PDFs. The new banks are reconstructed from documented layouts and covered by
SYNTHETIC fixtures only — expect a regex pass on the first real upload of each.
The ledger engine fails safe (skips + logs unreconciled rows → missing rows,
never corrupt totals); card parsers have NO running-balance checksum and are the
riskiest surface.

Requires: pdftotext (poppler-utils). pip install nothing else.
"""
import subprocess, re, sys, glob, os, csv, json, datetime, functools
sys.path.insert(0, os.path.dirname(__file__))
from categories import categorize

DATE = r'[A-Z][a-z]{2}\s+\d{1,2}'
MONEY = r'-?[\d,]+\.\d{2}'

MONTHS = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
}

# Cached: each PDF is otherwise extracted 3-4x per run (route select, parse,
# statement_meta, and the chequing meta re-walk each call text()). Tests
# monkeypatch the `text` attribute wholesale, so they never hit the cache.
@functools.lru_cache(maxsize=8)
def text(path):
    r = subprocess.run(['pdftotext', '-layout', path, '-'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"pdftotext failed on {os.path.basename(path)} "
            f"(exit {r.returncode}): {r.stderr.strip() or 'no stderr'}")
    return r.stdout

def parse_date(date_str, ref_year):
    """Parse 'Mon DD' into 'YYYY-MM-DD' using ref_year for context."""
    m = re.match(r'([A-Z][a-z]{2})\s+(\d{1,2})', date_str.strip())
    if not m:
        return None
    month_name, day = m.group(1), int(m.group(2))
    month_num = MONTHS.get(month_name)
    if not month_num:
        return None
    return f"{ref_year}-{month_num:02d}-{day:02d}"


def extract_year(period_str):
    """Extract year from period string like 'Dec 03, 2025' or 'Jan 28 to Feb 27, 2026'.

    A period with no year means the period regex missed (the fallback is the bare
    source name) — warn and use the current year rather than dating silently wrong;
    wrong years also change dedup keys, so re-uploads would duplicate.
    """
    m = re.search(r'(\d{4})', period_str)
    if m:
        return int(m.group(1))
    sys.stderr.write(
        f"[parser] no year found in period {period_str!r}; "
        f"falling back to the current year\n")
    return datetime.date.today().year


def period_end(period_str):
    """Closing date 'YYYY-MM-DD' from a period string. Works on all three shapes:
    'Jan 02, 2026' (Amex), 'Apr 1 to Apr 30, 2026' (chequing, abbreviated months),
    'January 28 to February 27, 2026' (Visa, full months) — the month immediately
    before the year is always the closing month; full names map via their first
    three letters (September -> Sep)."""
    m = re.search(r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$', period_str.strip())
    if not m:
        return None
    month_num = MONTHS.get(m.group(1)[:3])
    if not month_num:
        return None
    return f"{m.group(3)}-{month_num:02d}-{int(m.group(2)):02d}"


def _infer_txn_year(txn_date_raw, ref_year, closing_month):
    """Statement-relative year for a 'Mon DD' transaction date: the closing
    year, except a December transaction on a January-closing statement belongs
    to the prior year (the only month such a period crosses). Shared by the
    bespoke Amex parser and the card engine so the rule can't drift."""
    tmm = re.match(r'([A-Z][a-z]{2})', txn_date_raw.strip())
    txn_month = MONTHS.get(tmm.group(1), 1) if tmm else 1
    if txn_month == 12 and closing_month == 1:
        return ref_year - 1
    return ref_year


def _amex_period(t):
    # The header value line carries BOTH dates: "... Opening Date  Closing Date"
    # then "... Feb 03, 2026   Mar 02, 2026". Grab the CLOSING date (the second);
    # the older regex grabbed the opening date, which threw off year inference.
    cm = re.search(
        r'Opening Date\s+Closing Date\s*\n[^\n]*?(' + DATE + r',\s*\d{4})\s+(' + DATE + r',\s*\d{4})',
        t)
    return cm.group(2) if cm else (
        "".join(re.findall(r'Closing Date\s*\n?.*?(' + DATE + r',\s*\d{4})', t)[:1]) or "amex")


def parse_amex(path):
    rows, t = [], text(path)
    period = _amex_period(t)
    ref_year = extract_year(period)
    cmonth_m = re.match(r'([A-Z][a-z]{2})', period)
    closing_month = MONTHS.get(cmonth_m.group(1), 1) if cmonth_m else 1
    rx = re.compile(rf'^({DATE})\s+({DATE})\s+(.*?)\s+({MONEY})(\s*CR)?\s*$')
    cap = False
    for ln in t.splitlines():
        if 'New Transactions for' in ln: cap = True; continue
        if 'Total of New Transactions' in ln or 'Other Account Transactions' in ln: cap = False; continue
        if not cap: continue
        m = rx.match(ln.strip())
        if not m: continue
        txn_date_raw, _, desc, amt_raw, cr = m.groups()
        if 'UNITED STATES DOLLAR' in desc: continue
        # Credits ("-12.34" or trailing "CR") are refunds/statement credits, not
        # spend — same contract as _parse_card: amounts positive, flow encodes it.
        is_credit = amt_raw.strip().startswith('-') or bool(cr)
        amt = abs(float(amt_raw.replace(',', '')))
        desc = desc.strip()
        txn_date = parse_date(txn_date_raw, _infer_txn_year(txn_date_raw, ref_year, closing_month))
        cat = categorize(desc)
        if is_credit and 'PAYMENT' in desc.upper():
            flow = 'payment'
        elif is_credit:
            flow = 'income'
        elif cat == 'Cash advance / fees':
            flow = 'fee_interest'
        else:
            flow = 'spend'
        rows.append(('amex', 'Amex Gold', period, txn_date or '', desc, amt, cat, flow))
    return rows


# CIBC's own "Spend Categories" column — the real fixed vocabulary as printed on
# Aeroplan Visa statements. Longest/multi-word phrases first so the alternation
# consumes the full category, not a prefix. Used to split description from category.
CIBC_CATS = (
    r'(?:Professional and Financial Services|Personal and Household Expenses|'
    r'Foreign Currency Transactions|Retail and Grocery|Health and Education|'
    r'Hotel and Travel|Home and Office|Transportation|Entertainment|Restaurants)'
)

def _visa_period(t):
    return "".join(re.findall(r'period\s*\n?.*?(\w+ \d+ to \w+ \d+, \d{4})', t)[:1]) or "cibc_visa"


def parse_cibc_visa(path):
    rows, t = [], text(path)
    period = _visa_period(t)
    ref_year = extract_year(period)
    rx = re.compile(rf'^({DATE})\s+({DATE})\s+(?:Q\s+)?(.*?)\s+({CIBC_CATS})\s+({MONEY})(\s*CR)?\s*$')
    cap = False
    for ln in t.splitlines():
        if 'Your new charges' in ln: cap = True; continue
        if 'Total for' in ln: cap = False; continue
        if not cap: continue
        u = ln.upper()
        if 'BALANCE TRANSFER' in u or 'CASH ADV' in u or 'CONV CHQ FEE' in u:
            monies = re.findall(MONEY, ln)
            if not monies:
                continue  # note line (e.g. interest disclosure), not a transaction
            amt = float(monies[-1].replace(',', ''))
            dm = re.match(rf'({DATE})', ln.strip())
            txn_date = parse_date(dm.group(1), ref_year) if dm else ''
            if 'BALANCE TRANSFER' in u:
                rows.append(('cibc_visa', 'CIBC Aeroplan Visa', period, txn_date or '', 'BALANCE TRANSFER', amt, 'Cash advance / fees', 'transfer'))
            else:
                rows.append(('cibc_visa', 'CIBC Aeroplan Visa', period, txn_date or '', 'CASH ADV / BT FEE', amt, 'Cash advance / fees', 'fee_interest'))
            continue
        m = rx.match(ln.strip())
        if not m: continue
        txn_date_raw, _, desc, _spendcat, amt_raw, cr = m.groups()
        # The section header literally says "charges and credits" — a refund
        # ("-12.34" or trailing "CR") must not count as spend (amounts positive,
        # flow encodes direction; same contract as _parse_card).
        is_credit = amt_raw.strip().startswith('-') or bool(cr)
        amt = abs(float(amt_raw.replace(',', '')))
        desc = desc.strip()
        txn_date = parse_date(txn_date_raw, ref_year)
        cat = categorize(desc)
        if is_credit and 'PAYMENT' in desc.upper():
            flow = 'payment'
        elif is_credit:
            flow = 'income'
        elif cat == 'Cash advance / fees':
            flow = 'fee_interest'
        else:
            flow = 'spend'
        rows.append(('cibc_visa', 'CIBC Aeroplan Visa', period, txn_date or '', desc, amt, cat, flow))
    return rows


# Money with optional leading $ ; the trailing (?!\d) stops it from grabbing the
# first two decimals of an exchange rate like "1.4329". Captured for stripping
# from descriptions.
MONEY_TOKEN = re.compile(r'\$?-?[\d,]+\.\d{2}(?!\d)')

# Foreign-currency note line, e.g. "35.00 USD @ 1.4329" — a detail line, never a
# transaction (the CAD amount is already on the primary line).
FX_NOTE = re.compile(r'[A-Z]{3}\s+@\s+\d')

def _money(s):
    return float(s.replace('$', '').replace(',', ''))


def _classify_chequing(folded_text, direction):
    """Classify flow from the folded description (primary + continuation lines)
    plus the reconciled direction ('in' | 'out'). Order matters."""
    t = folded_text.upper()
    if 'SERVICE CHARGE' in t or 'NETWORK TRANSACTION FEE' in t or 'OVERDRAFT' in t:
        return 'fee_interest'
    if 'CARD PRODUCTS' in t or 'INTERNET CARD PAYMENT' in t or 'AMERICAN EXPRESS' in t:
        return 'payment'
    if 'PEOPLE CENTER' in t or 'SALARY' in t or 'PAYROLL' in t:
        return 'income'
    if direction == 'in' and (
        'REFUND' in t or 'REMBOURS' in t or 'HEALTHCLAIM' in t
        or 'PAYOUT' in t or 'REBATE' in t
    ):
        return 'income'
    if 'E-TRANSFER' in t or 'INTERNET TRANSFER' in t or 'ATM' in t or 'QUESTRADE' in t:
        return 'transfer'
    return 'income' if direction == 'in' else 'spend'


# ===========================================================================
# Ledger engine — balance-reconciling chequing / savings statements. The walk
# (`_walk_ledger_text`) is bank-agnostic: direction by running balance,
# multi-line folding, FX-note exclusion are universal. Per-issuer anchors live
# in a `LedgerProfile`. CIBC chequing is just the CIBC_LEDGER profile over this
# engine; its long-standing `_walk_chequing` / `_walk_chequing_text` /
# `chequing_report` names are kept as thin CIBC-bound shims so verify.py and
# existing callers are unchanged.
# ===========================================================================
class LedgerProfile:
    """Config for the balance-reconciling ledger walk (chequing / savings).

    Regexes are anchored to each issuer's `pdftotext -layout` output; the
    defaults below match the CIBC shape and are overridden per bank.
    """

    def __init__(self, source, account, *,
                 period_rx, opening_rx,
                 header_rx=r'Date\s+Description\s+Withdrawals',
                 footer_rx=r'Page\s+\d+\s+of\s+\d+',
                 closing_rx=r'=\s+\$(-?[\d,]+\.\d{2})',
                 withdrawals_rx=r'Withdrawals\s+-\s+([\d,]+\.\d{2})',
                 deposits_rx=r'Deposits\s+\+\s+([\d,]+\.\d{2})',
                 date_rx=r'\s*([A-Z][a-z]{2})\s+(\d{1,2})\b',
                 classify=None):
        self.source = source
        self.account = account
        self.period_rx = period_rx          # one capture group -> period string
        self.opening_rx = opening_rx        # opening balance value
        self.header_rx = header_rx          # column header that STARTS capture
        self.footer_rx = footer_rx          # page footer that STOPS capture
        self.closing_rx = closing_rx        # summary-box closing balance
        self.withdrawals_rx = withdrawals_rx  # summary outflow (verifier)
        self.deposits_rx = deposits_rx        # summary inflow (verifier)
        self.date_rx = date_rx              # leading "Mon DD" date token
        self.classify = classify or _classify_chequing


def _walk_ledger_text(profile, t):
    """Walk already-extracted ledger (chequing/savings) statement text. Returns
    (period, txns) where each txn dict carries date, desc_parts, amount, balance,
    prev, direction. Issuer-specific anchors come from `profile`; the
    reconciliation logic itself is bank-agnostic. Split from the path entry so
    verify.py can re-walk from a text string (no path, no re-extraction).

    Direction comes from reconciling against the printed running balance:
    prev + amount == balance => 'in'; prev - amount == balance => 'out';
    otherwise 'unreconciled'. Transactions span multiple lines, so continuation
    lines (recipient name, PEOPLE CENTER, CARD PRODUCTS, FX notes) are folded onto
    the preceding transaction.
    """
    period = "".join(re.findall(profile.period_rx, t)[:1]) or profile.source
    ref_year = extract_year(period)

    open_m = re.search(profile.opening_rx, t)
    running = _money(open_m.group(1)) if open_m else None

    capturing = False
    cur_date = None
    txns = []
    last = None

    for ln in t.splitlines():
        # Page-aware gating: start at the column header, stop at each page footer.
        if re.search(profile.header_rx, ln):
            capturing = True
            continue
        if re.search(profile.footer_rx, ln):
            capturing = False
            continue
        if not capturing or not ln.strip():
            continue

        low = ln.lower()
        monies = list(MONEY_TOKEN.finditer(ln))

        # Structural balance lines: reset running balance, no transaction.
        if 'opening balance' in low or 'balance forward' in low:
            if monies:
                running = _money(monies[-1].group())
            last = None
            continue
        if 'closing balance' in low:
            if monies:
                running = _money(monies[-1].group())
            last = None
            capturing = False
            continue

        dm = re.match(profile.date_rx, ln)
        if dm and dm.group(1) in MONTHS:
            cur_date = parse_date(f"{dm.group(1)} {dm.group(2)}", ref_year)

        is_fx = FX_NOTE.search(ln) is not None

        # A transaction line carries amount + running balance (>=2 money tokens)
        # and reconciles against the running balance. FX notes are never txns.
        # No anchor yet (opening_rx missed AND no in-table opening line) =>
        # 'unreconciled', NOT a continuation fold — otherwise a mistuned
        # opening_rx yields zero rows with zero diagnostics.
        if len(monies) >= 2 and not is_fx:
            amount = _money(monies[0].group())
            balance = _money(monies[-1].group())
            if running is None:
                direction = 'unreconciled'
            elif abs(round(running + amount - balance, 2)) < 0.01:
                direction = 'in'
            elif abs(round(running - amount - balance, 2)) < 0.01:
                direction = 'out'
            else:
                direction = 'unreconciled'

            desc = ln
            for mt in monies:
                desc = desc.replace(mt.group(), ' ')
            if dm:
                desc = re.sub(r'^\s*[A-Z][a-z]{2}\s+\d{1,2}\b', '', desc)
            desc = re.sub(r'\s{2,}', ' ', desc).strip()

            txn = {'date': cur_date, 'desc_parts': [desc] if desc else [],
                   'amount': amount, 'balance': balance, 'prev': running,
                   'direction': direction}
            txns.append(txn)
            last = txn
            if direction != 'unreconciled':
                running = balance  # trust printed balance to keep the chain going
        else:
            # Continuation line: fold onto the current transaction.
            if last is not None and 'continued on next page' not in low:
                cont = ln
                for mt in monies:
                    cont = cont.replace(mt.group(), ' ')
                cont = re.sub(r'\s{2,}', ' ', cont).strip()
                if cont:
                    last['desc_parts'].append(cont)

    return period, txns


def _walk_ledger(path, profile):
    """Path entry: extract text, then walk it (see `_walk_ledger_text`)."""
    return _walk_ledger_text(profile, text(path))


def _walk_chequing(path):
    """CIBC chequing path entry — the shared engine bound to CIBC_LEDGER."""
    return _walk_ledger_text(CIBC_LEDGER, text(path))


def _walk_chequing_text(t):
    """CIBC chequing text entry (used by verify.py to re-walk without a path)."""
    return _walk_ledger_text(CIBC_LEDGER, t)


def _parse_ledger(path, profile):
    """Parse a balance-reconciling statement (chequing / savings) into rows.

    Amounts are stored positive; flow encodes direction. Category stays 'Banking'
    (ledger accounts are not card spend). Rows that reconcile to neither
    direction are flagged (stderr) and skipped — a mistuned profile yields
    MISSING rows (visible), never corrupt totals.
    """
    period, txns = _walk_ledger(path, profile)
    rows = []
    for txn in txns:
        if txn['direction'] == 'unreconciled':
            prev = f"{txn['prev']:.2f}" if txn['prev'] is not None else 'NO ANCHOR'
            sys.stderr.write(
                f"[{profile.source}] unreconciled row (prev={prev} "
                f"amt={txn['amount']:.2f} bal={txn['balance']:.2f}): "
                f"{' '.join(txn['desc_parts'])}\n")
            continue
        folded = ' '.join(txn['desc_parts']).strip()
        flow = profile.classify(folded, txn['direction'])
        rows.append((profile.source, profile.account, period,
                     txn['date'] or '', folded or 'TRANSACTION',
                     txn['amount'], 'Banking', flow))
    return rows


def parse_cibc_chequing(path):
    """CIBC chequing — thin wrapper over the shared ledger engine."""
    return _parse_ledger(path, CIBC_LEDGER)


def ledger_report(path, profile):
    """Verification helper: tie parsed inflows/outflows to the printed
    Account-summary box. Uses the same walk as the parser so they can't diverge.
    Works for any ledger bank via its LedgerProfile.
    """
    t = text(path)

    def grab(rx):
        m = re.search(rx, t)
        return _money(m.group(1)) if m else None

    summary = {
        'opening': grab(profile.opening_rx),
        'withdrawals': grab(profile.withdrawals_rx),
        'deposits': grab(profile.deposits_rx),
        'closing': grab(profile.closing_rx),
    }

    period, txns = _walk_ledger(path, profile)
    inflow = sum(x['amount'] for x in txns if x['direction'] == 'in')
    outflow = sum(x['amount'] for x in txns if x['direction'] == 'out')
    unreconciled = sum(1 for x in txns if x['direction'] == 'unreconciled')
    reconciled = [x for x in txns if x['direction'] != 'unreconciled']
    closing = reconciled[-1]['balance'] if reconciled else summary['opening']

    return {
        'period': period, 'rows': len(reconciled),
        'parsed_inflow': round(inflow, 2), 'parsed_outflow': round(outflow, 2),
        'parsed_closing': round(closing, 2) if closing is not None else None,
        'unreconciled': unreconciled, 'summary': summary,
    }


def chequing_report(path):
    """CIBC chequing verifier — thin wrapper over `ledger_report`."""
    return ledger_report(path, CIBC_LEDGER)


def _ledger_meta(path, profile):
    """Closing balance + date for a ledger statement. Prefers the summary-box
    closing value; falls back to the last reconciled running balance (same chain
    as `ledger_report`). Also captures the opening balance (verify.py anchors
    on it; None when the anchor missed)."""
    t = text(path)
    m = re.search(profile.closing_rx, t)
    om = re.search(profile.opening_rx, t)
    period, txns = _walk_ledger(path, profile)
    reconciled = [x for x in txns if x['direction'] != 'unreconciled']
    closing = _money(m.group(1)) if m else (
        reconciled[-1]['balance'] if reconciled else None)
    return {'source': profile.source, 'account': profile.account, 'period': period,
            'closing_balance': closing, 'closing_date': period_end(period),
            'opening_balance': _money(om.group(1)) if om else None}


# ===========================================================================
# Card engine — two-date credit/charge statements (Amex-shaped):
#   "MON DD   MON DD   DESCRIPTION   $AMOUNT"  (credits as "-$X" or trailing "CR").
# A CardProfile supplies the per-issuer anchors; _parse_card is the shared engine,
# analogous to _walk_ledger for chequing/savings. CIBC Visa keeps its bespoke
# parser (the Spend-Categories column) and Amex its own (predates this engine);
# RBC/TD/Scotia/BMO are SCAFFOLDS reconstructed from documented layouts (synthetic
# fixtures only). Card statements have NO running-balance checksum, so this engine
# is the riskiest surface — confirm against a real statement before trusting it.
# ===========================================================================
# Money token with optional $ and either-side sign — used by card summary-box
# balance grabs ("Total balance = $8,401.31", "Equals New Balance $169.12").
_MONEY_SIGNED = r'(-?\$?-?[\d,]+\.\d{2})'

CARD_ROW_RX = re.compile(
    r'^(' + DATE + r')\s+(' + DATE + r')\s+(.*?)\s+(-?\$?[\d,]+\.\d{2})(\s*CR)?\s*$')


class CardProfile:
    """Per-issuer config for the two-date card engine (_parse_card).

    period_rx captures the CLOSING date (one group). start_rx/stop_rx gate the
    transaction section (None on start = capture the whole document, relying on
    the two-date row shape to exclude summary lines). row_rx defaults to the
    Amex-shaped two-date row.
    """

    def __init__(self, source, account, *, period_rx, balance_rx,
                 start_rx=None, stop_rx=None, row_rx=CARD_ROW_RX,
                 opening_rx=r'PREVIOUS (?:STATEMENT )?BALANCE[^\n]*?' + _MONEY_SIGNED):
        self.source = source
        self.account = account
        self.period_rx = period_rx
        self.balance_rx = balance_rx
        self.start_rx = start_rx
        self.stop_rx = stop_rx
        self.row_rx = row_rx
        self.opening_rx = opening_rx    # opening (previous) balance — verify.py's card identity


def _card_period(t, profile):
    m = re.search(profile.period_rx, t, re.I)
    return m.group(1) if m else profile.source


def _parse_card(path, profile):
    rows, t = [], text(path)
    period = _card_period(t, profile)
    ref_year = extract_year(period)
    cmonth_m = re.match(r'([A-Z][a-z]{2})', period)
    closing_month = MONTHS.get(cmonth_m.group(1), 1) if cmonth_m else 1
    cap = profile.start_rx is None
    for ln in t.splitlines():
        if profile.start_rx and re.search(profile.start_rx, ln, re.I):
            cap = True; continue
        if profile.stop_rx and re.search(profile.stop_rx, ln, re.I):
            cap = False; continue
        if not cap:
            continue
        m = profile.row_rx.match(ln.strip())
        if not m:
            continue
        txn_date_raw, _post, desc, amt_raw, cr = m.groups()
        desc = desc.strip()
        is_credit = amt_raw.strip().startswith('-') or bool(cr)
        amt = abs(_money(amt_raw))
        txn_date = parse_date(txn_date_raw, _infer_txn_year(txn_date_raw, ref_year, closing_month))
        cat = categorize(desc)
        if is_credit and 'PAYMENT' in desc.upper():
            flow = 'payment'           # card payment from chequing
        elif is_credit:
            flow = 'income'            # refund / statement credit
        elif cat == 'Cash advance / fees':
            flow = 'fee_interest'
        else:
            flow = 'spend'
        rows.append((profile.source, profile.account, period, txn_date or '',
                     desc, amt, cat, flow))
    return rows


def _card_meta(path, profile):
    t = text(path)
    period = _card_period(t, profile)
    m = re.search(profile.balance_rx, t, re.I)
    closing = _money(m.group(1)) if m else None
    # Opening (previous) balance: with both balances captured, verify.py can
    # check the card identity (charges - credits == closing - opening) — the
    # only checksum a card statement has. None when the anchor missed.
    om = re.search(profile.opening_rx, t, re.I) if profile.opening_rx else None
    return {'source': profile.source, 'account': profile.account, 'period': period,
            'closing_balance': closing, 'closing_date': period_end(period),
            'opening_balance': _money(om.group(1)) if om else None}


# ===========================================================================
# Ledger profiles — chequing / savings statements driven by the shared
# balance-reconciling engine (_walk_ledger). Adding a ledger bank is just a
# LedgerProfile, no new walk logic.
# ===========================================================================

# CIBC chequing — the original behaviour, now expressed as a profile (the test
# suite pins this exactly).
CIBC_LEDGER = LedgerProfile(
    'cibc_chequing', 'CIBC Chequing',
    period_rx=r'For (\w+ \d+ to \w+ \d+, \d{4})',
    opening_rx=r'Opening balance on[^\n]*?\$?([\d,]+\.\d{2})',
    closing_rx=r'=\s+\$(-?[\d,]+\.\d{2})',
    withdrawals_rx=r'Withdrawals\s+-\s+([\d,]+\.\d{2})',
    deposits_rx=r'Deposits\s+\+\s+([\d,]+\.\d{2})',
)

# Ledger profiles for the SCAFFOLDED banks (RBC / TD / Scotia / BMO chequing,
# Tangerine & Wealthsimple chequing+savings). Regexes reconstructed from each
# issuer's documented "account activity" layout, NOT verified against real PDFs.
# The reconciliation engine fails safe (skips + logs rows that don't tie out), so
# a mistuned anchor yields missing rows, never corrupt totals. They share one
# common shape ("Opening/Closing Balance", a Withdrawals/Deposits/Balance grid);
# tune per bank on the first real upload.
def _scaffold_ledger(source, account):
    return LedgerProfile(
        source, account,
        period_rx=r'(?:From|FROM|For the period|Statement period)\s+'
                  r'([A-Z][a-z]+ \d{1,2}, \d{4} to [A-Z][a-z]+ \d{1,2}, \d{4})',
        opening_rx=r'Opening [Bb]alance[^\n]*?\$?([\d,]+\.\d{2})',
        closing_rx=r'Closing [Bb]alance[^\n]*?\$?(-?[\d,]+\.\d{2})',
        withdrawals_rx=r'Total withdrawals[^\n]*?([\d,]+\.\d{2})',
        deposits_rx=r'Total deposits[^\n]*?([\d,]+\.\d{2})',
    )


RBC_CHEQUING = _scaffold_ledger('rbc_chequing', 'RBC Chequing')
TD_CHEQUING = _scaffold_ledger('td_chequing', 'TD Chequing')
SCOTIA_CHEQUING = _scaffold_ledger('scotia_chequing', 'Scotiabank Chequing')
BMO_CHEQUING = _scaffold_ledger('bmo_chequing', 'BMO Chequing')
TANGERINE_CHEQUING = _scaffold_ledger('tangerine_chequing', 'Tangerine Chequing')
TANGERINE_SAVINGS = _scaffold_ledger('tangerine_savings', 'Tangerine Savings')
WS_CASH = _scaffold_ledger('wealthsimple_cash', 'Wealthsimple Cash')
WS_SAVINGS = _scaffold_ledger('wealthsimple_savings', 'Wealthsimple Savings')


# Card profiles — all SCAFFOLDS. RBC keeps section gating (its layout prints a
# clear "Transaction/Posting/Description" header); TD/Scotia/BMO run ungated and
# lean on the two-date row shape. balance_rx grabs the printed closing balance.
RBC_CARD = CardProfile(
    'rbc_visa', 'RBC Visa',
    period_rx=r'STATEMENT FROM .*? TO ([A-Z][a-z]+\s+\d{1,2},\s*\d{4})',
    balance_rx=r'NEW BALANCE[^\n]*?' + _MONEY_SIGNED,
    start_rx=r'transaction.*posting.*description',
    stop_rx=r'new balance|subtotal|total account balance',
)

TD_CARD = CardProfile(
    'td_visa', 'TD Visa',
    period_rx=r'STATEMENT PERIOD[^\n]*?to\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})',
    balance_rx=r'NEW BALANCE[^\n]*?' + _MONEY_SIGNED,
)

SCOTIA_CARD = CardProfile(
    'scotia_visa', 'Scotiabank Visa',
    period_rx=r'(?:statement period|for the period)[^\n]*?to\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})',
    balance_rx=r'(?:NEW BALANCE|TOTAL BALANCE)[^\n]*?' + _MONEY_SIGNED,
)

BMO_CARD = CardProfile(
    'bmo_mastercard', 'BMO Mastercard',
    period_rx=r'(?:statement period|period covered)[^\n]*?to\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})',
    balance_rx=r'(?:NEW BALANCE|TOTAL BALANCE)[^\n]*?' + _MONEY_SIGNED,
)


# Source -> profile lookups over the engine-backed parsers. verify.py routes on
# these (any ledger source gets the running-balance re-walk, any card-engine
# source gets the balance-identity check), and the --report CLI uses them to
# pick the right reconciliation output. The bespoke Amex / CIBC Visa parsers are
# deliberately absent from CARD_PROFILES (verify.py routes them by name).
LEDGER_PROFILES = {p.source: p for p in (
    CIBC_LEDGER, RBC_CHEQUING, TD_CHEQUING, SCOTIA_CHEQUING, BMO_CHEQUING,
    TANGERINE_CHEQUING, TANGERINE_SAVINGS, WS_CASH, WS_SAVINGS)}

CARD_PROFILES = {p.source: p for p in (RBC_CARD, TD_CARD, SCOTIA_CARD, BMO_CARD)}


def parse_rbc_visa(path):
    """RBC Visa — thin wrapper over the shared card engine (pinned by tests)."""
    return _parse_card(path, RBC_CARD)


# ===========================================================================
# Detectors — a statement's brand + shape. Card detectors require the brand, the
# card network, and a "NEW/TOTAL BALANCE" summary line (which ledgers never
# print). Ledger detectors require the brand, an Opening/Closing Balance line,
# and NO card "NEW BALANCE"; `savings=` disambiguates a brand's chequing vs
# savings statement (list savings FIRST).
# ===========================================================================
# Brand markers per issuer (UPPERCASE; matched against the upper-cased text).
_BRANDS = {
    'rbc': ('RBC', 'ROYAL BANK'),
    'td': ('TD CANADA TRUST', 'TD BANK', 'TORONTO-DOMINION'),
    'scotia': ('SCOTIABANK', 'BANK OF NOVA SCOTIA'),
    'bmo': ('BMO', 'BANK OF MONTREAL'),
}


def _has(u, markers):
    return any(m in u for m in markers)


def _card_detect(brand, *, network):
    """Detector for a card statement: brand + card network + a 'NEW/TOTAL BALANCE'
    summary line (which chequing/savings statements never print)."""
    markers = _BRANDS[brand]

    def detect(t):
        u = t.upper()
        return (_has(u, markers) and network in u
                and ('NEW BALANCE' in u or 'TOTAL BALANCE' in u))
    return detect


def _ledger_detect(brand, *, savings=None):
    """Detector for a chequing/savings statement: brand + an Opening/Closing
    Balance line and NO card 'NEW BALANCE'. `savings=True` requires a SAVINGS
    marker; `savings=False` requires its absence (so the same brand's chequing and
    savings statements route to distinct handlers — list savings FIRST)."""
    markers = _BRANDS.get(brand, (brand.upper(),))

    def detect(t):
        u = t.upper()
        if not (_has(u, markers) and 'NEW BALANCE' not in u
                and ('OPENING BALANCE' in u or 'CLOSING BALANCE' in u)):
            return False
        if savings is None:
            return True
        has_savings = 'SAVINGS' in u or 'SAVING ACCOUNT' in u
        return has_savings if savings else not has_savings
    return detect


# ===========================================================================
# Scaffold bank registry — the single source of truth for the SCAFFOLDED banks.
# `registry.register_scaffolds()` reads this to wire routing (main/orchestrator);
# `statement_meta()` reads it for per-bank metadata. Each entry carries its
# routing priority (30–80, between the CIBC built-ins at 10/20 and the Amex
# fallback at 90). Within a brand that has both chequing AND savings (Tangerine,
# Wealthsimple), the SAVINGS handler is listed (and prioritised) FIRST so its
# savings-marker detector wins.
# ===========================================================================
class _Scaffold:
    def __init__(self, id, priority, detect, parse, meta):
        self.id = id
        self.priority = priority
        self.detect = detect
        self.parse = parse
        self.meta = meta


def _card_scaffold(profile, priority, detect):
    return _Scaffold(profile.source, priority, detect,
                     lambda p: _parse_card(p, profile),
                     lambda p: _card_meta(p, profile))


def _ledger_scaffold(profile, priority, detect):
    return _Scaffold(profile.source, priority, detect,
                     lambda p: _parse_ledger(p, profile),
                     lambda p: _ledger_meta(p, profile))


_SCAFFOLD_BANKS = [
    _card_scaffold(RBC_CARD, 30, _card_detect('rbc', network='VISA')),
    _ledger_scaffold(RBC_CHEQUING, 31, _ledger_detect('rbc')),
    _card_scaffold(TD_CARD, 32, _card_detect('td', network='VISA')),
    _ledger_scaffold(TD_CHEQUING, 33, _ledger_detect('td')),
    _card_scaffold(SCOTIA_CARD, 34, _card_detect('scotia', network='VISA')),
    _ledger_scaffold(SCOTIA_CHEQUING, 35, _ledger_detect('scotia')),
    _card_scaffold(BMO_CARD, 36, _card_detect('bmo', network='MASTERCARD')),
    _ledger_scaffold(BMO_CHEQUING, 37, _ledger_detect('bmo')),
    _ledger_scaffold(TANGERINE_SAVINGS, 38, _ledger_detect('tangerine', savings=True)),
    _ledger_scaffold(TANGERINE_CHEQUING, 39, _ledger_detect('tangerine', savings=False)),
    _ledger_scaffold(WS_SAVINGS, 40, _ledger_detect('wealthsimple', savings=True)),
    _ledger_scaffold(WS_CASH, 41, _ledger_detect('wealthsimple', savings=False)),
]


# ===========================================================================
# Built-in detectors — the single source of truth for routing the three VERIFIED
# parsers. `registry.register_builtins()` and `statement_meta()` both use these,
# so registry routing and metadata routing can't drift. CIBC chequing PDFs
# contain the literal "American Express" (Amex card-payment lines), so the Amex
# detector must always be checked LAST (registry priority 90; last branch here).
# ===========================================================================
def _detect_cibc_visa(t):
    return 'Aeroplan' in t and 'Visa' in t


def _detect_cibc_chequing(t):
    return 'CIBC Account Statement' in t


def _detect_amex(t):
    return 'American Express' in t


# Per-source metadata for the three VERIFIED built-ins. Each returns the same
# dict shape as the scaffolds' _card_meta/_ledger_meta PLUS `opening_balance`
# (verify.py reconciles cards with it; scaffolds don't carry one yet). They are
# registered on the built-in parsers (registry.register_builtins), so the
# orchestrator gets metadata from the SAME parser routing picked — no second
# detection pass.
def _cibc_visa_meta(path):
    t = text(path)
    period = _visa_period(t)
    # Account summary box: "Total balance   =   $167.93"
    m = re.search(r'Total balance\s*=?\s*' + _MONEY_SIGNED, t)
    # "Previous balance   $163.24" — opening balance; lets verify.py reconcile
    # cards (charges - credits == closing - opening).
    om = re.search(r'Previous balance\s+' + _MONEY_SIGNED, t, re.IGNORECASE)
    return {'source': 'cibc_visa', 'account': 'CIBC Aeroplan Visa', 'period': period,
            'closing_balance': _money(m.group(1)) if m else None,
            'closing_date': period_end(period),
            'opening_balance': _money(om.group(1)) if om else None}


def _cibc_chequing_meta(path):
    # The shared ledger meta (summary-box closing with the reconciled-balance
    # fallback — same chain as chequing_report). opening_balance is captured
    # there for every ledger profile now, so CIBC needs nothing extra.
    return _ledger_meta(path, CIBC_LEDGER)


def _amex_meta(path):
    t = text(path)
    period = _amex_period(t)
    # "Equals New Balance   $1,853.01" (summary box); plain "New Balance" fallback.
    m = re.search(r'Equals New Balance\s+' + _MONEY_SIGNED, t) or \
        re.search(r'New Balance\s+' + _MONEY_SIGNED, t)
    # "Previous Balance   $100.00" — opening balance (see verify.py).
    om = re.search(r'Previous Balance\s+' + _MONEY_SIGNED, t, re.IGNORECASE)
    return {'source': 'amex', 'account': 'Amex Gold', 'period': period,
            'closing_balance': _money(m.group(1)) if m else None,
            'closing_date': period_end(period),
            'opening_balance': _money(om.group(1)) if om else None}


def statement_meta(path):
    """Statement-level metadata: opening + closing balance + closing date per source.

    Balances are stored AS PRINTED — positive means money in the account for
    chequing/savings and amount owed for cards; the app's net-worth layer applies
    the liability sign. A thin router: the SAME detect/meta pairs the registry
    registers (built-ins above, scaffolds via _SCAFFOLD_BANKS), one source of
    truth. Every source carries an `opening_balance` too (None when the anchor
    missed) — verify.py reconciles with it. Returns None for unrecognized PDFs.
    """
    t = text(path)
    if _detect_cibc_visa(t):
        return _cibc_visa_meta(path)
    if _detect_cibc_chequing(t):
        return _cibc_chequing_meta(path)
    if _detect_amex(t):
        # Checked before the scaffolds (unlike the registry, which keeps Amex
        # the LAST-priority fallback) — safe either way, since scaffold
        # detectors key on distinct brand markers.
        return _amex_meta(path)
    for b in _SCAFFOLD_BANKS:
        if b.detect(t):
            return b.meta(path)
    return None


def main(src_dir, out_csv):
    # Routing lives in the registry (registry.py) and is driven by the
    # orchestrator (orchestrator.py) — Phase 1 of the self-improving parser.
    # register_builtins wires the three verified parsers (Visa 10 -> chequing 20
    # -> Amex fallback 90); register_scaffolds wires the scaffolded banks from
    # _SCAFFOLD_BANKS (priorities 30-80, so they slot between chequing and the
    # Amex fallback — chequing statements contain the text "American Express").
    import sys as _sys
    import registry, orchestrator
    registry.register_builtins(_sys.modules[__name__])
    registry.register_scaffolds(_sys.modules[__name__])

    rows, metas = [], []
    for f in sorted(glob.glob(os.path.join(src_dir, '*.pdf'))):
        result = orchestrator.parse_file(f, text_fn=text, meta_fn=statement_meta)
        if result is None:
            sys.stderr.write(f"skip (no parser matched): {os.path.basename(f)}\n")
            continue
        frows, meta = result
        rows += frows
        if meta:
            meta['filename'] = os.path.basename(f)
            metas.append(meta)

    if out_csv == '--json':
        print(json.dumps({
            'transactions': [
                {'source': r[0], 'account': r[1], 'period': r[2], 'txn_date': r[3],
                 'description': r[4], 'amount': r[5], 'category': r[6], 'flow': r[7]}
                for r in rows
            ],
            'statements': metas,
        }))
    else:
        with open(out_csv, 'w', newline='') as fh:
            w = csv.writer(fh)
            w.writerow(['source', 'account', 'period', 'txn_date', 'description', 'amount', 'category', 'flow'])
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {out_csv}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.',
         sys.argv[2] if len(sys.argv) > 2 else 'transactions.csv')
