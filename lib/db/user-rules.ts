import fs from "fs";
import path from "path";

/**
 * User-defined category rules are persisted to a gitignored JSON file alongside
 * the DB so they survive a database wipe + re-ingest. The SQLite category_rules
 * table is rebuilt from SEED_RULES (built-ins) on a fresh DB; this file restores
 * the user's own rules on top.
 *
 * Privacy: this lives under data/ (gitignored), so private keywords like an
 * e-transfer recipient handle (used to tag rent) never enter tracked source.
 */
const FILE = path.join(process.cwd(), "data", "user-rules.json");

export interface UserRule {
  category: string;
  keyword: string;
}

export function loadUserRules(): UserRule[] {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserRule[]) : [];
  } catch {
    return [];
  }
}

// The full personal taxonomy, kept gitignored at data/seed-rules.json so real
// merchant keywords never enter tracked source. Used as the seed source when
// present; otherwise the generic STARTER_RULES in categories.ts is used.
const SEED_FILE = path.join(process.cwd(), "data", "seed-rules.json");

export function loadSeedRules(): UserRule[] | null {
  try {
    if (!fs.existsSync(SEED_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"));
    return Array.isArray(parsed) && parsed.length ? (parsed as UserRule[]) : null;
  } catch {
    return null;
  }
}

function writeUserRules(rules: UserRule[]): void {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(rules, null, 2));
}

export function saveUserRule(category: string, keyword: string): void {
  const rules = loadUserRules();
  // Dedupe by keyword (case-insensitive) — last write wins on category.
  const filtered = rules.filter(
    (r) => r.keyword.toUpperCase() !== keyword.toUpperCase()
  );
  filtered.push({ category, keyword });
  writeUserRules(filtered);
}

export function removeUserRule(keyword: string): void {
  const rules = loadUserRules();
  const filtered = rules.filter(
    (r) => r.keyword.toUpperCase() !== keyword.toUpperCase()
  );
  if (filtered.length !== rules.length) writeUserRules(filtered);
}
