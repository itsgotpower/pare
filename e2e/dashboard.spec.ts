import { test, expect } from "@playwright/test";
import { seedCardData, wipeData } from "./helpers";

// Trends journey (dashboard OVERVIEW / BY CATEGORY). Assertions target text —
// totals, headings, merchant names — not Recharts SVG geometry: chart internals
// are library-owned and flaky to pin down. The dashboard anchors to the LATEST
// DATA MONTH, not the calendar month, so the frozen fixture always has data.
// Deliberately NOT asserted here: SAFE TO SPEND / forecast surfaces — those are
// today-relative by design and would rot against frozen fixtures.

test("overview shows totals, top merchants, and the category view", async ({
  page,
  request,
}) => {
  await seedCardData(request);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "DASHBOARD" })).toBeVisible();

  // Card spend only (the $500 payment credit is excluded from every chart).
  await expect(page.getByText("TOTAL SPEND").first()).toBeVisible();
  await expect(page.getByText("TOP MERCHANTS").first()).toBeVisible();
  // merchantDisplay strips the "#1234" store-number tail.
  await expect(page.getByText("LOBLAWS").first()).toBeVisible();

  await page.getByRole("tab", { name: "BY CATEGORY" }).click();
  await expect(page.getByText(/Subscriptions/).first()).toBeVisible();
});

test("a wiped database shows the empty state, not a broken dashboard", async ({
  page,
  request,
}) => {
  await wipeData(request);
  await page.goto("/dashboard");
  await expect(
    page.getByText("NO DATA YET — GO TO UPLOAD TO IMPORT STATEMENTS")
  ).toBeVisible();
});
