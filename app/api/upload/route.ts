import { NextRequest } from "next/server";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { parsePdf } from "@/lib/parser/run-parser";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { insertParsedStatement } from "@/lib/repo/insert-parsed";
import { insertOfxImport } from "@/lib/repo/insert-ofx";
import { parseOfx, looksLikeOfx } from "@/lib/import/ofx";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import type { Repo } from "@/lib/repo";

// Hard caps for uploaded statements. Real bank/CC PDFs run from tens of KB to a
// few MB; 25 MB clears any genuine statement while bounding in-memory buffering
// and R2/queue abuse. We also require the %PDF magic bytes so the extension
// check can't be used to smuggle arbitrary (or non-PDF) bytes into the pipeline.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF"
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

// ===========================================================================
// POST /api/upload — ingest a bank/CC statement. TWO modes, gated on
// isHostedMode() (PARE_DEPLOY_TARGET === "hosted"):
//
// SELF-HOST (default / local / MCP host): UNCHANGED. The single-user proxy gate
// fronts the route; the PDF is written to a temp file and parsed in-process
// (child_process Python) SYNCHRONOUSLY, rows are inserted, and the response is
// { inserted, skipped, total, filename } — the shape the existing /upload UI
// expects. No R2/Queue/job-store involved.
//
// HOSTED (Cloudflare): the request does NOT parse inline. It authenticates the
// caller, stores the PDF in R2, records a `queued` job, enqueues a parse message,
// and returns 202 { jobId } immediately. The queue consumer (P4) parses in the
// background; the client polls GET /api/upload/status?jobId=… for completion.
//
// ---------------------------------------------------------------------------
// UPLOAD CONTRACT (hosted) — the Expo mobile app depends on this. [Mobile app only]
//
//   POST /api/upload
//   Authorization: Bearer <better-auth session token>   (OR the session cookie)
//   Content-Type: multipart/form-data
//     file=<the .pdf>            (a File part named "file"; .pdf required)
//
//   The SAME endpoint serves the web drag-drop (cookie + multipart) and the
//   future Expo share-sheet flow (bearer token + multipart). resolveUser() reads
//   EITHER credential from the request headers, so the only difference for the
//   mobile client is sending `Authorization: Bearer` instead of relying on the
//   cookie. Pick whichever the platform makes easy.
//
//   Responses:
//     202 { jobId }                          — accepted, parsing queued
//     400 { error }                          — no file / non-PDF
//     401 { error: "Unauthorized" }          — missing/invalid credential
//     500 { error }                          — infra failure (R2/Queue/KV)
//
//   The caller then polls GET /api/upload/status?jobId=<jobId> (same auth) until a
//   TERMINAL status: "done" (with { inserted, skipped }) or "failed" (with
//   { error }). The non-terminal statuses "queued" / "parsing" / "retrying" all
//   mean "keep polling" — "retrying" is a transient error the consumer rethrew for
//   a Queue retry, NOT a permanent failure. A caller can only read jobs it owns —
//   see app/api/upload/status/route.ts.
// ===========================================================================

export async function POST(request: NextRequest) {
  if (isHostedMode()) {
    return handleHostedUpload(request);
  }
  return handleSelfHostUpload(request);
}

