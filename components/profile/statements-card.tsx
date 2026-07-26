"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCents } from "@/lib/format";
import { purgeDataCaches } from "@/lib/purge-data-cache";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

// STATEMENTS — statement management on /profile. Which statements are loaded
// (grouped by source, labelled the same way DATA HEALTH labels them), each
// row's txn count and closing-balance anchor, and a REMOVE action. That badge
// + count IS the reconciliation status: a statement without a closing balance
// can't anchor net worth or the cash-flow forecast. Re-parse = remove here,
// re-upload at /upload — original PDFs are never stored, and dedup makes the
// re-upload idempotent.

interface StatementItem {
  id: number;
  filename: string;
  source: string;
  account: string;
  period: string;
  uploaded_at: string;
  row_count: number;
  closing_balance: number | null;
  closing_date: string | null;
  account_kind: string;
}

interface AccountItem {
  source: string;
  label: string; // nickname if set, else derived — same as DATA HEALTH
  hidden: boolean;
  closed: boolean;
}

interface SourceGroup {
  source: string;
  label: string;
  hidden: boolean;
  statements: StatementItem[];
  missingAnchors: number;
}

// uploaded_at is SQLite datetime('now') — "YYYY-MM-DD HH:MM:SS" (UTC).
const formatUploaded = (ts: string) =>
  new Date(ts.slice(0, 10) + "T00:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export function StatementsCard({ onChanged }: { onChanged?: () => void }) {
  const [statements, setStatements] = useState<StatementItem[] | null>(null);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StatementItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/statements");
      if (!res.ok) return;
      const data = await res.json();
      setStatements(Array.isArray(data.statements) ? data.statements : []);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch {
      /* card stays hidden on load failure */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openRemove = (s: StatementItem) => {
    setRemoveError(null);
    setRemoveTarget(s);
    setRemoveOpen(true);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoveError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/statements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: removeTarget.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemoveError(data.error || "Failed to remove statement");
        return;
      }
      // Deleting transactions changes every chart — drop the SW's cached
      // /api/* GETs so stale data doesn't linger offline-first.
      await purgeDataCaches();
      setRemoveOpen(false);
      setRemoveTarget(null);
      await load();
      onChanged?.();
    } catch {
      setRemoveError("Failed to remove statement");
    } finally {
      setBusy(false);
    }
  };

  if (statements === null) return null; // not loaded yet (or 401'd)

  const labelBySource = new Map(accounts.map((a) => [a.source, a]));
  const groups: SourceGroup[] = [];
  const bySource = new Map<string, SourceGroup>();
  for (const s of statements) {
    let group = bySource.get(s.source);
    if (!group) {
      const meta = labelBySource.get(s.source);
      group = {
        source: s.source,
        label: meta?.label ?? s.source,
        hidden: meta?.hidden ?? false,
        statements: [],
        missingAnchors: 0,
      };
      bySource.set(s.source, group);
      groups.push(group);
    }
    group.statements.push(s); // API order: uploaded_at DESC
    if (s.closing_balance === null) group.missingAnchors += 1;
  }
  groups.sort((a, b) => a.source.localeCompare(b.source));

  // A synced (SimpleFIN) source's rolling `<source>.sync` record isn't backed
  // by a re-uploadable file — the remove dialog needs different restore copy.
  const targetIsSync = removeTarget?.filename.endsWith(".sync") ?? false;

  return (
    <>
      <Card className="rounded-none ring-0 border border-border py-0 gap-0 mb-3">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className={labelClass}>Statements</span>
          <span className={labelClass}>
            {statements.length} loaded
          </span>
        </div>

        {groups.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            No statements yet — upload your first PDF or OFX at{" "}
            <Link href="/upload" className="link">
              /upload
            </Link>
            .
          </p>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <details key={g.source} className={`group ${g.hidden ? "opacity-60" : ""}`}>
                <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 cursor-pointer list-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
                  <span
                    className="font-mono text-xs tracking-widest flex-1 min-w-24 truncate"
                    title={g.source}
                  >
                    {g.label}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {g.statements.length} statement{g.statements.length === 1 ? "" : "s"}
                  </span>
                  {g.missingAnchors > 0 && (
                    <span
                      className="font-mono text-[10px] tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground/70 shrink-0"
                      title="Statements without a closing balance can't anchor net worth or the cash-flow forecast."
                    >
                      {g.missingAnchors} no anchor
                    </span>
                  )}
                  <span className="font-mono text-xs text-muted-foreground shrink-0 group-open:hidden">+</span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0 hidden group-open:inline">−</span>
                </summary>
                <div>
                  {g.statements.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-t border-border/50"
                    >
                      <div className="flex-1 min-w-48">
                        <p className="font-mono text-xs truncate" title={s.filename}>
                          {s.filename}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.period} · uploaded {formatUploaded(s.uploaded_at)}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground shrink-0">
                        {s.row_count} txns
                      </span>
                      {s.closing_balance !== null ? (
                        <span
                          className="font-mono text-xs shrink-0"
                          title="Closing balance as printed — the net-worth / forecast anchor."
                        >
                          {formatCents(s.closing_balance)}
                        </span>
                      ) : (
                        <span
                          className="font-mono text-[10px] tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground/60 shrink-0"
                          title="No closing balance captured — this statement can't anchor net worth or the cash-flow forecast."
                        >
                          No balance anchor
                        </span>
                      )}
                      <button
                        onClick={() => openRemove(s)}
                        className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        aria-label={`Remove ${s.filename}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}

        <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          Original files are parsed, then discarded — never stored. To re-parse a
          statement: remove it here, then re-upload the file at{" "}
          <Link href="/upload" className="link">
            /upload
          </Link>
          . Dedup makes re-uploading safe — nothing double-counts.
        </p>
      </Card>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase text-destructive">
              Remove statement
            </DialogTitle>
          </DialogHeader>
          {removeTarget && (
            <div className="space-y-3 text-sm">
              <p className="font-mono text-xs break-all text-muted-foreground">
                {removeTarget.filename}
              </p>
              <p>
                Deletes this statement record{" "}
                <span className="font-bold">
                  and its {removeTarget.row_count} transaction
                  {removeTarget.row_count === 1 ? "" : "s"}
                </span>
                , including any category overrides and splits on them. Rules and
                goals are untouched.
              </p>
              <p className="text-muted-foreground text-xs">
                {targetIsSync
                  ? "This is a synced account's rolling record — a future sync only picks up new activity, so removed history comes back only by reconnecting the account or uploading an OFX export."
                  : "Re-uploading the same file restores everything — dedup makes re-upload idempotent, so nothing will double-count."}
              </p>
              {removeError && (
                <p className="font-mono text-xs text-destructive">{removeError}</p>
              )}
              <Button
                variant="destructive"
                disabled={busy}
                onClick={handleRemove}
                className="rounded-none font-mono text-xs tracking-widest uppercase"
              >
                Remove statement
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
