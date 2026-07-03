// Shared client-side formatters + chart style tokens. One home so the locale,
// currency, month labels, and Recharts tooltip theming can't drift between
// pages/tabs (they used to be re-declared per file).

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Whole dollars — the default for charts/stat cards.
export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

// With cents — for transaction rows and per-charge amounts.
export const formatCents = (value: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);

export const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}`;

// "2026-03" -> "Mar"
export const formatMonthShort = (ym: string) =>
  MONTH_NAMES[parseInt(ym.split("-")[1], 10) - 1]?.slice(0, 3) ?? ym;

// "2026-03" -> "March 2026"
export const formatMonthFull = (ym: string | number) => {
  const s = String(ym);
  const [y, m] = s.split("-");
  if (!m) return s;
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
};

// "2026-03-05" -> "Mar 5"
export const formatDayShort = (iso: string) => {
  const [, m, d] = iso.split("-");
  if (!d) return iso;
  return `${MONTH_NAMES[parseInt(m, 10) - 1]?.slice(0, 3)} ${parseInt(d, 10)}`;
};

// Y-axis dollars-in-thousands tick: 4000 -> "$4k", 2500 -> "$2.5k".
// Keep one decimal for non-integer thousands — recharts often picks 500-step
// ticks, and rounding those to whole k renders duplicate labels ($3k twice).
export const formatK = (v: number) => {
  const k = v / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
};

// Recharts Tooltip contentStyle. Uses theme tokens (NOT hardcoded #000/white)
// so tooltips render correctly in dark mode.
export const CHART_TOOLTIP_STYLE = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 0,
} as const;

// Recharts axis tick prop for the mono, small-caps chart look.
export const MONO_TICK = { fontSize: 10, fontFamily: "var(--font-mono)" } as const;
