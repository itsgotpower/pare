// Merchant identity — the normalized name/slug used to collapse a merchant's many
// statement descriptions ("STARBUCKS #1234 VANCOUVER", "STARBUCKS #5678 BURNABY")
// into one drillable merchant. PURE (no DB), so both the server query layer
// (lib/db/merchants.ts) and client components (the dashboard TOP MERCHANTS list,
// the merchants pages) import the SAME normalization — links and groups agree.
//
// This is deliberately separate from subscriptions.ts's merchantKey: that one is a
// raw 14-char prefix tuned for recurring-charge detection; this one strips the
// trailing store-number / location noise so the drill-down groups a brand cleanly.

// A clean, human display name: cut at the first big whitespace gap (the location
// column), then drop long digit/ref runs (store numbers, auth codes) and what
// follows. Falls back to the raw description if the cuts leave nothing.
export function merchantDisplay(desc: string): string {
  const cleaned = desc
    .replace(/\s{2,}.*$/, "") // cut at the big gap before location
    .replace(/[0-9*#]{4,}.*$/, "") // cut at long number / ref runs
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return cleaned || desc.replace(/\s+/g, " ").trim().slice(0, 32) || "UNKNOWN";
}

// A URL-safe grouping key derived from the display name: uppercase, non-alnum runs
// collapsed to single dashes, trimmed. Two descriptions of the same brand land on
// the same slug, and the slug is safe to drop straight into a path segment (no
// spaces, slashes, or %-encoding needed).
export function merchantSlug(desc: string): string {
  const slug = merchantDisplay(desc)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "UNKNOWN";
}
