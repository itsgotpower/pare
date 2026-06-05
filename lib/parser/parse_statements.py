"""Parse Amex Gold and CIBC (Visa + chequing) PDF statements into a tidy CSV.

Usage:
    python lib/parser/parse_statements.py /path/to/statements_dir out.csv

Output columns: source, account, period, txn_date, description, amount, category, flow
  - source: 'amex' | 'cibc_visa' | 'cibc_chequing'
  - flow:   'spend' | 'payment' | 'income' | 'transfer' | 'fee_interest'
Amounts are positive for spend/outflow. Internal transfers, card payments,
income, and balance transfers are tagged so they can be excluded from "spend".

Requires: pdftotext (poppler-utils). pip install nothing else.
"""
import subprocess, re, sys, glob, os, csv, json
sys.path.insert(0, os.path.dirname(__file__))
from categories import categorize

DATE = r'[A-Z][a-z]{2}\s+\d{1,2}'
MONEY = r'-?[\d,]+\.\d{2}'

MONTHS = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
}

def text(path):
    return subprocess.run(['pdftotext', '-layout', path, '-'],
                          capture_output=True, text=True).stdout

def parse_date(date_str, ref_year):
    """Parse 'Mon DD' into 'YYYY-MM-DD' using ref_year for context."""
    m = re.match(r'([A-Z][a-z]{2})\s+(\d{1,2})', date_str.strip())
    if not m:
        return None
    month_name, day = m.group(1), int(m.group(2))
    month_num = MONTHS.get(month_name)
    if not month_num:
        return None
    year = ref_year
    # Handle Dec txns in a Jan-closing statement
    if month_num == 12 and ref_year:
        closing_month = None
        # We'll handle this in the caller by passing period context
        pass
    return f"{year}-{month_num:02d}-{day:02d}"


def extract_year(period_str):
    """Extract year from period string like 'Dec 03, 2025' or 'Jan 28 to Feb 27, 2026'."""
    m = re.search(r'(\d{4})', period_str)
    return int(m.group(1)) if m else 2026


def parse_amex(path):
    rows, t = [], text(path)
    # The header value line carries BOTH dates: "... Opening Date  Closing Date"
    # then "... Feb 03, 2026   Mar 02, 2026". Grab the CLOSING date (the second);
    # the older regex grabbed the opening date, which threw off year inference.
    cm = re.search(
        r'Opening Date\s+Closing Date\s*\n[^\n]*?(' + DATE + r',\s*\d{4})\s+(' + DATE + r',\s*\d{4})',
        t)
    period = cm.group(2) if cm else (
        "".join(re.findall(r'Closing Date\s*\n?.*?(' + DATE + r',\s*\d{4})', t)[:1]) or "amex")
    ref_year = extract_year(period)
    cmonth_m = re.match(r'([A-Z][a-z]{2})', period)
    closing_month = MONTHS.get(cmonth_m.group(1), 1) if cmonth_m else 1
    rx = re.compile(rf'^({DATE})\s+({DATE})\s+(.*?)\s+({MONEY})\s*$')
    cap = False
    for ln in t.splitlines():
        if 'New Transactions for' in ln: cap = True; continue
        if 'Total of New Transactions' in ln or 'Other Account Transactions' in ln: cap = False; continue
        if not cap: continue
        m = rx.match(ln.strip())
        if not m: continue
        txn_date_raw, _, desc, amt = m.groups()
        if 'UNITED STATES DOLLAR' in desc: continue
        amt = float(amt.replace(',', ''))
        desc = desc.strip()
        # Year = closing year, except a December transaction on a January-closing
        # statement belongs to the prior year (the only month the period crosses).
        txn_year = ref_year
        tmm = re.match(r'([A-Z][a-z]{2})', txn_date_raw.strip())
        txn_month = MONTHS.get(tmm.group(1), 1) if tmm else 1
        if txn_month == 12 and closing_month == 1:
            txn_year = ref_year - 1
        txn_date = parse_date(txn_date_raw, txn_year)
        cat = categorize(desc)
        flow = 'fee_interest' if cat == 'Cash advance / fees' else 'spend'
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

