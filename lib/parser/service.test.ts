import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { LocalParser, ContainerParser, getParserService } from "./service";
import type { ParserContainerBinding } from "./parser-container";
import { parsePdf, type ParseResult } from "./run-parser";

// ---------------------------------------------------------------------------
// A minimal, SYNTHETIC text-bearing PDF (no real financial data). pdftotext can
// read it; the parser routes it as Amex and returns zero transactions + one
// statement meta — enough to prove LocalParser delegates to parsePdf and yields
// the IDENTICAL ParseResult, without shipping a real statement fixture.
// ---------------------------------------------------------------------------
function syntheticPdfBytes(): Uint8Array {
  const content = "BT /F1 12 Tf 72 720 Td (American Express test statement) Tj ET";
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(out, "binary"));
    out += o;
  }
  const xrefPos = Buffer.byteLength(out, "binary");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "binary"));
}

test("LocalParser.parse(bytes) yields the same ParseResult as parsePdf on the same PDF", async () => {
  const bytes = syntheticPdfBytes();

  // Baseline: parsePdf over a file written from the same bytes.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "svc-baseline-"));
  const tmpPath = path.join(tmpDir, "statement.pdf");
  let baseline: ParseResult;
  try {
    writeFileSync(tmpPath, Buffer.from(bytes));
    baseline = parsePdf(tmpPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // The seam: LocalParser takes bytes and must produce the identical shape.
  const viaService = await new LocalParser().parse(bytes);

  assert.deepEqual(
    viaService.transactions,
    baseline.transactions,
    "LocalParser transactions match parsePdf"
  );
  // Statement filenames differ (temp name), so compare the meaningful fields.
  assert.equal(viaService.statements.length, baseline.statements.length);
  assert.equal(viaService.statements[0]?.source, baseline.statements[0]?.source);
  assert.equal(viaService.statements[0]?.account, baseline.statements[0]?.account);
});

// A fake PARSER Container binding: getByName("default") -> an instance whose
// fetch() returns a canned Response. Mirrors the production env.PARSER surface
// (parsePdfViaContainer POSTs http://parser/parse to instance.fetch).
function fakeContainerBinding(
  respond: (req: Request) => Response | Promise<Response>
): { binding: ParserContainerBinding; seen: { req: Request | null } } {
  const seen: { req: Request | null } = { req: null };
  const binding: ParserContainerBinding = {
    getByName() {
      return {
        async fetch(req: Request) {
          seen.req = req;
          return respond(req);
        },
      };
    },
  };
  return { binding, seen };
}

test("ContainerParser routes the bytes through the PARSER container and returns its JSON", async () => {
  const expected: ParseResult = {
    transactions: [
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-04",
        description: "CORNER STORE", amount: 12.5, category: "Groceries", flow: "spend",
      },
    ],
    statements: [
      {
        filename: "statement.pdf", source: "amex", account: "card", period: "2026-05",
        closing_balance: 100, closing_date: "2026-05-31",
      },
    ],
  };

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const { binding, seen } = fakeContainerBinding(
    () =>
      new Response(JSON.stringify(expected), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );

  const result = await new ContainerParser(binding).parse(bytes);

  assert.equal(seen.req?.method, "POST", "POSTs to the container");
  assert.ok(String(seen.req?.url).endsWith("/parse"), "hits the /parse endpoint");
  const sentBody = new Uint8Array(await seen.req!.arrayBuffer());
  assert.deepEqual(sentBody, bytes, "the raw PDF bytes are the request body");
  assert.deepEqual(result, expected, "returns the container's JSON unchanged");
});

test("ContainerParser surfaces a non-2xx from the container as an error", async () => {
  const { binding } = fakeContainerBinding(() => new Response("boom", { status: 502 }));
  await assert.rejects(() => new ContainerParser(binding).parse(new Uint8Array([0])), /502/);
});

test("getParserService returns LocalParser (self-host / local / MCP path)", () => {
  const savedTarget = process.env.PARSE_DEPLOY_TARGET;
  try {
    delete process.env.PARSE_DEPLOY_TARGET;
    assert.ok(getParserService() instanceof LocalParser, "default -> LocalParser");

    // getParserService is the self-host factory only; the hosted path constructs
    // a ContainerParser off env.PARSER directly (no process.env URL on Workers),
    // so even with the hosted target it still returns LocalParser here.
    process.env.PARSE_DEPLOY_TARGET = "hosted";
    assert.ok(getParserService() instanceof LocalParser, "factory stays LocalParser");
  } finally {
    if (savedTarget === undefined) delete process.env.PARSE_DEPLOY_TARGET;
    else process.env.PARSE_DEPLOY_TARGET = savedTarget;
  }
});
