import { getDb } from "../db";
import {
  loadUserRules,
  loadSeedRules,
  saveUserRule,
  saveUserRules,
  removeUserRule,
  type UserRule,
} from "./user-rules";
import { isDepositKind, DEPOSIT_KINDS_SQL } from "./account-kinds";
import { deriveKeyword } from "./derive-keyword";

export interface CategoryRule {
  id: number;
  category: string;
  keyword: string;
  sort_order: number;
  created_at: string;
}

// Generic starter taxonomy shipped in source — universal merchants/patterns only,
// so tracked code reveals nothing personal. The user's real, tuned keyword list
// lives in the gitignored data/seed-rules.json (loadSeedRules) and is used as the
// seed source when present. Category NAMES here are the canonical set used
// everywhere (colours, fixed-cost detection, chequing-transfer gating).
const STARTER_RULES: [string, string[]][] = [
  ["Cash advance / fees", ["CASH ADVANCE", "CASH ADV/BT", "CONV CHQ FEE", "BALANCE TRANSFER", "NSF", "OVERDRAFT", "INTEREST CHARGE"]],
  ["Groceries", ["SAFEWAY", "WHOLE FOODS", "REAL CDN", "SUPERSTORE", "COSTCO", "LOBLAW", "SOBEYS", "METRO ", "NO FRILLS", "SAVE-ON-FOODS", "IGA "]],
  ["Coffee", ["STARBUCKS", "TIM HORTON", "SECOND CUP", "BLENZ", "ESPRESSO", "COFFEE", "CAFE", "BAKEHOUSE"]],
  ["Restaurants & takeout", ["MCDONALD", "SUBWAY", "PIZZA", "CHIPOTLE", "UBER EATS", "DOORDASH", "SKIPTHEDISHES", "A&W", "WENDY", "BURGER", "RAMEN", "SUSHI", "PHO ", "TACO", "DONAIR", "SHAWARMA", "RESTAURANT", "DINER", "TST-", "TST*"]],
  ["Subscriptions", ["NETFLIX", "SPOTIFY", "YOUTUBEPREMIUM", "GOOGLE ONE", "GOOGLE*GOOGLE", "AMAZONPRIME", "AMAZON.CA PRIME", "PRIME MEMBER", "APPLE.COM/BILL", "DISNEY", "AUDIBLE", "CLASSPASS", "STRAVA", "DASHPASS"]],
  ["Phone / utilities", ["ROGERS", "TELUS", "FIDO", "SHAW", "HYDRO", "FORTIS", "ENBRIDGE"]],
  ["Gym / fitness / recovery", ["GYM", "FITNESS", "YOGA", "YMCA", "GOODLIFE", "CLIMBING", "PILATES", "CROSSFIT"]],
  ["Running / cycling gear", ["SPORT CHEK", "ARCTERYX", "ADIDAS", "NIKE", "NEW BALANCE", "RUNNING ROOM", "DECATHLON"]],
  ["Transport / gas / parking", ["ESSO", "SHELL", "CHEVRON", "PETRO", "UBER TRIP", "LYFT", "PAYBYPHONE", "IMPARK", "EASYPARK", "PARKING", "COMPASS", "TRANSIT", "7-ELEVEN"]],
  ["Travel (air/hotel)", ["AIR CANADA", "AIRCANADA", "WESTJET", "DELTA AIR", "UNITED AIRLINES", "AIRLINES", "AIRBNB", "EXPEDIA", "HOTEL", "MARRIOTT", "AIRPORT"]],
  ["Health / pharmacy", ["SHOPPERS DRUG", "PHARMACY", "DENTAL", "CVS", "REXALL", "CLINIC", "MEDICAL", "OPTICAL"]],
  ["Shopping / retail", ["AMAZON.CA*", "AMZN MKTP", "WAL-MART", "WALMART", "WINNERS", "TARGET", "INDIGO", "APPLE STORE", "BEST BUY", "HOMESENSE", "TEMU", "LULULEMON"]],
  ["Gambling", ["CASINO", "LOTTERY", "POKER"]],
];

