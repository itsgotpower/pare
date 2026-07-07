// ---------------------------------------------------------------------------
// SimpleFIN Bridge client + adapter — pure, no DB access.
//
// SimpleFIN (https://www.simplefin.org/protocol.html) is the opt-in "bring your
// own aggregator" path: the USER creates a SimpleFIN Bridge account, connects
// their banks THERE (credentials live at the bridge, never here), pays the
// bridge directly, and pastes a one-time setup token into Pare. Pare claims the
// token once for a permanent access URL, then pulls JSON transactions on demand.
//
// The adapter maps the SimpleFIN response onto the OFX import shape
// (lib/import/ofx.ts), so ingestion reuses insertOfxImport() unchanged: one
// statement row per account (UPSERT by filename → the balance anchor refreshes
// every sync), CONTENT-keyed dedup (see the fitId note in toOfxImport — bridge
// txn ids are not trusted), and one recategorizeAll() pass.
//
// Wire-shape notes (verified against the live demo bridge, 2026-07-06):
//   - errors arrive as protocol-v1 `errors: string[]` on the live bridge, but
//     v2 documents structured `errlist: [{code, msg}]` — both are tolerated.
//   - amounts are SIGNED DECIMAL STRINGS ("-35.50"); positive = deposit.
//   - `posted` is a unix timestamp (seconds, UTC); 0 / pending:true = not yet
//     posted — those rows are SKIPPED (amount/description can still change,
//     which would strand the dedup row when the final version posts).
//   - accounts carry no TYPE field, so the account kind (card/chequing/…) is
//     the user's one-time classification at connect (lib/db/simplefin-config).
//
// The source string is `simplefin_<slug>` — deliberately WITHOUT the kind
// suffix: the dedup key is namespaced by source, so the source must stay
// stable even if the user reclassifies an account. account_kind rides on every
// row explicitly (the OFX insert path already does this; sourceToKind() is
// only the PDF path's fallback).
//
// SECURITY: the access URL embeds Basic Auth credentials. It must NEVER be
// logged or echoed into an error message — redactAccessUrl() exists for that.
// ---------------------------------------------------------------------------

import type { AccountKind } from "../db/account-kinds";
import type { OfxAccount, OfxImport, OfxTransaction } from "./ofx";

// --- Wire types (subset we consume) ----------------------------------------

export interface SimplefinTransaction {
  id: string; // bridge-assigned, stable & unique per account
  posted: number; // unix seconds UTC; 0 = pending
  amount: string; // signed decimal string, positive = deposit
  description: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
  transacted_at?: number;
}

export interface SimplefinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string; // signed decimal string, as of balance-date
  "balance-date": number; // unix seconds UTC
  transactions: SimplefinTransaction[];
  org?: { name?: string; domain?: string; id?: string };
}

export interface SimplefinAccountSet {
  accounts: SimplefinAccount[];
  // Protocol requires surfacing these to the user (it's how "reconnect your
  // bank at the bridge" MFA states are communicated). v1 strings + v2 objects.
  errors: string[];
}

// --- Access-URL handling ----------------------------------------------------

// The setup token is base64 of the claim URL. Whitespace-tolerant (users paste
// from a copy button, but also from PDFs/emails that wrap lines).
export function decodeSetupToken(token: string): string {
  const cleaned = token.replace(/\s+/g, "");
  let url: string;
  try {
    url = Buffer.from(cleaned, "base64").toString("utf-8").trim();
  } catch {
    throw new Error("Setup token is not valid base64.");
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error("Setup token did not decode to an https claim URL.");
  }
  return url;
}

// For error messages / status output: keep the host, drop the credentials.
export function redactAccessUrl(accessUrl: string): string {
  try {
    const u = new URL(accessUrl);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(unparseable access URL)";
  }
}

