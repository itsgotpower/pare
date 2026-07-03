// Dumps the /demo page's payload from the seeded demo DB to
// public/demo-data.json. Run via `npm run gen:demo`, which seeds
// data/demo.db first (scripts/seed-demo.ts, deterministic mulberry32) and
// points PARE_DB_PATH here — lib/db.ts fixes its path at first import.
//
// Only month-anchored figures are dumped (totals, categories, merchants,
// goals, income-vs-spend). Today-relative surfaces (forecast, insights,
// safe-to-spend) are deliberately left out: the JSON is CHECKED IN, and a
// frozen "today" would rot. All content is synthetic — safe to commit.
import fs from "fs";
import path from "path";
import {
  getMonthlyTotals,
  getCategoryBreakdown,
  getTopMerchants,
} from "../lib/db/summary";
import { getCurrentProgress } from "../lib/db/goals";
import { getIncomeVsSpend, getIncomeByType } from "../lib/db/income";
import { seedCategoryRules } from "../lib/db/categories";

if (!process.env.PARE_DB_PATH) {
  console.error("Set PARE_DB_PATH to the seeded demo DB (npm run gen:demo does this).");
  process.exit(1);
}

seedCategoryRules();

const payload = {
  monthly_totals: getMonthlyTotals(),
  category_breakdown: getCategoryBreakdown(),
  top_merchants: getTopMerchants(8),
  goals: getCurrentProgress(),
  income_vs_spend: getIncomeVsSpend(),
  income_by_type: getIncomeByType(),
};

const out = path.join(process.cwd(), "public", "demo-data.json");
fs.writeFileSync(out, JSON.stringify(payload, null, 1) + "\n");
console.log(
  `Wrote ${out}: ${payload.monthly_totals.length} months, ${payload.category_breakdown.length} categories, ${payload.goals.length} goals`
);
