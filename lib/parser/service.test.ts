import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { LocalParser, RemoteParser, getParserService } from "./service";
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

test("RemoteParser POSTs the bytes to <base>/parse and returns the parsed JSON", async () => {
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
  let seenUrl = "";
  let seenMethod = "";
  let seenBody: Uint8Array | null = null;

  const fakeFetch: typeof fetch = async (input, init) => {
    seenUrl = String(input);
    seenMethod = init?.method ?? "GET";
    seenBody = new Uint8Array(init?.body as ArrayBuffer);
    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  // Trailing slash on the base URL must be normalised, not doubled.
  const parser = new RemoteParser("https://parser.example.com/", fakeFetch);
  const result = await parser.parse(bytes);

  assert.equal(seenUrl, "https://parser.example.com/parse", "POSTs to <base>/parse");
  assert.equal(seenMethod, "POST");
  assert.deepEqual(seenBody, bytes, "the raw PDF bytes are the request body");
  assert.deepEqual(result, expected, "returns the container's JSON unchanged");
});

test("RemoteParser surfaces a non-2xx from the container as an error", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("boom", { status: 502 });
  const parser = new RemoteParser("https://parser.example.com", fakeFetch);
  await assert.rejects(() => parser.parse(new Uint8Array([0])), /502/);
});

test("RemoteParser rejects an empty base URL at construction", () => {
  assert.throws(() => new RemoteParser("", fetch), /base URL is required/);
});

test("getParserService selects LocalParser off-hosted and RemoteParser when hosted", () => {
  const savedTarget = process.env.PARSE_DEPLOY_TARGET;
  const savedUrl = process.env.PARSER_SERVICE_URL;
  try {
    delete process.env.PARSE_DEPLOY_TARGET;
    assert.ok(getParserService() instanceof LocalParser, "default -> LocalParser");

    process.env.PARSE_DEPLOY_TARGET = "hosted";
    process.env.PARSER_SERVICE_URL = "https://parser.example.com";
    assert.ok(getParserService() instanceof RemoteParser, "hosted -> RemoteParser");

    delete process.env.PARSER_SERVICE_URL;
    assert.throws(() => getParserService(), /PARSER_SERVICE_URL/, "hosted without URL fails closed");
  } finally {
    if (savedTarget === undefined) delete process.env.PARSE_DEPLOY_TARGET;
    else process.env.PARSE_DEPLOY_TARGET = savedTarget;
    if (savedUrl === undefined) delete process.env.PARSER_SERVICE_URL;
    else process.env.PARSER_SERVICE_URL = savedUrl;
  }
});
