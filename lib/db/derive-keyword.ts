// Derive a stable rule keyword from a raw transaction description, so tagging a
// merchant once can seed a rule that auto-tags every future (and past) charge
// from it — instead of the user hand-trimming "URBAN FARE #7614 VANCOUVER" down
// to "URBAN FARE" every time.
//
// CONTRACT: the result is always a CONTIGUOUS substring of the (whitespace-
// normalized, upper-cased) description. recategorizeMatching matches rules with
// `UPPER(description) LIKE '%' || UPPER(keyword) || '%'`, so a non-contiguous
// keyword (e.g. dropping a store number from the MIDDLE) would silently fail to
// tag the very row it came from. We therefore only ever cut a PREFIX (at the
// first store/terminal number) and pop TRAILING location codes.
//
// It errs toward SPECIFICITY (keeping a trailing city word rather than guessing
// it away): an over-specific rule fails safe (tags fewer rows), while an
// over-broad short keyword reintroduces the substring-collision class of bug the
// categorizer was carefully built to avoid. Returns null when nothing safe can
// be derived — the caller then just skips the auto-rule.

// Province/territory + country codes that trail a printed merchant location.
const TRAILING_CODES = new Set([
  "BC", "AB", "SK", "MB", "ON", "QC", "QUE", "NB", "NS", "NL", "NF", "PE", "PEI",
  "NT", "YT", "NU", "USA", "US", "CA", "CAN", "UK",
]);

// Payment-processor / terminal prefixes printed IN FRONT of the real merchant.
const LEADING_PREFIXES = [
  /^TST[*\-]\s*/, /^SQ ?\*\s*/, /^SP[ +*]\s*/, /^PAYPAL\s*\*\s*/, /^PP\*\s*/,
  /^POS\s+/, /^ABM\s+/, /^IDP\s+/,
];

// Words too generic to stand alone as a keyword.
const STOPWORDS = new Set([
  "THE", "AND", "OF", "INC", "LTD", "LLC", "CO", "CORP", "POS", "PURCHASE",
  "PAYMENT", "STORE", "VISA", "DEBIT", ...TRAILING_CODES,
]);

export function deriveKeyword(description: string): string | null {
  if (!description) return null;
  let d = description.toUpperCase().replace(/\s+/g, " ").trim();
  for (const re of LEADING_PREFIXES) d = d.replace(re, "");
  d = d.trim();

  let tokens = d.split(" ").filter(Boolean);

  // Cut at the first store/terminal number token — everything after it is
  // location/register noise. Slicing a prefix keeps the keyword contiguous.
  const cut = tokens.findIndex((t) => /^#?\d+$/.test(t));
  if (cut === 0) return null; // starts with a number — nothing to key on
  if (cut > 0) tokens = tokens.slice(0, cut);

  // Drop a trailing run of province/country codes and lone letters.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (TRAILING_CODES.has(last) || /^[A-Z]$/.test(last)) tokens.pop();
    else break;
  }

  // Drop leading noise words ("POS PURCHASE …", "VISA DEBIT …", "THE …") — still
  // a contiguous run, so the substring contract holds.
  while (tokens.length > 1 && STOPWORDS.has(tokens[0])) tokens.shift();

  const keyword = tokens.join(" ").trim();
  if (keyword.length < 4) return null; // too short → collision risk
  if (tokens.every((t) => STOPWORDS.has(t))) return null;
  return keyword;
}
