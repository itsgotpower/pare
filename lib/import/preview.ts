// Orchestrates parse → detect → suggest into the ImportPreview the wizard's
// mapping step renders. Pure (no DB): the API route feeds in the raw CSV text
// and an optional provider override; the client edits the suggested maps and
// posts them back to /api/import/commit, which RE-parses from the raw CSV (never
// trusts client-supplied rows).

import { parseCsv } from "./csv";
import { type Provider, type Preset, PRESETS, detectPreset, columnIndex } from "./presets";
import {
  type AccountMapping,
  type NormalizedRow,
  type DropReason,
  type DateOrder,
  suggestAccountMapping,
  normalizeAll,
} from "./normalizer";
import { defaultCategoryMap } from "./category-defaults";

export interface AccountSuggestion {
  foreignAccount: string;
  txnCount: number;
  suggested: AccountMapping;
}

export interface CategorySuggestion {
  foreignCategory: string;
  txnCount: number;
  suggested: string;
  isUnknown: boolean;
}

export interface ImportPreview {
  provider: Provider;
  detected: boolean; // false => provider came from the caller's override
  rowCount: number; // data rows in the file (pre-drop)
  dropped: DropReason[];
  dateRange: { min: string | null; max: string | null };
  dateOrder: DateOrder; // how slash dates were read (detected from the whole column)
  accounts: AccountSuggestion[];
  categories: CategorySuggestion[];
  sample: NormalizedRow[]; // first ~20 normalized rows under the default maps
}

export type AnalyzeResult =
  | { ok: true; preview: ImportPreview; preset: Preset }
  | { ok: false; error: "no_rows" }
  | { ok: false; error: "unknown_provider"; headers: string[] };

const SAMPLE_SIZE = 20;

function distinctCounts(
  rows: string[][],
  headers: string[],
  candidates: string[] | undefined
): Map<string, number> {
  const idx = columnIndex(headers, candidates);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = (idx !== -1 ? row[idx] ?? "" : "").trim();
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

export function analyzeCsv(text: string, providerOverride?: Provider): AnalyzeResult {
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) return { ok: false, error: "no_rows" };

  const detectedProvider = detectPreset(parsed.headers);
  const provider = providerOverride ?? detectedProvider;
  if (!provider) return { ok: false, error: "unknown_provider", headers: parsed.headers };
  const preset = PRESETS[provider];

  // Distinct foreign accounts + their default {source, kind} mapping.
  const accountCounts = distinctCounts(parsed.rows, parsed.headers, preset.columns.account);
  const accountMap: Record<string, AccountMapping> = {};
  const accounts: AccountSuggestion[] = [];
  for (const [foreignAccount, txnCount] of accountCounts) {
    // Key by the SAME display name normalizeRow falls back to (empty cell ->
    // "Imported account") so the preview map, the UI, and the commit-time lookup
    // all agree on the key.
    const name = foreignAccount || "Imported account";
    const suggested = suggestAccountMapping(name);
    accountMap[name] = suggested;
    accounts.push({ foreignAccount: name, txnCount, suggested });
  }

  // Distinct foreign categories + their default pare category.
  const categoryCounts = distinctCounts(parsed.rows, parsed.headers, preset.columns.category);
  const distinctCategories = [...categoryCounts.keys()];
  const { map: categoryMap, unknown } = defaultCategoryMap(distinctCategories);
  const unknownSet = new Set(unknown);
  const categories: CategorySuggestion[] = distinctCategories.map((foreignCategory) => ({
    foreignCategory,
    txnCount: categoryCounts.get(foreignCategory) ?? 0,
    suggested: categoryMap[foreignCategory],
    isUnknown: unknownSet.has(foreignCategory),
  }));

  const { rows, dropped, dateOrder } = normalizeAll(parsed.rows, parsed.headers, {
    preset,
    accountMap,
    categoryMap,
  });

  let min: string | null = null;
  let max: string | null = null;
  for (const r of rows) {
    if (min === null || r.txn_date < min) min = r.txn_date;
    if (max === null || r.txn_date > max) max = r.txn_date;
  }

  return {
    ok: true,
    preset,
    preview: {
      provider,
      detected: providerOverride === undefined && detectedProvider !== null,
      rowCount: parsed.rows.length,
      dropped,
      dateRange: { min, max },
      dateOrder,
      accounts: accounts.sort((a, b) => b.txnCount - a.txnCount),
      categories: categories.sort((a, b) => b.txnCount - a.txnCount),
      sample: rows.slice(0, SAMPLE_SIZE),
    },
  };
}
