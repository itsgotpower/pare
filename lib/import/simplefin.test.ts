// Tests for the SimpleFIN client + adapter (pure module — synthetic fixtures
// only, shaped after the live demo bridge response; no network, no real data).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSetupToken,
  redactAccessUrl,
  splitAccessUrl,
  claimAccessUrl,
  fetchSimplefinAccounts,
  toOfxImport,
  guessKind,
  simplefinSource,
  type SimplefinAccountSet,
} from "./simplefin";

const ACCESS_URL = "https://user123:s3cret@bridge.example.com/simplefin";

// Unix seconds for a fixed, DST-proof instant (2026-03-05 12:00:00 UTC).
const T = Math.floor(Date.parse("2026-03-05T12:00:00Z") / 1000);
const DAY = 86400;

function demoSet(): SimplefinAccountSet {
  return {
    errors: [],
    accounts: [
      {
        id: "ACT-chq-001",
        name: "Everyday Chequing",
        currency: "CAD",
        balance: "2451.19",
        "balance-date": T,
        org: { name: "Demo Bank" },
        transactions: [
          { id: "t1", posted: T - 2 * DAY, amount: "-45.58", description: "Grocery store" },
          { id: "t2", posted: T - DAY, amount: "1200.00", description: "ACME PAYROLL DEP" },
          { id: "t3", posted: T, amount: "-800.00", description: "E-TRANSFER TO LANDLORD" },
          { id: "t4", posted: T, amount: "-16.95", description: "MONTHLY FEE" },
          { id: "t5", posted: 0, amount: "-99.99", description: "PENDING THING", pending: true },
          { id: "t6", posted: T, amount: "0.00", description: "ZERO NOISE" },
        ],
      },
      {
        id: "ACT-card-002",
        name: "Cashback Card",
        currency: "CAD",
        balance: "-512.30",
        "balance-date": T,
        transactions: [
          { id: "c1", posted: T - DAY, amount: "-35.50", description: "Fishing bait" },
          { id: "c2", posted: T, amount: "500.00", description: "PAYMENT - THANK YOU" },
          { id: "c3", posted: T, amount: "12.99", description: "REFUND SHOES" },
        ],
      },
    ],
  };
}

const CONFIG = {
  "ACT-chq-001": { kind: "chequing" as const, enabled: true },
  "ACT-card-002": { kind: "card" as const, enabled: true },
};

// --- token / URL handling ---------------------------------------------------

test("decodeSetupToken round-trips a claim URL and tolerates whitespace", () => {
  const claim = "https://bridge.example.com/simplefin/claim/ABC123";
  const token = Buffer.from(claim).toString("base64");
  assert.equal(decodeSetupToken(token), claim);
  const wrapped = token.slice(0, 20) + "\n  " + token.slice(20);
  assert.equal(decodeSetupToken(wrapped), claim);
});

test("decodeSetupToken rejects non-https decodes", () => {
  const token = Buffer.from("http://insecure.example.com/claim/x").toString("base64");
  assert.throws(() => decodeSetupToken(token), /https/);
});

test("splitAccessUrl extracts Basic Auth and strips credentials", () => {
  const { base, authHeader } = splitAccessUrl(ACCESS_URL);
  assert.equal(base, "https://bridge.example.com/simplefin");
  assert.equal(
    authHeader,
    `Basic ${Buffer.from("user123:s3cret").toString("base64")}`
  );
});

test("redactAccessUrl never exposes credentials", () => {
  const redacted = redactAccessUrl(ACCESS_URL);
  assert.ok(!redacted.includes("s3cret"));
  assert.ok(!redacted.includes("user123"));
  assert.equal(redacted, "https://bridge.example.com/simplefin");
});

// --- claim flow ---------------------------------------------------------------

test("claimAccessUrl POSTs the decoded claim URL and validates the response", async () => {
  const claim = "https://bridge.example.com/simplefin/claim/ABC123";
  const token = Buffer.from(claim).toString("base64");
  const calls: { url: string; method?: string }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return new Response(ACCESS_URL + "\n", { status: 200 });
  }) as typeof fetch;

  const accessUrl = await claimAccessUrl(token, fetchImpl);
  assert.equal(accessUrl, ACCESS_URL);
  assert.deepEqual(calls, [{ url: claim, method: "POST" }]);
});

test("claimAccessUrl surfaces an already-claimed token as a clear error", async () => {
  const token = Buffer.from("https://bridge.example.com/claim/x").toString("base64");
  const fetchImpl = (async () => new Response("", { status: 403 })) as typeof fetch;
  await assert.rejects(() => claimAccessUrl(token, fetchImpl), /already claimed/);
});

// --- /accounts fetch ----------------------------------------------------------

test("fetchSimplefinAccounts sends Basic Auth + epoch window params", async () => {
  let seenUrl = "";
  let seenAuth: string | null = null;
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(url);
    seenAuth = new Headers(init?.headers).get("Authorization");
    return Response.json({ errors: [], accounts: [] });
  }) as typeof fetch;

  const start = new Date((T - 90 * DAY) * 1000);
  const end = new Date(T * 1000);
  await fetchSimplefinAccounts(ACCESS_URL, { startDate: start, endDate: end }, fetchImpl);

  const u = new URL(seenUrl);
  assert.equal(u.pathname, "/simplefin/accounts");
  assert.equal(u.searchParams.get("start-date"), String(T - 90 * DAY));
  assert.equal(u.searchParams.get("end-date"), String(T));
  assert.ok(!seenUrl.includes("s3cret"));
  assert.equal(seenAuth, `Basic ${Buffer.from("user123:s3cret").toString("base64")}`);
});

