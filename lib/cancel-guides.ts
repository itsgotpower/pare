// Where to actually cancel a subscription, keyed by merchant keyword.
// Generic, universal merchants only (same privacy rule as KNOWN_RECURRING /
// STARTER_RULES — no personal merchants in tracked source). First match on the
// UPPERCASED merchant name wins; everything else falls back to a search link.
//
// Client-safe: no DB, no React.

interface CancelGuide {
  keyword: string;
  url: string;
  note?: string; // one-line gotcha shown next to the link
}

const GUIDES: CancelGuide[] = [
  { keyword: "NETFLIX", url: "https://www.netflix.com/cancelplan" },
  {
    keyword: "SPOTIFY",
    url: "https://www.spotify.com/account/subscription/",
  },
  {
    keyword: "APPLE.COM/BILL",
    url: "https://account.apple.com/account/manage",
    note: "Settings → [your name] → Subscriptions on iPhone is faster",
  },
  {
    keyword: "ICLOUD",
    url: "https://account.apple.com/account/manage",
    note: "Settings → [your name] → iCloud → Manage Storage on iPhone",
  },
  {
    keyword: "PRIME",
    url: "https://www.amazon.ca/mc/yourmembershipsandsubscriptions",
  },
  {
    keyword: "AMAZON MUSIC",
    url: "https://www.amazon.ca/mc/yourmembershipsandsubscriptions",
  },
  {
    keyword: "AUDIBLE",
    url: "https://www.audible.ca/account/overview",
    note: "cancel is under Membership details — chat support can pause instead",
  },
  { keyword: "DISNEY", url: "https://www.disneyplus.com/account" },
  {
    keyword: "YOUTUBE",
    url: "https://www.youtube.com/paid_memberships",
  },
  {
    keyword: "GOOGLE ONE",
    url: "https://one.google.com/settings",
  },
  { keyword: "CLASSPASS", url: "https://classpass.com/account" },
  { keyword: "STRAVA", url: "https://www.strava.com/account" },
  { keyword: "CLAUDE", url: "https://claude.ai/settings/billing" },
  {
    keyword: "TELUS",
    url: "https://www.telus.com/my-telus",
    note: "plan changes usually need chat or a call",
  },
  {
    keyword: "ROGERS",
    url: "https://www.rogers.com/consumer/self-serve",
    note: "plan changes usually need chat or a call",
  },
];

export function cancelGuide(merchant: string): CancelGuide {
  const upper = merchant.toUpperCase();
  const hit = GUIDES.find((g) => upper.includes(g.keyword));
  if (hit) return hit;
  return {
    keyword: merchant,
    url: `https://www.google.com/search?q=${encodeURIComponent(
      `cancel ${merchant.toLowerCase()} subscription`
    )}`,
    note: "no direct link known — this searches for the cancel page",
  };
}
