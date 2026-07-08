// Shared CSV cell encoder for every server-side export (transactions, waitlist,
// …). Two concerns in one place so a new exporter can't forget either:
//
//  1. RFC 4180 quoting — wrap a cell containing a comma, double-quote, or newline
//     in double-quotes and double any internal quotes.
//  2. Spreadsheet formula-injection neutralization — a TEXT cell beginning with a
//     formula trigger (= + - @, or a leading tab/CR) is executed by Excel/Sheets/
//     LibreOffice on open. Attacker-influenced text (merchant descriptions, a
//     waitlist email/source posted by a stranger) reaches these exports verbatim,
//     so prefix such cells with a single quote (rendered as literal text) and
//     quote them. Numbers are our own data — never a formula — so they pass
//     through unaltered (keeps numeric columns numeric).
export function csvField(value: string | number): string {
  const s = String(value);
  const needsFormulaGuard = typeof value === "string" && /^[=+\-@\t\r]/.test(s);
  const cell = needsFormulaGuard ? `'${s}` : s;
  return needsFormulaGuard || /[",\n\r]/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"`
    : cell;
}
