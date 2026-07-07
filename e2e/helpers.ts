import { expect, type APIRequestContext } from "@playwright/test";
import fs from "fs";
import path from "path";

export const FIXTURES = path.join(__dirname, "fixtures");

// Reset transaction data between tests. Same contract as the profile DANGER
// ZONE: wipes transactions/statements/overrides, KEEPS rules, goals, and the
// profile — so a rule added by one spec is still present in later specs; write
// assertions accordingly (assert your own fixtures, not global counts).
export async function wipeData(request: APIRequestContext) {
  const res = await request.delete("/api/data", { data: { confirm: "WIPE" } });
  expect(res.ok(), "DELETE /api/data should succeed").toBeTruthy();
}

// Seed by POSTing an OFX fixture through the real upload route — the fast path
// for specs that aren't themselves exercising the upload UI. Insertion runs
// recategorizeAll() synchronously, so data is fully categorized on return.
export async function uploadFixture(request: APIRequestContext, name: string) {
  const res = await request.post("/api/upload", {
    multipart: {
      file: {
        name,
        mimeType: "application/x-ofx",
        buffer: fs.readFileSync(path.join(FIXTURES, name)),
      },
    },
  });
  expect(res.ok(), `upload of ${name} should succeed`).toBeTruthy();
  return (await res.json()) as {
    inserted: number;
    skipped: number;
    total: number;
    filename: string;
  };
}

// The standard seed: wipe, then load the card fixture (the spend-charts
// universe — dashboards, subscriptions, and categories all read card spend).
export async function seedCardData(request: APIRequestContext) {
  await wipeData(request);
  return uploadFixture(request, "card-statement.qfx");
}
