// Tiny shared stats helpers for the lib/db query layer (no DB access).

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Median inter-charge gap → a human frequency label. One set of buckets so the
// recurring detector (subscriptions.ts) and the merchant drill-down
// (merchants.ts) read consistently; `fallback` covers the <2-dates case
// ("monthly" for the detector, "one-off" for a merchant page).
export function frequencyLabel(dates: string[], fallback = "monthly"): string {
  if (dates.length < 2) return fallback;
  const days = dates
    .map((d) => new Date(d + "T00:00:00").getTime())
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push((days[i] - days[i - 1]) / 86400000);
  }
  const g = median(gaps);
  if (g <= 10) return "weekly";
  if (g <= 20) return "biweekly";
  if (g <= 45) return "monthly";
  if (g <= 75) return "every ~2 months";
  return "irregular";
}