export function seedCategoryRules() {
  const db = getDb();
  const existing = db
    .prepare("SELECT COUNT(*) as count FROM category_rules")
    .get() as { count: number };

  if (existing.count > 0) return;

  const insert = db.prepare(
    "INSERT OR IGNORE INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?)"
  );
  // User rules win on keyword collision: a user who remapped a seed keyword to a
  // different category keeps that remapping across wipe + reseed.
  const upsert = db.prepare(
    "INSERT INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?) " +
      "ON CONFLICT(keyword) DO UPDATE SET category = excluded.category"
  );

  // Seed from the gitignored personal taxonomy if present, else the generic starter.
  const seed =
    loadSeedRules() ??
    STARTER_RULES.flatMap(([category, kws]) => kws.map((keyword) => ({ category, keyword })));

  let order = 0;
  const tx = db.transaction(() => {
    for (const r of seed) {
      insert.run(r.category, r.keyword, order++);
    }
    // Restore user-defined rules (persisted outside the DB so they survive wipes).
    for (const r of loadUserRules()) {
      upsert.run(r.category, r.keyword, order++);
    }
  });
  tx();
}

export function listRules(): CategoryRule[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM category_rules ORDER BY sort_order ASC")
    .all() as CategoryRule[];
}

export function addRule(category: string, keyword: string): void {
  const db = getDb();
  const maxOrder = (
    db.prepare("SELECT MAX(sort_order) as max FROM category_rules").get() as {
      max: number | null;
    }
  ).max;
  try {
    db.prepare(
      "INSERT INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?)"
    ).run(category, keyword, (maxOrder ?? 0) + 1);
  } catch (err) {
    // Surface the UNIQUE(keyword) violation as a readable message for the UI.
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new Error(`A rule for "${keyword}" already exists`);
    }
    throw err;
  }
  // Persist outside the DB so it survives a wipe + re-ingest.
  saveUserRule(category, keyword);
}

export interface ImportRulesResult {
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Bulk-import keyword→category rules (from another Pare instance's JSON export —
 * the self-host `data/seed-rules.json` taxonomy never ships in tracked source, so
 * a fresh hosted account only has the generic STARTER_RULES until the user brings
 * their own rules over). Upserts by keyword (last entry wins on a collision,
 * matching seedCategoryRules), persists to user-rules.json in one write so the
 * set survives a wipe, and leaves recategorization to the caller.
 *
 * Does NOT recategorize — the API runs recategorizeAll() afterwards so a large
 * import categorizes every existing row in a single pass.
 */
export function importRules(incoming: UserRule[]): ImportRulesResult {
  const db = getDb();

  // Normalize + dedupe within the payload (later wins), dropping blanks.
  // `skipped` counts only INVALID entries (blank category/keyword); collapsing a
  // duplicate keyword within the payload is a silent merge, not a skip.
  const byKeyword = new Map<string, UserRule>();
  let skipped = 0;
  for (const r of incoming) {
    const category = (r?.category ?? "").trim();
    const keyword = (r?.keyword ?? "").trim();
    if (!category || !keyword) {
      skipped++;
      continue;
    }
    byKeyword.set(keyword.toUpperCase(), { category, keyword });
  }
  const cleaned = [...byKeyword.values()];
  if (!cleaned.length) return { added: 0, updated: 0, skipped };

  const existing = new Set(
    (db.prepare("SELECT keyword FROM category_rules").all() as { keyword: string }[]).map(
      (r) => r.keyword.toUpperCase()
    )
  );
  const maxOrder =
    (db.prepare("SELECT MAX(sort_order) as max FROM category_rules").get() as {
      max: number | null;
    }).max ?? 0;

  // Upsert by keyword: new keyword inserts, existing keyword remaps its category.
  const upsert = db.prepare(
    "INSERT INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?) " +
      "ON CONFLICT(keyword) DO UPDATE SET category = excluded.category"
  );

  let added = 0;
  let updated = 0;
  let order = maxOrder;
  const tx = db.transaction(() => {
    for (const r of cleaned) {
      if (existing.has(r.keyword.toUpperCase())) updated++;
      else {
        added++;
        order++;
      }
      upsert.run(r.category, r.keyword, order);
    }
  });
  tx();

  // Persist to the gitignored user-rules file (one write) so a wipe restores them.
  saveUserRules(cleaned);

  return { added, updated, skipped };
}

export function deleteRule(id: number): void {
  const db = getDb();
  const row = db
    .prepare("SELECT keyword FROM category_rules WHERE id = ?")
    .get(id) as { keyword: string } | undefined;
  db.prepare("DELETE FROM category_rules WHERE id = ?").run(id);
  if (row) removeUserRule(row.keyword);
}

// Count of card-spend rows still in the catch-all category.
export function uncategorizedCount(): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM v_transactions
       WHERE effective_category = 'Other / uncategorized' AND flow = 'spend'`
    )
    .get() as { count: number };
  return row.count;
}

export interface RuleSuggestion {
  keyword: string;
  category: string;
  count: number;
}

/**
 * Record that the user rejected a suggested rule so it never resurfaces.
 * Keyed by (keyword, category); survives the /api/data wipe like rules/goals.
 */
export function dismissSuggestion(keyword: string, category: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO suggestion_dismissals (keyword, category) VALUES (?, ?)`
  ).run(keyword.toUpperCase(), category);
}

