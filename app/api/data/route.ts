import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, DB_PATH } from "@/lib/db";
import { isHostedMode } from "@/lib/auth/resolve";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { csvField } from "@/lib/csv";

// Data export + destructive wipe. Exports (GET) now flow through the scoped Repo,
// so CSV + JSON work on BOTH deploy targets (self-host file DB and the hosted
// Durable-Object-per-user backend). The `backup` format is a byte-for-byte
// better-sqlite3 online db.backup() and stays SELF-HOST ONLY — the hosted DO uses
// native ctx.storage.sql with no serialisable .db file, and there is no
// copy-over-the-file restore path there anyway. DELETE (wipe) still reads the file
// DB directly and remains self-host only; see hostedNotFound below.
function hostedNotFound(): Response | null {
  return isHostedMode() ? Response.json({ error: "Not found" }, { status: 404 }) : null;
}

function attachment(filename: string, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format");
  const stamp = new Date().toISOString().slice(0, 10);

  // Backup is a self-host-only, file-level operation (better-sqlite3.backup);
  // 404 it in hosted mode before touching the repo.
  if (format === "backup") {
    if (isHostedMode()) return Response.json({ error: "Not found" }, { status: 404 });
    // Self-host still gates via the middleware session cookie (this route is not
    // public), so the file DB read below is already authenticated.
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

  // CSV + JSON: scoped to the caller's Repo, so they work on both targets.
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  switch (format) {
    case "csv": {
      const rows = await repo.transactions.exportAll();
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
      const [transactions, rules, splits, goals] = await Promise.all([
        repo.transactions.exportAll(),
        repo.categories.listRules(),
        repo.splits.listAll(),
        repo.goals.list(),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        transactions,
        category_rules: rules.map((r) => ({
          keyword: r.keyword,
          category: r.category,
          sort_order: r.sort_order,
        })),
        // Split parts, so the JSON export stays a faithful backup (splits
        // re-slice the transactions above by transaction_id).
        transaction_splits: splits,
        // goals.list() already returns only active goals.
        goals: goals.map((g) => ({ category: g.category, monthly_limit: g.monthly_limit })),
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: attachment(`parse-export-${stamp}.json`, "application/json"),
      });
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
    // Overrides and splits reference transactions(id) (FKs are ON) — delete
    // the children first.
    const overrides = db.prepare("DELETE FROM category_overrides").run().changes;
    const splits = db.prepare("DELETE FROM transaction_splits").run().changes;
    const txns = db.prepare("DELETE FROM transactions").run().changes;
    const stmts = db.prepare("DELETE FROM statements").run().changes;
    return { transactions: txns, statements: stmts, overrides, splits };
  });
  const deleted = wipe();

  // Rules, goals, and the user account are deliberately kept — rules also
  // persist to data/user-rules.json, so even a full DB wipe restores them.
  return Response.json({ success: true, deleted });
}
