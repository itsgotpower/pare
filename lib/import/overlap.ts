// Fuzzy description similarity for the import↔PDF overlap guard. Cross-source
// hash dedup (dedup_key includes `source`) deliberately can't catch an imported
// row and the same txn later parsed from a PDF — they have different sources, so
// different keys. The guard pairs exact-amount + ±3-day candidates and then asks
// "are these the same merchant?" via this comparison.
//
// Token Jaccard (not Levenshtein): bank descriptions carry noise tokens — store
// numbers, city/state, terminal ids — that edit-distance over-weights. Stripping
// digit runs and short tokens, then comparing the SET of remaining words, is both
// cheaper and more forgiving of that noise. Tunable via SIMILARITY_THRESHOLD.

export const SIMILARITY_THRESHOLD = 0.5;

// Upper-case, drop punctuation and digit runs, split on whitespace, keep tokens
// of length >= 2. "STARBUCKS #1234 SEATTLE WA" -> ["STARBUCKS","SEATTLE","WA"].
export function normalizeDesc(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// True when two descriptions plausibly name the same merchant: a Jaccard at or
// above the threshold, OR they share their first significant token (catches a
// long bank string vs. a short clean name, e.g. "STARBUCKS STORE 1234 SEATTLE"
// vs "STARBUCKS"). Callers gate this behind exact-amount + ±N-day first, so a
// shared-first-token match alone can't collide unrelated rows.
export function descSimilar(a: string, b: string, threshold = SIMILARITY_THRESHOLD): boolean {
  const ta = normalizeDesc(a);
  const tb = normalizeDesc(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (jaccard(ta, tb) >= threshold) return true;
  return ta[0] === tb[0];
}