/**
 * Mine keyword→category rule suggestions from recorded manual overrides.
 *
 * Overrides are clustered PER MERCHANT via deriveKeyword() (contiguous merchant
 * prefix — processor junk, store numbers, and trailing city/province codes
 * stripped), then clusters whose derived keywords share a ≥4-char token prefix
 * are merged ("SPOTIFY P2ABC…" + "SPOTIFY P2DEF…" → "SPOTIFY"). A cluster with
 * ≥2 overrides becomes a suggestion. This replaces the old one-LCS-per-category
 * mining, which (a) surfaced trailing city tokens ("VANCOUVER") that would
 * re-tag hundreds of unrelated rows, and (b) went silent the moment a category
 * held overrides from two different merchants.
 *
 * Gates: user-rejected suggestions (suggestion_dismissals) and keywords already
 * covered by a rule are excluded; a collateral gate drops any keyword that
 * would raid rows already filed under several OTHER real categories. `count` is
 * how many rows the rule would actually re-tag (effective category ≠ target, so
 * rows already overridden to the target don't inflate it).
 */
export function ruleSuggestions(): RuleSuggestion[] {
  const db = getDb();
  const overrides = db
    .prepare(
      `SELECT co.new_category, t.description
       FROM category_overrides co
       JOIN transactions t ON t.id = co.transaction_id`
    )
    .all() as { new_category: string; description: string }[];

  if (overrides.length < 2) return [];

  const dismissed = new Set(
    (
      db.prepare(`SELECT keyword, category FROM suggestion_dismissals`).all() as {
        keyword: string;
        category: string;
      }[]
    ).map((d) => `${d.keyword} ${d.category}`)
  );
  const existingKeywords = new Set(
    (db.prepare(`SELECT keyword FROM category_rules`).all() as { keyword: string }[]).map((r) =>
      r.keyword.toUpperCase()
    )
  );

  // Cluster override descriptions by derived merchant keyword, per category.
  const byCategory = new Map<string, Map<string, number>>();
  for (const o of overrides) {
    const keyword = deriveKeyword(o.description);
    if (!keyword) continue;
    const clusters = byCategory.get(o.new_category) ?? new Map<string, number>();
    clusters.set(keyword, (clusters.get(keyword) ?? 0) + 1);
    byCategory.set(o.new_category, clusters);
  }

  const suggestions: RuleSuggestion[] = [];

  for (const [category, clusters] of byCategory) {
    // Merge clusters that share a token-prefix >=4 chars: sorting puts them
    // adjacent, and the merged cluster keys on the common prefix.
    const sorted = [...clusters.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const merged: { keyword: string; n: number }[] = [];
    for (const [keyword, n] of sorted) {
      const last = merged[merged.length - 1];
      const prefix = last ? commonTokenPrefix(last.keyword, keyword) : "";
      if (last && prefix.length >= 4) {
        last.keyword = prefix;
        last.n += n;
      } else {
        merged.push({ keyword, n });
      }
    }

    for (const { keyword, n } of merged) {
      if (n < 2) continue;
      if (dismissed.has(`${keyword} ${category}`)) continue;
      if (existingKeywords.has(keyword)) continue;

      // Collateral gate: rows the keyword matches that are already filed under
      // a DIFFERENT real category (not the target, not the fallbacks). A good
      // merchant keyword claims uncategorized rows; one that would re-tag rows
      // across several other categories is word noise.
      const collateral = db
        .prepare(
          `SELECT effective_category AS cat, COUNT(*) AS n FROM v_transactions
           WHERE UPPER(description) LIKE '%' || ? || '%'
             AND effective_category NOT IN (?, 'Other / uncategorized', 'Banking')
           GROUP BY effective_category`
        )
        .all(keyword, category) as { cat: string; n: number }[];
      const collateralRows = collateral.reduce((s, c) => s + c.n, 0);
      if (collateral.length >= 3 || collateralRows > 3 * n) continue;

      // Rows the rule would re-tag today. Zero is still worth suggesting — the
      // user may have overridden every current row, and the rule auto-tags the
      // same merchant on every future statement.
      const matchCount = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM v_transactions
             WHERE UPPER(description) LIKE '%' || ? || '%'
               AND effective_category != ?`
          )
          .get(keyword, category) as { count: number }
      ).count;

      suggestions.push({ keyword, category, count: matchCount });
    }
  }

  return suggestions.sort((a, b) => b.count - a.count);
}

// Longest run of LEADING whole tokens two keywords share ("SPOTIFY P2ABC123",
// "SPOTIFY P2DEF456" -> "SPOTIFY"). Whole tokens only - a character-level
// prefix would merge "SUBWAY" and "SUBARU" into the nonsense keyword "SUB".
function commonTokenPrefix(a: string, b: string): string {
  const ta = a.split(" ");
  const tb = b.split(" ");
  const out: string[] = [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    if (ta[i] !== tb[i]) break;
    out.push(ta[i]);
  }
  return out.join(" ");
}

export function addOverride(transactionId: number, originalCategory: string, newCategory: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    // Overrides and splits are mutually exclusive (both directions — the other
    // direction lives in setSplits, lib/db/splits.ts): picking one whole-row
    // category replaces any per-part split.
    db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").run(transactionId);
    db.prepare(
      `INSERT OR REPLACE INTO category_overrides (transaction_id, original_category, new_category)
       VALUES (?, ?, ?)`
    ).run(transactionId, originalCategory, newCategory);
  });
  tx();
}

/**
 * Bulk single-category assign: INSERT OR REPLACE an override per id, with the
 * stored base category recorded as original_category (same semantics as
 * addOverride — never trust the client for the before-value). Rows that don't
 * exist or that have SPLITS are skipped (a split is a finer-grained explicit
 * choice; clobbering it from a bulk action would be silent data loss — the
 * user removes the split first if that's what they want). One DB transaction.
 */
export const BULK_ASSIGN_MAX = 500;

export function bulkAssignCategory(
  ids: number[],
  category: string
): { updated: number; skipped: number } {
  const db = getDb();
  if (ids.length > BULK_ASSIGN_MAX) {
    throw new Error(`Too many transactions in one bulk update (max ${BULK_ASSIGN_MAX})`);
  }
  const getBase = db.prepare("SELECT category FROM transactions WHERE id = ?");
  const hasSplit = db.prepare(
    "SELECT 1 FROM transaction_splits WHERE transaction_id = ? LIMIT 1"
  );
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO category_overrides (transaction_id, original_category, new_category)
     VALUES (?, ?, ?)`
  );

  let updated = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = getBase.get(id) as { category: string } | undefined;
      if (!row || hasSplit.get(id)) {
        skipped++;
        continue;
      }
      upsert.run(id, row.category, category);
      updated++;
    }
  });
  tx();
  return { updated, skipped };
}

