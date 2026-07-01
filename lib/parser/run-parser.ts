import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

export interface ParsedTransaction {
  source: string;
  account: string;
  period: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  flow: string;
}

export interface ParsedStatementMeta {
  filename: string;
  source: string;
  account: string;
  period: string;
  closing_balance: number | null;
  closing_date: string | null;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  statements: ParsedStatementMeta[];
}

const PARSER_PATH = path.join(process.cwd(), "lib", "parser", "parse_statements.py");

export function parsePdf(pdfPath: string): ParseResult {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parse-"));
  const tmpPdf = path.join(tmpDir, path.basename(pdfPath));
  fs.copyFileSync(pdfPath, tmpPdf);

  try {
    const stdout = execFileSync("python3", [PARSER_PATH, tmpDir, "--json"], {
      encoding: "utf-8",
      timeout: 30000,
    });

    return JSON.parse(stdout) as ParseResult;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