def parse_cibc_visa(path):
    rows, t = [], text(path)
    period = "".join(re.findall(r'period\s*\n?.*?(\w+ \d+ to \w+ \d+, \d{4})', t)[:1]) or "cibc_visa"
    ref_year = extract_year(period)
    rx = re.compile(rf'^({DATE})\s+({DATE})\s+(?:Q\s+)?(.*?)\s+({CIBC_CATS})\s+({MONEY})\s*$')
    cap = False
    for ln in t.splitlines():
        if 'Your new charges' in ln: cap = True; continue
        if 'Total for' in ln: cap = False; continue
        if not cap: continue
        u = ln.upper()
        if 'BALANCE TRANSFER' in u:
            amt = float(re.findall(MONEY, ln)[-1].replace(',', ''))
            txn_date = parse_date(re.match(rf'({DATE})', ln.strip()).group(1), ref_year) if re.match(rf'({DATE})', ln.strip()) else ''
            rows.append(('cibc_visa', 'CIBC Aeroplan Visa', period, txn_date or '', 'BALANCE TRANSFER', amt, 'Cash advance / fees', 'transfer')); continue
        if 'CASH ADV' in u or 'CONV CHQ FEE' in u:
            amt = float(re.findall(MONEY, ln)[-1].replace(',', ''))
            txn_date = parse_date(re.match(rf'({DATE})', ln.strip()).group(1), ref_year) if re.match(rf'({DATE})', ln.strip()) else ''
            rows.append(('cibc_visa', 'CIBC Aeroplan Visa', period, txn_date or '', 'CASH ADV / BT FEE', amt, 'Cash advance / fees', 'fee_interest')); continue
        m = rx.match(ln.strip())
        if not m: continue
        txn_date_raw, _, desc, _spendcat, amt = m.groups()
        amt = float(amt.replace(',', ''))
        desc = desc.strip()
        txn_date = parse_date(txn_date_raw, ref_year)
        cat = categorize(desc)
        flow = 'fee_interest' if cat == 'Cash advance / fees' else 'spend'
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


def parse_cibc_chequing(path):
    """Parse a CIBC chequing statement.

    Two structural realities of these PDFs drive the design:
      1. Withdrawals and Deposits are separate columns. Rather than rely on
         fragile column offsets, we use the printed running balance to decide
         direction: prev_balance + amount == row_balance => deposit (in);
         prev_balance - amount == row_balance => withdrawal (out). Self-verifying;
         any row that reconciles to neither is flagged (stderr) and skipped.
      2. Transactions span multiple lines. The date+amount line is followed by
         continuation line(s) holding the e-transfer recipient / detail
         (e.g. PEOPLE CENTER, a name, CIBC CARD PRODUCTS DIVISION). We fold those
         onto the transaction so classification can see them.

    Amounts are stored positive; flow encodes direction. Category stays 'Banking'
    (chequing is not card spend). Rent is surfaced via the recipient name in the
    description and tagged later by an in-app category rule (keeps personal
    e-transfer handles out of tracked source).
    """
    period, txns = _walk_chequing(path)
    rows = []
    for txn in txns:
        if txn['direction'] == 'unreconciled':
            sys.stderr.write(
                f"[chequing] unreconciled row (prev={txn['prev']:.2f} "
                f"amt={txn['amount']:.2f} bal={txn['balance']:.2f}): "
                f"{' '.join(txn['desc_parts'])}\n")
            continue
        folded = ' '.join(txn['desc_parts']).strip()
        flow = _classify_chequing(folded, txn['direction'])
        rows.append(('cibc_chequing', 'CIBC Chequing', period,
                     txn['date'] or '', folded or 'TRANSACTION',
                     txn['amount'], 'Banking', flow))
    return rows