// Split the Basic Auth credentials out of the access URL. fetch() does not
// accept credentials embedded in the URL, so callers need the pieces.
export function splitAccessUrl(accessUrl: string): {
  base: string;
  authHeader: string;
} {
  const u = new URL(accessUrl);
  if (u.protocol !== "https:") throw new Error("Access URL must be https.");
  if (!u.username) throw new Error("Access URL is missing credentials.");
  const auth = Buffer.from(
    `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
  ).toString("base64");
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/$/, "");
  return { base, authHeader: `Basic ${auth}` };
}

type FetchLike = typeof fetch;

// Claim a setup token: one POST to the decoded claim URL; the body of the 200
// response is the permanent access URL. A 403 means the token was already
// claimed (or revoked) — the user must generate a new one at the bridge.
export async function claimAccessUrl(
  setupToken: string,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await fetchImpl(claimUrl, {
    method: "POST",
    headers: { "Content-Length": "0" },
  });
  if (res.status === 403) {
    throw new Error(
      "Token already claimed or revoked — generate a new setup token at the bridge."
    );
  }
  if (!res.ok) {
    throw new Error(`Claim failed (HTTP ${res.status}).`);
  }
  const accessUrl = (await res.text()).trim();
  splitAccessUrl(accessUrl); // validate shape before we ever store it
  return accessUrl;
}

// Normalize v1 (`errors: string[]`) and v2 (`errlist: [{code,msg}]`) error
// reporting into plain strings.
function collectErrors(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(data.errors)) {
    for (const e of data.errors) if (typeof e === "string" && e) out.push(e);
  }
  if (Array.isArray(data.errlist)) {
    for (const e of data.errlist) {
      if (e && typeof e === "object") {
        const { code, msg } = e as { code?: string; msg?: string };
        out.push([code, msg].filter(Boolean).join(": ") || "unknown error");
      }
    }
  }
  return out;
}

// GET {accessUrl}/accounts for a date window. Dates are inclusive unix-second
// bounds; the bridge caps windows at ~90 days, so callers loop for backfill.
export async function fetchSimplefinAccounts(
  accessUrl: string,
  window: { startDate?: Date; endDate?: Date } = {},
  fetchImpl: FetchLike = fetch
): Promise<SimplefinAccountSet> {
  const { base, authHeader } = splitAccessUrl(accessUrl);
  const params = new URLSearchParams();
  if (window.startDate)
    params.set("start-date", String(Math.floor(window.startDate.getTime() / 1000)));
  if (window.endDate)
    params.set("end-date", String(Math.floor(window.endDate.getTime() / 1000)));
  const qs = params.toString();

  const res = await fetchImpl(`${base}/accounts${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: authHeader },
  });
  if (res.status === 403) {
    throw new Error(
      "Bridge rejected the stored access URL (403) — disconnect and claim a new token."
    );
  }
  if (!res.ok) {
    throw new Error(`Bridge request failed (HTTP ${res.status}).`);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error("Bridge returned non-JSON — try again later.");
  }

  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).filter(
    (a): a is SimplefinAccount =>
      !!a && typeof a === "object" && typeof (a as SimplefinAccount).id === "string"
  );
  return { accounts, errors: collectErrors(data) };
}

// --- Adapter to the OFX import shape ----------------------------------------

// Stable per-account source slug: sanitized account id, last 8 chars — long
// enough to distinguish real bridge ids (UUIDs / account names) while keeping
// source strings and statement filenames readable.
export function simplefinSource(accountId: string): string {
  const cleaned = accountId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `simplefin_${cleaned.slice(-8) || "acct"}`;
}

// Guess a kind from the account name for the connect flow's defaults. The user
// confirms/edits before the first sync — this just makes the common case
// zero-touch. Falls back to chequing (a deposit account is the safer default:
// its rows land in the outflow universe, not the spend charts).
export function guessKind(name: string): AccountKind {
  const n = name.toUpperCase();
  if (/VISA|MASTERCARD|CREDIT|AMEX|CARD|AEROPLAN|CASHBACK|INFINITE/.test(n)) return "card";
  if (/SAV|ÉPARGNE|EPARGNE/.test(n)) return "savings";
  if (/INVEST|TFSA|RRSP|RSP|FHSA|BROKER/.test(n)) return "investment";
  return "chequing";
}

function epochToDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

