// ---------------------------------------------------------------------------
// Account deletion — the hard-delete orchestrator (hosted mode).
//
// Erases EVERYTHING tied to a userId, across all four stores:
//   1. R2  (PDF_BUCKET)  — every uploaded PDF under `u/<userId>/`.
//   2. KV  (PARSE_JOBS)  — every parse-job status record under `job/<userId>/`.
//   3. DO  (USER_DATA)   — the user's entire SQLite database (drop all tables).
//   4. D1  (DB)          — the better-auth identity rows (session/account/
//                          verification/user), so the account itself is gone.
//
// HARD delete, not soft: there is no "deleted" flag, no tombstone — the rows and
// objects are removed. This is both the compliance posture (minimise what we
// hold) and an App Store requirement (in-app account deletion must actually
// delete).
//
// IDEMPOTENT: every step tolerates already-gone resources (R2/KV purges no-op on
// empty prefixes, DROP ... IF EXISTS, DELETE matches zero rows), so a retry after
// a partial failure converges. Steps are independent and best-effort: one failing
// store does not abort the others; the per-step outcome + any errors are returned
// so the caller can surface a partial failure (and the operator can re-run).
//
// AUDITABLE: emits ONE structured, PII-FREE log line (event, timestamp, a HASHED
// userId — never the raw id or email — plus per-step counts). That lands in
// Cloudflare logs / Sentry breadcrumbs: durable and greppable, with nothing
// sensitive in it.
// ---------------------------------------------------------------------------

import { destroyUserData } from "@/lib/repo";
import { purgeUserPdfs, type R2BucketLike } from "@/lib/storage/pdf-store";
import { purgeUserJobs, type KvNamespaceLike } from "@/lib/queue/job-store";
import { getBinding } from "@/lib/cf-bindings";
import { getD1 } from "@/lib/auth/d1";

export interface AccountDeletionResult {
  /** True iff every step succeeded. */
  ok: boolean;
  /** First 16 hex chars of SHA-256(userId) — a stable, non-reversible audit key. */
  userIdHash: string;
  /** ISO timestamp of the deletion. */
  at: string;
  steps: {
    /** R2 objects deleted, or null if the bucket binding was unavailable. */
    pdfsDeleted: number | null;
    /** KV job records deleted, or null if the namespace binding was unavailable. */
    jobsDeleted: number | null;
    /** Whether the per-user Durable Object database was dropped. */
    doDestroyed: boolean;
    /** better-auth rows deleted across session/account/verification/user. */
    authRowsDeleted: number | null;
  };
  /** Per-step failures (empty when ok). Strings, never containing PII. */
  errors: string[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Non-reversible audit id: SHA-256 of the userId, truncated. WebCrypto is
// available on Workers and Node 20+. We never log the raw userId or the email.
async function hashUserId(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

// D1 rows have FK ON DELETE CASCADE from session/account -> user, but D1 does not
// enable FK enforcement by default, so we delete each table explicitly (and
// idempotently). verification rows are keyed by `identifier` (the email), so we
// look up the email first to clear them too.
async function deleteAuthRows(userId: string): Promise<number> {
  const db = await getD1();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const changes = (r: any): number => Number(r?.meta?.changes ?? r?.changes ?? 0);

  const userRow = (await db
    .prepare('SELECT "email" FROM "user" WHERE "id" = ?')
    .bind(userId)
    .first()) as { email?: string } | null;
  const email = typeof userRow?.email === "string" ? userRow.email : null;

  let count = 0;
  count += changes(await db.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(userId).run());
  count += changes(await db.prepare('DELETE FROM "account" WHERE "userId" = ?').bind(userId).run());
  if (email) {
    count += changes(
      await db.prepare('DELETE FROM "verification" WHERE "identifier" = ?').bind(email).run()
    );
  }
  count += changes(await db.prepare('DELETE FROM "user" WHERE "id" = ?').bind(userId).run());
  return count;
}

/**
 * Permanently delete a user's account and all their data. See the module header
 * for the contract (hard, idempotent, auditable). Resolves to a summary; never
 * rejects on a per-store failure (those land in `errors` + `ok: false`).
 */
export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  const at = new Date().toISOString();
  const userIdHash = await hashUserId(userId);
  const errors: string[] = [];
  const steps: AccountDeletionResult["steps"] = {
    pdfsDeleted: null,
    jobsDeleted: null,
    doDestroyed: false,
    authRowsDeleted: null,
  };

  // 1. R2 — uploaded PDFs (usually already empty: PDFs are deleted post-parse).
  try {
    const bucket = await getBinding<R2BucketLike>("PDF_BUCKET");
    if (bucket) steps.pdfsDeleted = await purgeUserPdfs(bucket, userId);
  } catch (e) {
    errors.push(`r2: ${errMsg(e)}`);
  }

  // 2. KV — parse-job status records.
  try {
    const kv = await getBinding<KvNamespaceLike>("PARSE_JOBS");
    if (kv) steps.jobsDeleted = await purgeUserJobs(kv, userId);
  } catch (e) {
    errors.push(`kv: ${errMsg(e)}`);
  }

  // 3. DO — the user's database (the core hard delete).
  try {
    await destroyUserData(userId);
    steps.doDestroyed = true;
  } catch (e) {
    errors.push(`do: ${errMsg(e)}`);
  }

  // 4. D1 — the better-auth identity (so the email can never sign in again).
  try {
    steps.authRowsDeleted = await deleteAuthRows(userId);
  } catch (e) {
    errors.push(`auth: ${errMsg(e)}`);
  }

  const ok = errors.length === 0;

  // Audit line — structured, PII-free (hashed id only). Durable in CF logs.
  console.log(
    JSON.stringify({ event: "account_deletion", at, userIdHash, ok, steps, errors })
  );

  return { ok, userIdHash, at, steps, errors };
}
