import { test, expect } from "@playwright/test";
import { seedCardData } from "./helpers";

// Subscription detection: needs 3+ distinct months of charges on the card/cash
// spend universe, either amount-stable at a plausible cadence or a
// KNOWN_RECURRING merchant. The fixture gives NETFLIX.COM and SPOTIFY four
// stable monthly charges each; GREEN LEAF MARKET has only two months and must
// NOT be detected. All of this is anchored to data dates (never `new Date()`),
// so the frozen fixture stays deterministic forever.

test.beforeEach(async ({ request }) => {
  await seedCardData(request);
});

test("stable monthly merchants are detected with cadence and cost", async ({
  page,
}) => {
  await page.goto("/recurring");

  const netflix = page.getByRole("row", { name: /NETFLIX/ }).first();
  await expect(netflix).toBeVisible();
  await expect(netflix).toContainText(/monthly/i);
  await expect(netflix).toContainText("15.49"); // typical charge

  await expect(page.getByRole("row", { name: /SPOTIFY/ }).first()).toBeVisible();

  // Two months of charges is below the 3-month floor — not a subscription.
  await expect(page.getByRole("row", { name: /GREEN LEAF/ })).toHaveCount(0);
});