// Flow taxonomy, mirroring the OFX classifier minus TRNTYPE (SimpleFIN has no
// type field — direction comes from the amount sign, payment/transfer intent
// from the description).
function classify(
  kind: AccountKind,
  amount: number,
  description: string
): { flow: OfxTransaction["flow"]; category: string } {
  const d = description.toUpperCase();

  if (kind === "card") {
    return amount > 0
      ? { flow: "payment", category: "Banking" } // payment/refund TO the card
      : { flow: "spend", category: "Other / uncategorized" };
  }

  // Deposit accounts (chequing / savings / investment).
  if (amount > 0) {
    if (/TRANSFER|TFR|E-TRANSFER|ETRANSFER/.test(d))
      return { flow: "transfer", category: "Banking" };
    return { flow: "income", category: "Banking" };
  }
  if (/\bFEE\b|SERVICE CHARGE|INTEREST CHARGE|OVERDRAFT/.test(d))
    return { flow: "fee_interest", category: "Banking" };
  if (/TRANSFER|TFR|E-TRANSFER|ETRANSFER|PAYMENT TO/.test(d))
    return { flow: "transfer", category: "Banking" };
  return { flow: "spend", category: "Banking" };
}

export interface SimplefinAccountConfig {
  kind: AccountKind;
  enabled: boolean;
  name?: string; // user-visible label; defaults to the bridge's account name
}

// Map a SimpleFIN response onto the OFX import shape. Only accounts present in
// `config` AND enabled are converted — everything else is reported in
// `skippedAccounts` so the sync status can say why an account didn't land.
export function toOfxImport(
  set: SimplefinAccountSet,
  config: Record<string, SimplefinAccountConfig>
): { imp: OfxImport; skippedAccounts: string[] } {
  const accounts: OfxAccount[] = [];
  const skippedAccounts: string[] = [];

  for (const acct of set.accounts) {
    const cfg = config[acct.id];
    if (!cfg || !cfg.enabled) {
      skippedAccounts.push(acct.name || acct.id);
      continue;
    }

    const kind = cfg.kind;
    const transactions: OfxTransaction[] = [];
    for (const t of acct.transactions ?? []) {
      if (t.pending || !t.posted) continue; // pending rows can still mutate
      const amount = parseFloat(t.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const description = (t.description || t.payee || t.memo || "").trim();
      const { flow, category } = classify(kind, amount, description);
      transactions.push({
        // fitId DELIBERATELY blank → insertOfxImport falls back to the
        // content-positional dedup key (source|date|desc|amount|seq). The
        // protocol says bridge txn ids are stable, but the live demo bridge
        // regenerates them per REQUEST (verified 2026-07-06: same rows, ids
        // shifted between two fetches seconds apart) — and an id-keyed dedup
        // under unstable ids silently DOUBLES the whole history every sync,
        // the exact CSV-import disaster class. Content keys fail the safe way
        // (skip, never duplicate); fetchWindows() floors windows to UTC
        // midnight so a boundary can't slice a same-day content group and
        // break the seq numbering.
        fitId: "",
        txn_date: epochToDate(t.posted),
        description: description || "SIMPLEFIN TRANSACTION",
        amount: Math.abs(amount),
        flow,
        category,
      });
    }

    // Balance → net-worth anchor for deposit accounts only. Card balance sign
    // conventions vary by institution behind the bridge, and net worth signs
    // card balances itself from as-printed-positive — same rationale as the
    // OFX path leaving card BALAMT alone.
    const isDeposit = kind === "chequing" || kind === "savings" || kind === "investment";
    const balance = parseFloat(acct.balance);
    const closing_balance =
      isDeposit && Number.isFinite(balance) ? balance : null;
    const closing_date =
      closing_balance !== null && acct["balance-date"]
        ? epochToDate(acct["balance-date"])
        : null;

    if (!transactions.length && closing_balance === null) continue;

    const dates = transactions.map((t) => t.txn_date).sort();
    accounts.push({
      source: simplefinSource(acct.id),
      account: cfg.name || acct.name || acct.id,
      account_kind: kind,
      period: dates.length
        ? `${dates[0]} to ${dates[dates.length - 1]}`
        : "simplefin sync",
      closing_balance,
      closing_date,
      transactions,
    });
  }

  return { imp: { accounts }, skippedAccounts };
}
