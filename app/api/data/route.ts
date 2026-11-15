import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getDb, DB_PATH } from "@/lib/db";
import { isHostedMode } from "@/lib/auth/resolve";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { csvField } from "@/lib/csv";

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
      const header = "id,txn_date,source,description,amount,flow,category,tags,reimbursement_status";
      const body = rows
        .map((r) =>
          [
            r.id,
            r.txn_date,
            r.source,
            r.description,
            r.amount,
            r.flow,
            r.category,
            r.tags ?? "",
            r.reimbursement_status ?? "",
          ]
            .map(csvField)
            .join(",")
        )
        .join("\n");
      return new Response(`${header}\n${body}\n`, {
        headers: attachment(`parse-transactions-${stamp}.csv`, "text/csv; charset=utf-8"),
      });
    }

    case "json": {
      const [transactions, rules, splits, goals, tags, reimbursements] = await Promise.all([
        repo.transactions.exportAll(),
        repo.categories.listRules(),
        repo.splits.listAll(),
        repo.goals.list(),
        repo.tags.listAll(),
        repo.tags.listAllReimbursements(),
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
        // Tags + reimbursement marks — base-table reads (incl. hidden
        // accounts), keyed by transaction_id like the splits above.
        transaction_tags: tags,
        reimbursements,
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
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "WIPE") {
    return Response.json(
      { error: 'Confirmation required: pass {"confirm":"WIPE"}' },
      { status: 400 }
    );
  }

  const deleted = await repo.transactions.wipeAll();
  return Response.json({ success: true, deleted });
}
