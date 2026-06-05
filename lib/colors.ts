// Muted earth-tone palette. Colour is reserved for DATA (category fills, dots,
// progress bars); the chrome — borders, type, layout — stays monochrome so the
// brutalist structure still reads. Keep these in sync with any chart usage.

export const PALETTE = {
  sage: "#8a9b66",
  greige: "#d6d3ca",
  mustard: "#e0a73a",
  lightgrey: "#cdccc7",
  wheat: "#e7d68c",
  dustyblue: "#a6c0cd",
  rose: "#cd9b8d",
  cream: "#ebe7da",
  espresso: "#473c37",
  celadon: "#c7d0a4",
  slate: "#4d7691",
  terracotta: "#b3654a",
} as const;

// Stable colour per category. Tuned so the highest-volume categories are visually
// distinct from each other in the donut / breakdown.
export const CATEGORY_COLORS: Record<string, string> = {
  "Travel (air/hotel)": PALETTE.rose,
  "Restaurants & takeout": PALETTE.terracotta,
  "Running / cycling gear": PALETTE.mustard,
  "Gym / fitness / recovery": PALETTE.sage,
  "Transport / gas / parking": PALETTE.slate,
  "Subscriptions": PALETTE.dustyblue,
  "Groceries": PALETTE.celadon,
  "Coffee": PALETTE.espresso,
  "Shopping / retail": PALETTE.wheat,
  "Health / pharmacy": PALETTE.greige,
  "Phone / utilities": PALETTE.lightgrey,
  "Rent / housing": PALETTE.espresso,
  "Gambling": "#6f5547",
  "Cash advance / fees": "#9a9690",
  "Banking": PALETTE.greige,
  "Other / uncategorized": "#c4c1b8",
};

const FALLBACK = Object.values(PALETTE);

// Deterministic fallback for any category not in the map above.
export function categoryColor(name: string): string {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK[Math.abs(hash) % FALLBACK.length];
}
