// Best-effort default mappings from foreign provider categories to pare's
// canonical taxonomy (the category NAMES from lib/db/categories.ts STARTER_RULES
// / lib/colors.ts). GENERIC, non-personal strings only — same privacy boundary
// as the shipped starter rules. Anything not confidently mapped is surfaced in
// the wizard's mapping step for the user to assign; unmapped at commit falls back
// to 'Other / uncategorized'. Imported categories are authoritative thereafter
// (recategorizeAll skips import_id rows).

export const UNCATEGORIZED = "Other / uncategorized";

// Exact (lowercased) foreign category -> pare category. Covers the common
// Monarch / Mint / YNAB default category names.
const EXACT: Record<string, string> = {
  // Groceries
  groceries: "Groceries",
  grocery: "Groceries",
  // Coffee
  coffee: "Coffee",
  "coffee shops": "Coffee",
  // Restaurants
  restaurants: "Restaurants & takeout",
  "restaurants & bars": "Restaurants & takeout",
  "dining & drinks": "Restaurants & takeout",
  "food & dining": "Restaurants & takeout",
  "fast food": "Restaurants & takeout",
  "dining out": "Restaurants & takeout",
  // Shopping
  shopping: "Shopping / retail",
  "general merchandise": "Shopping / retail",
  clothing: "Shopping / retail",
  electronics: "Shopping / retail",
  "online shopping": "Shopping / retail",
  // Transport
  "gas": "Transport / gas / parking",
  "gas & fuel": "Transport / gas / parking",
  "auto & transport": "Transport / gas / parking",
  transportation: "Transport / gas / parking",
  "public transportation": "Transport / gas / parking",
  transit: "Transport / gas / parking",
  parking: "Transport / gas / parking",
  "ride share": "Transport / gas / parking",
  taxi: "Transport / gas / parking",
  // Travel
  travel: "Travel (air/hotel)",
  "air travel": "Travel (air/hotel)",
  flights: "Travel (air/hotel)",
  hotel: "Travel (air/hotel)",
  vacation: "Travel (air/hotel)",
  // Subscriptions
  subscriptions: "Subscriptions",
  streaming: "Subscriptions",
  software: "Subscriptions",
  // Phone / utilities
  utilities: "Phone / utilities",
  "mobile phone": "Phone / utilities",
  phone: "Phone / utilities",
  internet: "Phone / utilities",
  cable: "Phone / utilities",
  // Fitness
  gym: "Gym / fitness / recovery",
  fitness: "Gym / fitness / recovery",
  "gym/fitness": "Gym / fitness / recovery",
  // Health
  health: "Health / pharmacy",
  "health & fitness": "Health / pharmacy",
  medical: "Health / pharmacy",
  pharmacy: "Health / pharmacy",
  doctor: "Health / pharmacy",
  dentist: "Health / pharmacy",
  // Housing
  rent: "Rent / housing",
  mortgage: "Rent / housing",
  "mortgage & rent": "Rent / housing",
  "rent & mortgage": "Rent / housing",
  housing: "Rent / housing",
  // Fees
  "fees & charges": "Cash advance / fees",
  "bank fees": "Cash advance / fees",
  "service fee": "Cash advance / fees",
  "atm fee": "Cash advance / fees",
  "finance charge": "Cash advance / fees",
  interest: "Cash advance / fees",
  // Transfers / payments -> Banking (flow inference reclassifies the FLOW; the
  // category is cosmetic for these and excluded from spend/outflow anyway).
  transfer: "Banking",
  transfers: "Banking",
  "credit card payment": "Banking",
  payment: "Banking",
  // Gambling
  gambling: "Gambling",
  lottery: "Gambling",
};

// Substring heuristics applied when there's no exact match. Order matters.
const CONTAINS: [RegExp, string][] = [
  [/grocer/, "Groceries"],
  [/coffee|cafe/, "Coffee"],
  [/restaurant|dining|food|takeout|bar\b/, "Restaurants & takeout"],
  [/gas|fuel|parking|transit|transport|uber|lyft|rideshare/, "Transport / gas / parking"],
  [/travel|flight|hotel|airline|airbnb/, "Travel (air/hotel)"],
  [/subscription|stream/, "Subscriptions"],
  [/phone|mobile|internet|utilit|hydro|cable/, "Phone / utilities"],
  [/gym|fitness|yoga|pilates/, "Gym / fitness / recovery"],
  [/health|medical|pharmac|dental|dentist|doctor|clinic/, "Health / pharmacy"],
  [/rent|mortgage|housing/, "Rent / housing"],
  [/fee|interest|charge|nsf|overdraft/, "Cash advance / fees"],
  [/transfer|payment/, "Banking"],
  [/gambl|casino|lottery|poker/, "Gambling"],
  [/shop|retail|merchandise|clothing|electronic|amazon/, "Shopping / retail"],
];

// Suggest a pare category for one foreign category. `known` is false when no
// rule matched (the wizard flags it for review).
export function suggestCategory(foreign: string): { category: string; known: boolean } {
  const key = foreign.trim().toLowerCase();
  if (!key) return { category: UNCATEGORIZED, known: false };
  if (EXACT[key]) return { category: EXACT[key], known: true };
  for (const [re, cat] of CONTAINS) if (re.test(key)) return { category: cat, known: true };
  return { category: UNCATEGORIZED, known: false };
}

// Partition a list of distinct foreign categories into a default map plus the
// ones that need user review.
export function defaultCategoryMap(foreignCategories: string[]): {
  map: Record<string, string>;
  unknown: string[];
} {
  const map: Record<string, string> = {};
  const unknown: string[] = [];
  for (const fc of foreignCategories) {
    const { category, known } = suggestCategory(fc);
    map[fc] = category;
    if (!known) unknown.push(fc);
  }
  return { map, unknown };
}
