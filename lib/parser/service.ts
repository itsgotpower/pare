// ---------------------------------------------------------------------------
// ParserService — the seam that decouples "turn PDF bytes into rows" from HOW
// the parse runs. It mirrors the Repo seam (lib/repo/index.ts) in structure:
//
//   self-hosted / local / MCP  ->  LocalParser. Wraps the existing
//       run-parser.ts child_process + poppler path. The Python parser runs in
//       the same process tree, exactly as today.
//
//   hosted (Workers)           ->  RemoteParser. Workers can't fork poppler, so
//       the bytes are HTTP-POSTed to the P2 parser container's `/parse`
//       endpoint, which runs the SAME Python parser and returns the SAME JSON.
//
// A factory `getParserService()` selects on PARSE_DEPLOY_TARGET=hosted, exactly
// like getRepo()/getScopedRepo. Both impls return the identical shape
// (ParseResult: { transactions, statements }) so call sites are drop-in: the P5
// upload endpoint and P4 queue consumer call `getParserService().parse(bytes)`
// and never learn which impl ran.
//
// CONTRACT (the thing P4/P5 consume — keep stable):
//
//   interface ParserService { parse(input: Uint8Array): Promise<ParseResult> }
//
// `input` is the raw PDF bytes. The Promise resolves to the parsed
// transactions + per-statement metadata, or rejects on a parse/transport error.
// ---------------------------------------------------------------------------

import { parsePdf, type ParseResult } from "./run-parser";

export type { ParseResult, ParsedTransaction, ParsedStatementMeta } from "./run-parser";

/**
 * ParserService — parse raw PDF bytes into transactions + statement metadata.
 *
 * The single method both deploy targets implement. `parse` takes the PDF as a
 * Uint8Array (what `File.arrayBuffer()` / a queue message body yields) and
 * returns the same ParseResult `parsePdf()` produces today.
 */
export interface ParserService {
  parse(input: Uint8Array): Promise<ParseResult>;
}

// ---------------------------------------------------------------------------
// LocalParser — self-host / local / MCP.
//
// run-parser's parsePdf() takes a FILE PATH (it copies into a temp dir and
// execs python3). This adapter is the byte-oriented front door: it writes the
// incoming bytes to a temp file, delegates to parsePdf(), and cleans up. The
// result is byte-for-byte what the upload route gets today, so swapping the
// route over to getParserService() changes nothing for self-host.
//
// fs/os/path are imported lazily so this module is import-safe on Workers
// (where Node's fs is absent); only LocalParser.parse() touches them, and that
// path never runs in hosted mode.
// ---------------------------------------------------------------------------
export class LocalParser implements ParserService {
  async parse(input: Uint8Array): Promise<ParseResult> {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const path = (await import("path")).default;
    const os = (await import("os")).default;

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "parse-svc-"));
    const tmpPath = path.join(tmpDir, "statement.pdf");
    try {
      writeFileSync(tmpPath, Buffer.from(input));
      return parsePdf(tmpPath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// RemoteParser — hosted (Workers).
//
// POSTs the raw bytes to the P2 container's `/parse` endpoint and returns its
// JSON. The container runs the identical Python parser, so the JSON IS a
// ParseResult. The base URL comes from the runtime (env var in Node, a Worker
// binding in hosted mode) — resolved lazily by the factory, not hardcoded here.
//
// `fetchImpl` is injectable purely for unit tests; production passes the global
// fetch (available on both Workers and Node 20+).
// ---------------------------------------------------------------------------
export class RemoteParser implements ParserService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!baseUrl) {
      throw new Error("RemoteParser: a parser container base URL is required");
    }
  }

  async parse(input: Uint8Array): Promise<ParseResult> {
    // Trailing-slash-safe join: `<base>/parse`.
    const url = `${this.baseUrl.replace(/\/+$/, "")}/parse`;

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      // A fresh ArrayBuffer-backed view so the body is a concrete byte payload
      // (some fetch impls reject a Node Buffer / SharedArrayBuffer view).
      body: new Uint8Array(input),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `RemoteParser: parser container returned ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
      );
    }

    return (await res.json()) as ParseResult;
  }
}

// ---------------------------------------------------------------------------
// getParserService — the factory every call site uses.
//
// Selects on PARSE_DEPLOY_TARGET=hosted (same switch as getRepo / getScopedRepo
// in lib/repo). Self-host returns a LocalParser; hosted returns a RemoteParser
// pointed at the configured container URL.
//
// The hosted base URL is resolved from PARSER_SERVICE_URL — set as a [vars]
// entry / binding in wrangler (wired in P6, alongside the real R2 bucket). We
// fail closed with a clear message if hosted mode is selected without it,
// rather than silently falling back to the child_process path (which can't run
// on Workers).
// ---------------------------------------------------------------------------
export function getParserService(): ParserService {
  if (process.env.PARSE_DEPLOY_TARGET === "hosted") {
    const baseUrl = process.env.PARSER_SERVICE_URL;
    if (!baseUrl) {
      throw new Error(
        "getParserService: hosted mode requires PARSER_SERVICE_URL (the P2 parser container base URL)"
      );
    }
    return new RemoteParser(baseUrl);
  }
  return new LocalParser();
}
