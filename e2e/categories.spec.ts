import { test, expect } from "@playwright/test";
import { seedCardData } from "./helpers";

// Category journey: an unmatched merchant starts uncategorized, a user rule
// recategorizes it. GREEN LEAF MARKET is crafted to match NO starter rule
// (see fixtures/card-statement.qfx).
//
// NOTE: rules deliberately survive the between-test wipe (DELETE /api/data
// keeps rules/goals) AND are persisted to <server cwd>/data/user-rules.json —
// which is e2e/.tmp/cwd, NOT the repo's real data/ (see playwright.config.ts).
// The add-rule endpoint upserts on keyword, so re-running this spec is safe.

test.beforeEach(async ({ request }) => {
  await seedCardData(request);
});

test("adding a rule recategorizes an unmatched merchant", async ({ page }) => {
  // Starts as the card fallback category.
  await page.goto("/transactions");
  await page.getByPlaceholder("Search descriptions...").fill("GREEN LEAF");
  const row = page.getByRole("row", { name: /GREEN LEAF MARKET/ }).first();
  await expect(row).toBeVisible();

  // Add the rule (ADD RULE opens the dialog; the submit is ADD RULE &
  // RECATEGORIZE — use exact names so the two don't collide).
  await page.goto("/categories");
  await page.getByRole("button", { name: "ADD RULE", exact: true }).click();
  await page.getByPlaceholder("e.g. STARBUCKS").fill("GREEN LEAF");
  await page.getByPlaceholder("e.g. Coffee").fill("Groceries");
  await page
    .getByRole("button", { name: "ADD RULE & RECATEGORIZE", exact: true })
    .click();

  // recategorizeAll runs server-side before the response; the rule appears in
  // the grouped list once the dialog closes.
  await expect(page.getByText("GREEN LEAF").first()).toBeVisible();

  // The merchant now carries the rule's category.
  await page.goto("/transactions");
  await page.getByPlaceholder("Search descriptions...").fill("GREEN LEAF");
  await expect(
    page.getByRole("row", { name: /GREEN LEAF MARKET/ }).first()
  ).toContainText("Groceries");
});

test("recategorize-all is idempotent and keeps rule-derived categories", async ({
  page,
}) => {
  await page.goto("/categories");
  await page
    .getByRole("button", { name: "RECATEGORIZE ALL", exact: true })
    .click();

  await page.goto("/transactions");
  await page.getByPlaceholder("Search descriptions...").fill("LOBLAWS");
  await expect(
    page.getByRole("row", { name: /LOBLAWS/ }).first()
  ).toContainText("Groceries");
});
