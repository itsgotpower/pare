import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, DB_PATH } from "@/lib/db";
import { isHostedMode } from "@/lib/auth/resolve";
import { csvField } from "@/lib/csv";

// Exports + destructive data ops — SELF-HOST ONLY. This route reads the file DB
// directly (getDb/fs/better-sqlite3), which does not exist on the hosted target,
// and in hosted mode the middleware gate is retired (routes must auth
// themselves) — so it explicitly 404s there rather than relying on the import
// failing. Self-host auth is the middleware.ts session gate (this route is not
// in its public list), same as every other self-host API route.
function hostedNotFound(): Response | null {
  return isHostedMode() ? Response.json({ error: "Not found" }, { status: 404 }) : null;
}

interface ExportTxn {
  txn_date: string;
  source: string;
  description: string;
  amount: number;
  flow: string;
  category: string;
}

function exportTransactions(): ExportTxn[] {
  // Base table + override join, NOT v_transactions: the view excludes hidden
  // accounts (migration 009), but an export is the user's own data and must
  // always be complete.
  return getDb()
    .prepare(
      `SELECT t.txn_date, t.source, t.description, t.amount, t.flow,
              COALESCE(co.new_category, t.category) AS category
       FROM transactions t
       LEFT JOIN category_overrides co ON co.transaction_id = t.id
       ORDER BY t.txn_date, t.source, t.id`
    )
    .all() as ExportTxn[];
}

function attachment(filename: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}

export async function GET(request: NextRequest) {
  const gone = hostedNotFound();
  if (gone) return gone;
  const format = request.nextUrl.searchParams.get("format");
  const stamp = new Date().toISOString().slice(0, 10);

  switch (format) {
    case "csv": {
      const rows = exportTransactions();
      const header = "txn_date,source,description,amount,flow,category";
      const body = rows
        .map((r) =>
          [r.txn_date, r.source, r.description, r.amount, r.flow, r.category]
            .map(csvField)
            .join(",")
        )
        .join("\n");
      return new Response(`${header}\n${body}\n`, {
        headers: attachment(`parse-transactions-${stamp}.csv`, "text/csv; charset=utf-8"),
      });
    }

    case "json": {
      const db = getDb();
      const payload = {
        exported_at: new Date().toISOString(),
        transactions: exportTransactions(),
        category_rules: db
          .prepare("SELECT keyword, category, sort_order FROM category_rules ORDER BY sort_order, id")
          .all(),
        goals: db
          .prepare("SELECT category, monthly_limit FROM spending_goals WHERE active = 1 ORDER BY category")
          .all(),
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: attachment(`parse-export-${stamp}.json`, "application/json"),
      });
    }

    case "backup": {
      // Online backup via better-sqlite3 — safe while the DB is in use, and
      // produces a single consolidated file (no -wal/-shm sidecars).
      const tmp = path.join(path.dirname(DB_PATH), `.backup-${process.pid}-${Date.now()}.db`);
      try {
        await getDb().backup(tmp);
        const bytes = fs.readFileSync(tmp);
        return new Response(new Uint8Array(bytes), {
          headers: attachment(`parse-backup-${stamp}.db`, "application/octet-stream"),
        });
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }

    default:
      return Response.json({ error: "format must be csv, json, or backup" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const gone = hostedNotFound();
  if (gone) return gone;
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "WIPE") {
    return Response.json(
      { error: 'Confirmation required: pass {"confirm":"WIPE"}' },
      { status: 400 }
    );
  }

  const db = getDb();
  const wipe = db.transaction(() => {
    // Overrides reference transactions(id) (FKs are ON) — delete them first.
    const overrides = db.prepare("DELETE FROM category_overrides").run().changes;
    const txns = db.prepare("DELETE FROM transactions").run().changes;
    const stmts = db.prepare("DELETE FROM statements").run().changes;
    return { transactions: txns, statements: stmts, overrides };
  });
  const deleted = wipe();

  // Rules, goals, and the user account are deliberately kept — rules also
  // persist to data/user-rules.json, so even a full DB wipe restores them.
  return Response.json({ success: true, deleted });
}
