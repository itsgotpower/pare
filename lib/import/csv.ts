// Minimal, dependency-free CSV parsing for the cross-app importer. The
// quote-aware line parser is lifted from the (dormant) PDF-upload CSV branch so
// the two share one battle-tested implementation; `parseCsv` adds the header
// split plus the CRLF/BOM hygiene that bank exports routinely need (see the
// "\r line endings" gotcha in CLAUDE.md — a stray \r silently breaks downstream
// CHECK constraints / header matching).

export interface ParsedCsv {
  headers: string[]; // raw header cells, order preserved
  rows: string[][]; // data rows (header excluded)
}

// Split one CSV line into fields, honouring "quoted, ""escaped"" commas".
export function parseCsvLine(line: string): string[] {
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

// Parse a whole CSV document. Strips a leading UTF-8 BOM and all \r so a
// CRLF/BOM export's first header matches preset fingerprints, and trims each
// cell. Blank lines are skipped.
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "").replace(/\r/g, "");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => parseCsvLine(l).map((c) => c.trim()));
  return { headers, rows };
}
