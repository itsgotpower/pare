"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ImportRow } from "@/lib/db/imports";

const PROVIDER_LABELS: Record<string, string> = {
  monarch: "Monarch Money",
  mint: "Mint",
  ynab: "YNAB",
};

// Past imports with one-click undo. Re-fetches whenever `refreshKey` changes (a
// commit bumps it). Quietly renders nothing when there are no imports or the
// caller is signed out (401).
export function ImportsList({ refreshKey }: { refreshKey: number }) {
  const [imports, setImports] = useState<ImportRow[] | null>(null);
  const [undoing, setUndoing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/import");
      if (!res.ok) {
        setImports([]);
        return;
      }
      const data = await res.json();
      setImports(data.imports as ImportRow[]);
    } catch {
      setImports([]);
    }
  }, []);

  useEffect(() => {
    // Fetch the imports list on mount and whenever a commit bumps refreshKey.
    // load() only setStates after an awaited fetch (never synchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  const undo = useCallback(
    async (id: number) => {
      if (!confirm("Undo this import? Every transaction it added will be removed.")) return;
      setUndoing(id);
      try {
        await fetch(`/api/import/${id}`, { method: "DELETE" });
        await load();
      } finally {
        setUndoing(null);
      }
    },
    [load]
  );

  if (!imports || imports.length === 0) return null;

  return (
    <div className="pt-2">
      <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-2">
        Previous imports
      </p>
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {imports.map((imp) => (
            <div key={imp.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm">
                  {PROVIDER_LABELS[imp.provider] ?? imp.provider}
                  <span className="text-muted-foreground"> · {imp.row_count} rows</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {imp.date_min && imp.date_max ? `${imp.date_min} → ${imp.date_max}` : "—"} ·
                  imported {imp.imported_at?.slice(0, 10)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={undoing === imp.id}
                onClick={() => undo(imp.id)}
              >
                {undoing === imp.id ? "Undoing…" : "Undo"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
