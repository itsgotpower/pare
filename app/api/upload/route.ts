import { NextRequest } from "next/server";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import { parsePdf } from "@/lib/parser/run-parser";
import { insertTransaction, computeDedupKey } from "@/lib/db/transactions";
import { insertStatement } from "@/lib/db/statements";
import { seedCategoryRules, recategorizeAll } from "@/lib/db/categories";

export async function POST(request: NextRequest) {
  try {
    seedCategoryRules();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const csvData = formData.get("csv") as string | null;

    if (csvData) {
      return handleCsvImport(csvData);
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
      const rows = parsePdf(tmpPath);

      if (rows.length === 0) {
        return Response.json(
          { error: "No transactions found in PDF. Check if this is a supported statement format." },
          { status: 400 }
        );
      }

      const source = rows[0].source;
      const account = rows[0].account;
      const period = rows[0].period;

      const statementId = insertStatement({
        filename: file.name,
        source,
        account,
        period,
        row_count: rows.length,
      });

      let inserted = 0;
      let skipped = 0;
      const seqMap = new Map<string, number>();

      for (const row of rows) {
        const seqKey = `${row.source}|${row.txn_date}|${row.description}|${row.amount}`;
        const seq = (seqMap.get(seqKey) || 0) + 1;
        seqMap.set(seqKey, seq);

        const dedupKey = computeDedupKey(row.source, row.txn_date, row.description, row.amount, seq);
        const didInsert = insertTransaction({
          statement_id: statementId || null,
          source: row.source,
          account: row.account,
          period: row.period,
          txn_date: row.txn_date,
          description: row.description,
          amount: row.amount,
          category: row.category,
          flow: row.flow,
          dedup_key: dedupKey,
        });

        if (didInsert) inserted++;
        else skipped++;
      }

      // The shipped parser taxonomy is generic; apply the DB's full rule set
      // (incl. the gitignored personal taxonomy) so uploads categorize correctly.
      if (inserted > 0) recategorizeAll();

      return Response.json({ inserted, skipped, total: rows.length, filename: file.name });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

function handleCsvImport(csvData: string) {
  seedCategoryRules();

  const lines = csvData.replace(/\r/g, "").trim().split("\n");
  const header = lines[0];
  const hasDateCol = header.includes("txn_date");

  let inserted = 0;
  let skipped = 0;
  const seqMap = new Map<string, number>();

  const statementId = insertStatement({
    filename: "csv-import",
    source: "csv",
    account: "CSV Import",
    period: "imported",
    row_count: lines.length - 1,
  });

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

    const dedupKey = computeDedupKey(source, txnDate, description, amount, seq);
    const didInsert = insertTransaction({
      statement_id: statementId || null,
      source, account, period,
      txn_date: txnDate,
      description,
      amount,
      category,
      flow,
      dedup_key: dedupKey,
    });

    if (didInsert) inserted++;
    else skipped++;
  }

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