export function removeOverride(transactionId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM category_overrides WHERE transaction_id = ?").run(transactionId);
}

/**
 * Apply the current category_rules (first-match-wins by sort_order) to a single
 * description. Mirrors the Python categorize() so DB rows and parser agree.
 * cibc_chequing rows keep their 'Banking' category (they are not card spend).
 */
export function categorizeByRules(description: string, rules: CategoryRule[]): string {
  const d = description.toUpperCase();
  for (const rule of rules) {
    if (d.includes(rule.keyword.toUpperCase())) return rule.category;
  }
  return "Other / uncategorized";
}

// The built-in spend categories. Used to keep seeded card-merchant rules from
// tagging chequing TRANSFER rows (e.g. "TELUS Garden Banking Ctr" is a branch
// location, not a phone bill). Only user-defined categories — like Rent — may
// tag transfers.
const SEED_CATEGORY_NAMES = new Set(STARTER_RULES.map(([category]) => category));

/**
 * Apply one keyword→category mapping to every matching transaction (used when a
 * rule is added with apply_existing). Mirrors recategorizeAll's deposit gating:
 * on deposit accounts (chequing/savings/investment) income/payment/fee_interest
 * rows are never reclassified, and seeded card categories may not tag transfers
 * (location false matches). Returns the number of rows changed.
 */