def _walk_chequing(path):
    """Shared walk over a CIBC chequing statement. Returns (period, txns) where
    each txn dict carries date, desc_parts, amount, balance, prev, direction.

    Direction comes from reconciling against the printed running balance:
    prev + amount == balance => 'in'; prev - amount == balance => 'out';
    otherwise 'unreconciled'. Transactions span multiple lines, so continuation
    lines (recipient name, PEOPLE CENTER, CARD PRODUCTS, FX notes) are folded onto
    the preceding transaction.
    """
    t = text(path)
    period = "".join(re.findall(r'For (\w+ \d+ to \w+ \d+, \d{4})', t)[:1]) or "cibc_chequing"
    ref_year = extract_year(period)

    open_m = re.search(r'Opening balance on[^\n]*?\$?([\d,]+\.\d{2})', t)
    running = _money(open_m.group(1)) if open_m else None

    capturing = False
    cur_date = None
    txns = []
    last = None

    for ln in t.splitlines():
        # Page-aware gating: start at the column header, stop at each page footer.
        if re.search(r'Date\s+Description\s+Withdrawals', ln):
            capturing = True
            continue
        if re.search(r'Page\s+\d+\s+of\s+\d+', ln):
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

        dm = re.match(r'\s*([A-Z][a-z]{2})\s+(\d{1,2})\b', ln)
        if dm and dm.group(1) in MONTHS:
            cur_date = parse_date(f"{dm.group(1)} {dm.group(2)}", ref_year)

        is_fx = FX_NOTE.search(ln) is not None

        # A transaction line carries amount + running balance (>=2 money tokens)
        # and reconciles against the running balance. FX notes are never txns.
        if len(monies) >= 2 and running is not None and not is_fx:
            amount = _money(monies[0].group())
            balance = _money(monies[-1].group())
            if abs(round(running + amount - balance, 2)) < 0.01:
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


def chequing_report(path):
    """Verification helper: tie parsed inflows/outflows to the printed
    Account-summary box. Uses the same walk as the parser so they can't diverge.
    """
    t = text(path)

    def grab(rx):
        m = re.search(rx, t)
        return _money(m.group(1)) if m else None

    summary = {
        'opening': grab(r'Opening balance on[^\n]*?\$?([\d,]+\.\d{2})'),
        'withdrawals': grab(r'Withdrawals\s+-\s+([\d,]+\.\d{2})'),
        'deposits': grab(r'Deposits\s+\+\s+([\d,]+\.\d{2})'),
        'closing': grab(r'=\s+\$([\d,]+\.\d{2})'),
    }

    period, txns = _walk_chequing(path)
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


def main(src_dir, out_csv):
    rows = []
    for f in sorted(glob.glob(os.path.join(src_dir, '*.pdf'))):
        t = text(f)
        # Order matters: chequing statements contain "American Express" (Amex card
        # payments), so check the specific CIBC titles before the Amex fallback.
        if 'Aeroplan' in t and 'Visa' in t:    rows += parse_cibc_visa(f)
        elif 'CIBC Account Statement' in t:    rows += parse_cibc_chequing(f)
        elif 'American Express' in t:          rows += parse_amex(f)

    if out_csv == '--json':
        print(json.dumps([
            {'source': r[0], 'account': r[1], 'period': r[2], 'txn_date': r[3],
             'description': r[4], 'amount': r[5], 'category': r[6], 'flow': r[7]}
            for r in rows
        ]))
    else:
        with open(out_csv, 'w', newline='') as fh:
            w = csv.writer(fh)
            w.writerow(['source', 'account', 'period', 'txn_date', 'description', 'amount', 'category', 'flow'])
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {out_csv}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.',
         sys.argv[2] if len(sys.argv) > 2 else 'transactions.csv')
