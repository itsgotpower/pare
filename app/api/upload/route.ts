import { NextRequest } from "next/server";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { parsePdf } from "@/lib/parser/run-parser";
import { computeDedupKey } from "@/lib/db/transactions";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { insertParsedStatement } from "@/lib/repo/insert-parsed";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import type { Repo } from "@/lib/repo";

// ===========================================================================
// POST /api/upload — ingest a bank/CC statement. TWO modes, gated on
// isHostedMode() (PARSE_DEPLOY_TARGET === "hosted"):
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
    const csvData = formData.get("csv") as string | null;

    if (csvData) {
      return await handleCsvImport(repo, csvData);
    }

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".pdf")) {
      return Response.json({ error: "Only PDF files accepted" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "parse-upload-"));
    const tmpPath = path.join(tmpDir, file.name);

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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.endsWith(".pdf")) {
      return Response.json({ error: "Only PDF files accepted" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

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
      { userId: resolved.userId, filename: file.name, bytes },
      { pdfStore, jobStore, queue }
    );

    return Response.json({ jobId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

// Dormant: the CSV-import UI/route were removed (PDFs only — see CLAUDE.md "Data
// provenance"); nothing triggers this branch. Kept (and migrated) for parity.
async function handleCsvImport(repo: Repo, csvData: string) {
  await repo.categories.seed();

  const lines = csvData.replace(/\r/g, "").trim().split("\n");
  const header = lines[0];
  const hasDateCol = header.includes("txn_date");

  const seqMap = new Map<string, number>();

  const statementId = await repo.statements.insert({
    filename: "csv-import",
    source: "csv",
    account: "CSV Import",
    period: "imported",
    row_count: lines.length - 1,
  });

  const newTxns: Parameters<typeof repo.transactions.insertMany>[0] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    if (parts.length < 7) continue;

    let source: string, account: string, period: string, txnDate: string;
    let description: string, amount: number, category: string, flow: string;

    if (hasDateCol) {
      [source, account, period, txnDate, description, amount, category, flow] = [
        parts[0], parts[1], parts[2], parts[3], parts[4],
        parseFloat(parts[5]), parts[6], parts[7],
      ] as [string, string, string, string, string, number, string, string];
    } else {
      [source, account, period, description, amount, category, flow] = [
        parts[0], parts[1], parts[2], parts[3],
        parseFloat(parts[4]), parts[5], parts[6],
      ] as [string, string, string, string, number, string, string];
      txnDate = extractDateFromPeriod(period);
    }

    const seqKey = `${source}|${txnDate}|${description}|${amount}`;
    const seq = (seqMap.get(seqKey) || 0) + 1;
    seqMap.set(seqKey, seq);

    newTxns.push({
      statement_id: statementId || null,
      source, account, period,
      txn_date: txnDate,
      description,
      amount,
      category,
      flow,
      dedup_key: computeDedupKey(source, txnDate, description, amount, seq),
    });
  }

  const { inserted, skipped } = await repo.transactions.insertMany(newTxns);

  return Response.json({ inserted, skipped, total: lines.length - 1, filename: "csv-import" });
}

function extractDateFromPeriod(period: string): string {
  const m = period.match(/(\w+)\s+(\d+),?\s*(\d{4})/);
  if (m) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const mon = months[m[1]] || "01";
    return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }
  const rangeMatch = period.match(/(\w+)\s+(\d+)\s+to\s+\w+\s+\d+,?\s*(\d{4})/);
  if (rangeMatch) {
    const months: Record<string, string> = {
      January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
      July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
    };
    const mon = months[rangeMatch[1]] || "01";
    return `${rangeMatch[3]}-${mon}-${rangeMatch[2].padStart(2, "0")}`;
  }
  return "2026-01-01";
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