export function recategorizeMatching(keyword: string, category: string): number {
  const db = getDb();
  const transferGate = SEED_CATEGORY_NAMES.has(category)
    ? `AND NOT (account_kind IN ${DEPOSIT_KINDS_SQL} AND flow = 'transfer')`
    : "";
  const result = db
    .prepare(
      `UPDATE transactions SET category = ?
       WHERE UPPER(description) LIKE '%' || UPPER(?) || '%'
         AND id NOT IN (SELECT transaction_id FROM category_overrides)
         AND id NOT IN (SELECT transaction_id FROM transaction_splits)
         AND import_id IS NULL
         AND NOT (account_kind IN ${DEPOSIT_KINDS_SQL} AND flow IN ('income', 'payment', 'fee_interest'))
         ${transferGate}`
    )
    .run(category, keyword);
  return result.changes;
}

/**
 * Re-run category rules against every transaction, skipping manual overrides.
 *
 * Imported rows (import_id IS NOT NULL) are skipped entirely — the user's
 * migrated categories are authoritative and must survive a later PDF upload.
 *
 * Card / cash rows: full re-categorization, falling back to
 * 'Other / uncategorized'.
 *
 * Deposit rows (chequing/savings/investment): rules are applied ONLY to
 * transfer/spend rows and ONLY when a rule matches (no 'Other' fallback) — so an
 * in-app rule on a private e-transfer handle can tag rent as 'Rent / housing'
 * while leaving everything else as 'Banking'. income/payment/fee_interest rows
 * are never touched, so payroll and card-payment classification can't be
 * clobbered. (Keyed off isDepositKind so a savings/investment source — new via
 * SimpleFIN/OFX — gets the same contract instead of the card catch-all.)
 *
 * Returns the number of transactions whose category changed.
 */
export function recategorizeAll(): number {
  const db = getDb();
  const rules = listRules();

  const overridden = new Set(
    db
      .prepare("SELECT transaction_id FROM category_overrides")
      .all()
      .map((r) => (r as { transaction_id: number }).transaction_id)
  );

  // Split transactions get the same treatment as overridden ones: the per-part
  // categories are an explicit user choice, so an upload's recategorize pass
  // must never touch the parent's base category out from under them.
  const split = new Set(
    db
      .prepare("SELECT DISTINCT transaction_id FROM transaction_splits")
      .all()
      .map((r) => (r as { transaction_id: number }).transaction_id)
  );

  const rows = db
    .prepare("SELECT id, description, category, account_kind, flow, import_id FROM transactions")
    .all() as {
    id: number;
    description: string;
    category: string;
    account_kind: string;
    flow: string;
    import_id: number | null;
  }[];

  const update = db.prepare("UPDATE transactions SET category = ? WHERE id = ?");
  let changed = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      if (overridden.has(row.id)) continue;
      if (split.has(row.id)) continue;
      // Imported categories are authoritative — never clobber a migrated row's
      // category on a later PDF upload's recategorize pass.
      if (row.import_id != null) continue;

      let next: string | null;
      if (isDepositKind(row.account_kind)) {
        const matched = categorizeByRules(row.description, rules);
        if (row.flow === "spend") {
          // Debit purchases: any rule applies; fall back to 'Banking'.
          next = matched === "Other / uncategorized" ? "Banking" : matched;
        } else if (row.flow === "transfer") {
          // Transfers: only user-defined categories (e.g. Rent) may tag them;
          // seeded card-merchant rules must not (avoids location false matches).
          next =
            matched !== "Other / uncategorized" && !SEED_CATEGORY_NAMES.has(matched)
              ? matched
              : "Banking";
        } else {
          continue; // income/payment/fee — never reclassify
        }
      } else {
        next = categorizeByRules(row.description, rules);
      }

      if (next && next !== row.category) {
        update.run(next, row.id);
        changed++;
      }
    }
  });
  tx();

  return changed;
}
