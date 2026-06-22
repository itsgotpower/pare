// Provider presets for the cross-app importer. Each preset describes where the
// canonical fields live in that provider's CSV export and how its amount sign
// works, plus a header "fingerprint" used to auto-detect the provider so the
// user usually doesn't have to pick. Sources are USER-EXPORTED files only — no
// scraping or automated login.
//
// Field arrays are candidate header names (compared case-insensitively, first
// match wins) so small export-version differences still resolve.

export type Provider = "monarch" | "mint" | "ynab";

export interface ColumnMap {
  date: string[];
  description: string[]; // merchant / payee
  amount?: string[]; // single signed column (Monarch / Mint)
  outflow?: string[]; // YNAB's split pair...
  inflow?: string[]; // ...both positive
  category: string[];
  account: string[]; // foreign account name
  txnType?: string[]; // Mint's debit/credit column
}

export interface Preset {
  provider: Provider;
  label: string;
  columns: ColumnMap;
  // "signed": one amount column, negative = money out (Monarch).
  // "type": positive amount + a debit/credit type column (Mint).
  // "outflow_inflow": split positive Outflow/Inflow columns (YNAB).
  signConvention: "signed" | "type" | "outflow_inflow";
  // Headers that, if present, strongly identify this provider.
  fingerprint: string[];
}

export const PRESETS: Record<Provider, Preset> = {
  monarch: {
    provider: "monarch",
    label: "Monarch Money",
    signConvention: "signed",
    columns: {
      date: ["date"],
      description: ["merchant", "description"],
      amount: ["amount"],
      category: ["category"],
      account: ["account"],
    },
    // Monarch's export carries "Merchant" + "Original Statement" — distinctive.
    fingerprint: ["merchant", "original statement"],
  },
  mint: {
    provider: "mint",
    label: "Mint",
    signConvention: "type",
    columns: {
      date: ["date"],
      description: ["description", "original description"],
      amount: ["amount"],
      category: ["category"],
      account: ["account name", "account"],
      txnType: ["transaction type"],
    },
    fingerprint: ["transaction type", "account name"],
  },
  ynab: {
    provider: "ynab",
    label: "YNAB",
    signConvention: "outflow_inflow",
    columns: {
      date: ["date"],
      description: ["payee", "description"],
      outflow: ["outflow"],
      inflow: ["inflow"],
      category: ["category", "category group/category"],
      account: ["account"],
    },
    fingerprint: ["outflow", "inflow", "payee"],
  },
};

export const PROVIDERS = Object.keys(PRESETS) as Provider[];

// Score each preset's fingerprint against the file's headers (lowercased) and
// return the best non-zero match, or null when nothing is distinctive enough
// (the UI then asks the user to pick). A preset only wins if it matches ALL of
// its fingerprint headers — fingerprints are chosen to be unambiguous.
export function detectPreset(headers: string[]): Provider | null {
  const have = new Set(headers.map((h) => h.trim().toLowerCase()));
  let best: { provider: Provider; score: number } | null = null;
  for (const preset of Object.values(PRESETS)) {
    const matched = preset.fingerprint.filter((f) => have.has(f)).length;
    if (matched === preset.fingerprint.length) {
      if (!best || matched > best.score) best = { provider: preset.provider, score: matched };
    }
  }
  return best?.provider ?? null;
}

// Resolve a logical field to a column index in the given headers, or -1.
export function columnIndex(headers: string[], candidates: string[] | undefined): number {
  if (!candidates) return -1;
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}
