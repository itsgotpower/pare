import { test as setup, expect } from "@playwright/test";
import path from "path";

// Runs once before the browser projects (see playwright.config.ts projects).
// Auth goes through the API, not the login form — the form has its own journey
// coverage; everything else should start signed in without paying the UI cost.
// The saved storageState carries the pare_session cookie (HMAC, verified by the
// Edge middleware against the same PARE_AUTH_SECRET the config injects).

const STATE = path.join(__dirname, ".tmp", "auth.json");
export const E2E_PASSWORD = "pare-e2e-password";

setup("create the profile and capture a session", async ({ request }) => {
  const res = await request.post("/api/auth", {
    data: { action: "setup", display_name: "E2E Tester", password: E2E_PASSWORD },
  });
  if (res.status() === 409) {
    // Already configured (fresh runs never hit this — the scratch dir is wiped
    // at server boot — but a mid-run re-invocation can). Sign in instead.
    const login = await request.post("/api/auth", {
      data: { action: "login", password: E2E_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
  } else {
    expect(res.ok()).toBeTruthy();
  }
  await request.storageState({ path: STATE });
});
