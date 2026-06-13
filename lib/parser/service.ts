// ---------------------------------------------------------------------------
// ParserService — the seam that decouples "turn PDF bytes into rows" from HOW
// the parse runs. It mirrors the Repo seam (lib/repo/index.ts) in structure:
//
//   self-hosted / local / MCP  ->  LocalParser. Wraps the existing
//       run-parser.ts child_process + poppler path. The Python parser runs in
//       the same process tree, exactly as today.
//
//   hosted (Workers)           ->  ContainerParser. Workers can't fork poppler, so
//       the bytes are routed to the P2 parser CONTAINER (a Container-backed
//       Durable Object, env.PARSER) which runs the SAME Python parser and returns
//       the SAME JSON. Resolution is off the Worker's `env` binding, NOT a URL —
//       there is no reliable URL/getCloudflareContext inside a queue() invocation,
//       so the consumer constructs `new ContainerParser(env.PARSER)` directly.
//
// There is ONE canonical "parse via container" path: ContainerParser, which wraps
// the single parsePdfViaContainer() implementation in parser-container.ts. (The
// old RemoteParser-by-URL / PARSER_SERVICE_URL path was removed — nothing in the
// hosted/consumer path resolved a URL binding, and the self-host route calls
// parsePdf() directly, so it was dead weight.)
//
// A factory `getParserService()` returns LocalParser for the self-host / local /
// MCP path. Both impls return the identical shape (ParseResult: { transactions,
// statements }) so call sites are drop-in: the P5 upload endpoint and P4 queue
// consumer treat any ParserService the same and never learn which impl ran.
//
// CONTRACT (the thing P4/P5 consume — keep stable):
//
//   interface ParserService { parse(input: Uint8Array): Promise<ParseResult> }
//
// `input` is the raw PDF bytes. The Promise resolves to the parsed
// transactions + per-statement metadata, or rejects on a parse/transport error.
// ---------------------------------------------------------------------------

// Type-only: run-parser.ts statically imports node:child_process / fs / os (for
// LocalParser's poppler exec). Importing those eagerly would pull them into the
// hosted/Workers bundle (and break the workerd test that loads the consumer ->
// this module). LocalParser lazy-imports parsePdf inside parse() instead, so this
// module stays import-safe on Workers; only the self-host/local path loads it.
import type { ParseResult } from "./run-parser";
// Type-only: parser-container.ts pulls in @cloudflare/containers -> the
// `cloudflare:workers` virtual module, which can't resolve off-Workers (Node/dev/
// tests). Keep this module import-safe everywhere by importing only the TYPE here
// and lazy-importing parsePdfViaContainer inside ContainerParser.parse() (only the
// hosted path, on Workers, ever reaches it).
import type { ParserContainerBinding } from "./parser-container";

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
    // Lazy: run-parser.ts pulls in node:child_process (poppler exec) — keep it off
    // the hosted/Workers import graph (see the file header).
    const { parsePdf } = await import("./run-parser");

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
// ContainerParser — hosted (Workers). The ONE canonical "parse via container"
// impl.
//
// Wraps the `PARSER` Container binding (a Container-backed Durable Object
// namespace, env.PARSER). parsePdfViaContainer() routes the bytes to the
// container's `/parse` endpoint (getByName("default") -> instance.fetch) and
// returns its JSON, which IS a ParseResult (the container runs the identical
// Python parser). The binding is passed in explicitly — the queue consumer
// constructs `new ContainerParser(env.PARSER)` off the Worker's env, since there
// is no reliable URL/getCloudflareContext inside a queue() invocation.
// ---------------------------------------------------------------------------
export class ContainerParser implements ParserService {
  constructor(private readonly binding: ParserContainerBinding) {}

  async parse(input: Uint8Array): Promise<ParseResult> {
    // Lazy import: parser-container.ts loads @cloudflare/containers (the
    // `cloudflare:workers` module), which only exists on Workers. Importing it here
    // keeps `service.ts` import-safe in Node/dev/tests; this path runs only hosted.
    const { parsePdfViaContainer } = await import("./parser-container");
    const result = await parsePdfViaContainer(this.binding, input);
    return result as ParseResult;
  }
}

// ---------------------------------------------------------------------------
// getParserService — the factory for the SELF-HOST / local / MCP path.
//
// Returns a LocalParser (child_process + poppler in-process). The hosted path
// does NOT go through this factory: the queue consumer builds a ContainerParser
// off env.PARSER directly (there is no process.env URL on Workers). Kept as the
// drop-in `parse(bytes)` entry point for the non-hosted call sites.
// ---------------------------------------------------------------------------
export function getParserService(): ParserService {
  return new LocalParser();
}