async function handleSelfHostUpload(request: NextRequest) {
  try {
    const repo = await getScopedRepo(request);
    if (!repo) return unauthorized();
    await repo.categories.seed();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // OFX/QFX import — the dedup-safe (FITID) successor to the removed CSV import.
    // Self-host only, like the CSV path was; the hosted queue stays PDF-only.
    if (/\.(ofx|qfx)$/i.test(file.name)) {
      return await handleOfxImport(repo, file);
    }

    if (!file.name.endsWith(".pdf")) {
      return Response.json(
        { error: "Only PDF, OFX, or QFX files accepted" },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "PDF too large (max 25 MB)." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (!looksLikePdf(new Uint8Array(bytes))) {
      return Response.json({ error: "File is not a valid PDF." }, { status: 400 });
    }
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "parse-upload-"));
    // Fixed on-disk name — NEVER join the client-supplied file.name onto a path
    // (a "../../.." filename would escape tmpDir and write attacker bytes to an
    // arbitrary location). parsePdf copies into its own temp dir and doesn't
    // care about this name; the real file.name is preserved as the statement
    // record below (parameterized insert — data, not a path).
    const tmpPath = path.join(tmpDir, "upload.pdf");

    try {
      writeFileSync(tmpPath, Buffer.from(bytes));
      const { transactions: rows, statements: metas } = parsePdf(tmpPath);

      if (rows.length === 0) {
        return Response.json(
          { error: "No transactions found in PDF. Check if this is a supported statement format." },
          { status: 400 }
        );
      }

      // Insert + dedup + batch(insertMany + recategorizeAll) via the ONE shared
      // helper the queue consumer also uses (lib/repo/insert-parsed.ts) — do NOT
      // re-inline this logic here; the two paths must never diverge.
      const { inserted, skipped } = await insertParsedStatement(repo, file.name, rows, metas);

      // Parse-complete push (fire-and-forget — never delays the response).
      // Matters most for Android share-target uploads, where the user may
      // have backgrounded the browser before parsing finished. No-op with
      // zero subscriptions.
      void import("@/lib/push/webpush")
        .then(({ sendPushToAll }) =>
          sendPushToAll({
            title: "Statement parsed",
            body: `${file.name}: ${inserted} transactions added${skipped > 0 ? `, ${skipped} duplicates skipped` : ""}.`,
            url: "/dashboard",
          })
        )
        .catch(() => {});

      // Safe-to-spend heads-up (fire-and-forget): with the new statement in,
      // warn when the projection now dips below zero before the next payday.
      void (async () => {
        const fc = await repo.cashflowForecast.get();
        if (!fc) return;
        const { deriveSafeToSpend } = await import("@/lib/safe-to-spend");
        const s = deriveSafeToSpend(fc);
        if (s?.status !== "short") return;
        const { formatCurrency, formatDayShort } = await import("@/lib/format");
        const { sendPushToAll } = await import("@/lib/push/webpush");
        await sendPushToAll({
          title: "Forecast heads-up",
          body: `Projected ${formatCurrency(Math.abs(s.cushion))} below zero around ${formatDayShort(s.lowestDate)}, before the next payday.`,
          url: "/dashboard",
        });
      })().catch(() => {});

      return Response.json({ inserted, skipped, total: rows.length, filename: file.name });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Hosted branch: authenticate (cookie OR bearer), accept a multipart PDF, store
// it in R2, record a queued job, enqueue the parse message, return 202 { jobId }.
// Parsing happens off-request in the queue consumer (P4). See the contract block
// at the top of this file — the Expo app POSTs here with a bearer token.
// ---------------------------------------------------------------------------
async function handleHostedUpload(request: NextRequest) {
  try {
    // Resolve the caller from the request-scoped better-auth (D1 binding only
    // exists inside the Worker), exactly how getScopedRepo wires it. resolveUser
    // reads EITHER the session cookie or an `Authorization: Bearer` token.
    const { createHostedAuth } = await import("@/lib/auth/hosted");
    const { getD1 } = await import("@/lib/auth/d1");
    const auth = createHostedAuth(await getD1());
    const resolved = await resolveUser(request, auth);
    if (!resolved) return unauthorized();

    // Plan-limit enforcement (cloud commercial layer; no-ops unless PARE_CLOUD=1).
    // Fail OPEN on any billing-infra error — never lock a user out of uploading
    // because the limiter/metering store hiccuped. `planId` is stamped onto the
    // queue message so the consumer can enforce the ACCOUNT cap post-parse (it
    // can't resolve D1 inside queue()); it stays undefined on cloud-off or a
    // failed-open check, which skips that gate.
    let planId: string | undefined;
    try {
      const { enforceStatementUpload } = await import("@/cloud/billing/gate");
      const limit = await enforceStatementUpload(resolved.userId);
      if (!limit.allowed) {
        // 402 Payment Required — the client surfaces limit.reason + an upgrade CTA.
        return Response.json({ error: limit.reason }, { status: 402 });
      }
      planId = limit.planId;
    } catch (err) {
      console.warn(
        "[billing] upload limit check failed open:",
        err instanceof Error ? err.message : err
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.endsWith(".pdf")) {
      return Response.json({ error: "Only PDF files accepted" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "PDF too large (max 25 MB)." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      return Response.json({ error: "File is not a valid PDF." }, { status: 400 });
    }

    // Resolve the hosted-only bindings (fail-closed if unavailable) and run the
    // dependency-injected pipeline. userId is the AUTHENTICATED caller's id — it
    // is never read from the request body, so the upload can only write to the
    // caller's own R2/KV/DO tenant.
    const { getPdfStore } = await import("@/lib/storage/pdf-store");
    const { getJobStore } = await import("@/lib/queue/job-store");
    const { getParseQueue } = await import("@/lib/queue/producer");
    const { handleHostedUpload: runHostedUpload } = await import("@/lib/queue/upload-handler");

    const [pdfStore, jobStore, queue] = await Promise.all([
      getPdfStore(),
      getJobStore(),
      getParseQueue(),
    ]);

    const { jobId } = await runHostedUpload(
      { userId: resolved.userId, filename: file.name, bytes, planId },
      { pdfStore, jobStore, queue }
    );

    // Record the accepted upload against this month's usage (cloud layer; no-op
    // unless PARE_CLOUD=1). Best-effort — metering failure must not fail the
    // upload the user already succeeded in submitting.
    try {
      const { recordStatementUpload } = await import("@/cloud/billing/gate");
      await recordStatementUpload(resolved.userId);
    } catch (err) {
      console.warn("[billing] usage metering failed:", err instanceof Error ? err.message : err);
    }

    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// OFX/QFX import. Parses the file in-process (pure TS, no child process), then
// inserts via the shared insert-ofx helper: one statement per account, dedup keyed
// on each transaction's bank-assigned FITID, recategorize once. account_kind is set
// from the OFX account type, so imported accounts light up every chart immediately.
// Returns the SAME shape the /upload UI expects from a PDF upload.
async function handleOfxImport(repo: Repo, file: File) {
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "File too large (max 25 MB)." }, { status: 400 });
  }

  const text = await file.text();
  if (!looksLikeOfx(text)) {
    return Response.json({ error: "File is not a valid OFX/QFX file." }, { status: 400 });
  }

  const parsed = parseOfx(text);
  const total = parsed.accounts.reduce((n, a) => n + a.transactions.length, 0);
  if (total === 0) {
    return Response.json(
      { error: "No transactions found in OFX/QFX file." },
      { status: 400 }
    );
  }

  const { inserted, skipped } = await insertOfxImport(repo, file.name, parsed);
  return Response.json({ inserted, skipped, total, filename: file.name });
}
