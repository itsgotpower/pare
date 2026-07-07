import { test, expect } from "@playwright/test";
import path from "path";
import { FIXTURES, wipeData } from "./helpers";

// The upload journey is the ONE place we drive ingestion through the UI —
// every other spec seeds through the API (helpers.seedCardData) because the
// journey only needs testing once. OFX fixtures, not PDFs: the OFX path is
// pure TS (deterministic, no poppler dependency); PDF parsing has its own
// Python regression suite (npm test).

test.beforeEach(async ({ request }) => {
  await wipeData(request);
});

test("uploading an OFX statement parses it and lights up transactions", async ({
  page,
}) => {
  await page.goto("/upload");

  // The file input is visually hidden behind the BROWSE FILES label —
  // setInputFiles targets the input directly and doesn't need visibility.
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(FIXTURES, "card-statement.qfx"));

  // Upload fires on change; the RESULTS card renders when /api/upload responds.
  await expect(page.getByText("13 transactions parsed")).toBeVisible();
  await expect(page.getByText("13 inserted")).toBeVisible();

  // Both wire formats: OFX 1.x SGML chequing on top of the QFX card file.
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(FIXTURES, "chequing-statement.ofx"));
  await expect(page.getByText("5 transactions parsed")).toBeVisible();

  // The imported rows are queryable, categorized (recategorizeAll ran), and
  // carry the ofx_* source derived from the account block.
  await page.goto("/transactions");
  await page.getByPlaceholder("Search descriptions...").fill("NETFLIX");
  const row = page.getByRole("row", { name: /NETFLIX\.COM/ }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Subscriptions");
  await expect(row).toContainText("ofx_card_4444");
});

test("re-uploading the same file dedups on FITID instead of doubling data", async ({
  page,
}) => {
  await page.goto("/upload");
  const input = page.locator('input[type="file"]');

  await input.setInputFiles(path.join(FIXTURES, "card-statement.qfx"));
  await expect(page.getByText("13 inserted")).toBeVisible();

  await input.setInputFiles(path.join(FIXTURES, "card-statement.qfx"));
  // Second RESULTS card: nothing inserted, everything skipped as a duplicate.
  await expect(page.getByText("0 inserted")).toBeVisible();
  await expect(page.getByText("13 duplicates skipped")).toBeVisible();
});