test("fetchSimplefinAccounts normalizes v1 errors and v2 errlist", async () => {
  const fetchImpl = (async () =>
    Response.json({
      errors: ["Connection to Demo Bank may need attention"],
      errlist: [{ code: "con.auth", msg: "reauth required" }],
      accounts: [],
    })) as typeof fetch;
  const set = await fetchSimplefinAccounts(ACCESS_URL, {}, fetchImpl);
  assert.deepEqual(set.errors, [
    "Connection to Demo Bank may need attention",
    "con.auth: reauth required",
  ]);
});

test("fetchSimplefinAccounts flags a revoked access URL", async () => {
  const fetchImpl = (async () => new Response("", { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => fetchSimplefinAccounts(ACCESS_URL, {}, fetchImpl),
    /disconnect and claim a new token/
  );
});

// --- adapter -------------------------------------------------------------------

test("toOfxImport maps deposit-account flows from sign + description", () => {
  const { imp } = toOfxImport(demoSet(), CONFIG);
  const chq = imp.accounts.find((a) => a.account_kind === "chequing")!;

  const byId = Object.fromEntries(chq.transactions.map((t) => [t.description, t]));
  assert.equal(byId["Grocery store"].flow, "spend");
  assert.equal(byId["ACME PAYROLL DEP"].flow, "income");
  assert.equal(byId["E-TRANSFER TO LANDLORD"].flow, "transfer");
  assert.equal(byId["MONTHLY FEE"].flow, "fee_interest");
  // Amounts stored as positive magnitudes; flow carries direction.
  for (const t of chq.transactions) assert.ok(t.amount > 0);
});

test("toOfxImport maps card flows: charges spend, credits payment", () => {
  const { imp } = toOfxImport(demoSet(), CONFIG);
  const card = imp.accounts.find((a) => a.account_kind === "card")!;
  const flows = card.transactions.map((t) => [t.description, t.flow]);
  assert.deepEqual(flows, [
    ["Fishing bait", "spend"],
    ["PAYMENT - THANK YOU", "payment"],
    ["REFUND SHOES", "payment"],
  ]);
  assert.equal(
    card.transactions.find((t) => t.description === "Fishing bait")!.category,
    "Other / uncategorized"
  );
});

test("toOfxImport skips pending and zero-amount rows", () => {
  const { imp } = toOfxImport(demoSet(), CONFIG);
  const chq = imp.accounts.find((a) => a.account_kind === "chequing")!;
  const descs = chq.transactions.map((t) => t.description);
  assert.ok(!descs.includes("PENDING THING"));
  assert.ok(!descs.includes("ZERO NOISE"));
});

test("toOfxImport anchors deposit balances but leaves card balances NULL", () => {
  const { imp } = toOfxImport(demoSet(), CONFIG);
  const chq = imp.accounts.find((a) => a.account_kind === "chequing")!;
  const card = imp.accounts.find((a) => a.account_kind === "card")!;
  assert.equal(chq.closing_balance, 2451.19);
  assert.equal(chq.closing_date, "2026-03-05");
  assert.equal(card.closing_balance, null);
  assert.equal(card.closing_date, null);
});

test("toOfxImport converts posted epochs to UTC dates and builds the period", () => {
  const { imp } = toOfxImport(demoSet(), CONFIG);
  const chq = imp.accounts.find((a) => a.account_kind === "chequing")!;
  assert.equal(chq.period, "2026-03-03 to 2026-03-05");
});

test("toOfxImport drops disabled/unknown accounts and reports them", () => {
  const { imp, skippedAccounts } = toOfxImport(demoSet(), {
    "ACT-chq-001": { kind: "chequing", enabled: false },
    // card id absent entirely
  });
  assert.equal(imp.accounts.length, 0);
  assert.deepEqual(skippedAccounts.sort(), ["Cashback Card", "Everyday Chequing"]);
});

test("toOfxImport leaves fitId blank — bridge txn ids are NOT trusted for dedup", () => {
  // The live demo bridge regenerates ids per request; an id-keyed dedup under
  // unstable ids doubles the whole history every sync. Blank fitId routes
  // insertOfxImport to the content-positional key, which fails safe.
  const { imp } = toOfxImport(demoSet(), CONFIG);
  for (const acct of imp.accounts) {
    assert.ok(acct.transactions.every((t) => t.fitId === ""));
  }
});

// --- helpers -------------------------------------------------------------------

test("simplefinSource is stable, sanitized, and kind-free", () => {
  assert.equal(simplefinSource("ACT-chq-001"), "simplefin_ctchq001");
  assert.equal(simplefinSource("Demo Savings"), "simplefin_osavings");
  // Same account id always yields the same source — reclassifying the kind
  // must never change it (dedup keys are namespaced by source).
  assert.equal(simplefinSource("ACT-chq-001"), simplefinSource("ACT-chq-001"));
});

test("guessKind classifies common Canadian account names", () => {
  assert.equal(guessKind("TD Cash Back Visa"), "card");
  assert.equal(guessKind("High Interest Savings"), "savings");
  assert.equal(guessKind("Compte Épargne"), "savings");
  assert.equal(guessKind("TFSA Investment"), "investment");
  assert.equal(guessKind("Everyday Chequing"), "chequing");
});
