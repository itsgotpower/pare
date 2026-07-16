"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatMonthShort,
  formatMonthFull,
  formatK,
  CHART_TOOLTIP_STYLE,
  MONO_TICK,
} from "@/lib/format";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

interface ManualEntry {
  id: number;
  name: string;
  kind: "asset" | "liability";
  amount: number;
  effective_date: string;
  note: string | null;
}

interface NetWorthAccount {
  name: string;
  label?: string; // nickname from /profile account management — display only
  type: "statement" | "manual";
  kind: "asset" | "liability";
  current: number;
  asOf: string;
  closed?: boolean; // marked closed on /profile — no longer carries forward
}

interface NetWorthPoint {
  month: string;
  net: number;
  assets: number;
  liabilities: number;
  balances: Record<string, number>;
}

export interface NetWorth {
  series: NetWorthPoint[];
  accounts: NetWorthAccount[];
  entries: ManualEntry[];
  current: {
    month: string;
    net: number;
    assets: number;
    liabilities: number;
    delta: number | null;
  } | null;
}

export function NetWorthTab({
  initial,
  tooltipTrigger,
}: {
  initial: NetWorth | null;
  tooltipTrigger: "hover" | "click";
}) {
  const [netWorth, setNetWorth] = useState<NetWorth | null>(initial);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ManualEntry | null>(null);
  const [entryName, setEntryName] = useState("");
  const [entryKind, setEntryKind] = useState<"asset" | "liability">("asset");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refetchNetWorth = useCallback(() => {
    fetch("/api/summary?type=net_worth")
      .then((r) => r.json())
      .then(setNetWorth);
  }, []);

  // The panel unmounts when the tab is inactive — refetch on mount so edits
  // made in a previous visit aren't reverted by the page's stale initial data.
  useEffect(() => {
    refetchNetWorth();
  }, [refetchNetWorth]);

  const resetEntryForm = () => {
    setEditingEntry(null);
    setEntryName("");
    setEntryKind("asset");
    setEntryAmount("");
    setEntryDate("");
    setEntryNote("");
    setEntryError(null);
  };

  const handleEditEntry = (entry: ManualEntry) => {
    setEditingEntry(entry);
    setEntryName(entry.name);
    setEntryKind(entry.kind);
    setEntryAmount(String(entry.amount));
    setEntryDate(entry.effective_date);
    setEntryNote(entry.note || "");
    setEntryError(null);
    setEntryDialogOpen(true);
  };

  const handleSaveEntry = async () => {
    if (!entryName.trim() || !entryAmount || !entryDate) return;
    const payload = {
      id: editingEntry?.id,
      name: entryName,
      kind: entryKind,
      amount: parseFloat(entryAmount),
      effective_date: entryDate,
      note: entryNote || null,
    };
    const res = await fetch("/api/networth", {
      method: editingEntry ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setEntryError(d.error || "Couldn't save entry — try again.");
      return;
    }
    setEntryDialogOpen(false);
    resetEntryForm();
    refetchNetWorth();
  };

  const handleDeleteEntry = async (id: number) => {
    setDeleteError(null);
    const res = await fetch(`/api/networth?id=${id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setDeleteError(d.error || "Couldn't remove entry — try again.");
      return;
    }
    refetchNetWorth();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        <p className="text-xs text-muted-foreground max-w-xl min-w-[220px] flex-1">
          Statement-cadence net worth — closing balances from each statement
          (chequing positive, card balances as debt) plus manual entries.
          Balances carry forward between statements; point-in-time by design.
        </p>
        <Dialog
          open={entryDialogOpen}
          onOpenChange={(open) => {
            setEntryDialogOpen(open);
            if (!open) resetEntryForm();
          }}
        >
          <DialogTrigger className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground">
            ADD ENTRY
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-mono tracking-widest uppercase">
                {editingEntry ? "EDIT ENTRY" : "ADD ASSET / LIABILITY"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  NAME
                </label>
                <Input
                  value={entryName}
                  onChange={(e) => setEntryName(e.target.value)}
                  placeholder="Questrade TFSA"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-xs tracking-widest text-muted-foreground">
                    KIND
                  </label>
                  <Select
                    value={entryKind}
                    onValueChange={(v) => setEntryKind((v as "asset" | "liability") ?? "asset")}
                  >
                    <SelectTrigger className="mt-1 font-mono text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asset" className="font-mono text-xs">
                        ASSET
                      </SelectItem>
                      <SelectItem value="liability" className="font-mono text-xs">
                        LIABILITY
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="font-mono text-xs tracking-widest text-muted-foreground">
                    AMOUNT
                  </label>
                  <InputGroup className="mt-1">
                    <InputGroupAddon align="inline-start">
                      <InputGroupText>$</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      type="number"
                      min="0"
                      value={entryAmount}
                      onChange={(e) => setEntryAmount(e.target.value)}
                      placeholder="25000"
                      className="font-mono"
                    />
                  </InputGroup>
                </div>
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  EFFECTIVE DATE
                </label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Re-add the same name with a newer date to update its value —
                  history builds the trend.
                </p>
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  NOTE (OPTIONAL)
                </label>
                <Input
                  value={entryNote}
                  onChange={(e) => setEntryNote(e.target.value)}
                  placeholder="vehicle, est. resale"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              {entryError && (
                <p className="font-mono text-xs text-destructive">{entryError}</p>
              )}
              <Button
                onClick={handleSaveEntry}
                disabled={!entryName.trim() || !entryAmount || !entryDate}
                className="w-full font-mono text-xs tracking-widest uppercase"
              >
                {editingEntry ? "UPDATE ENTRY" : "ADD ENTRY"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!netWorth || netWorth.series.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground mb-4">
              NO BALANCE DATA
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Closing balances are captured on upload. Re-upload your statements
              to backfill them, or add a manual asset/liability entry.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
          {/* Net worth trend — 2 cols */}
          <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              NET WORTH TREND
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={netWorth.series}>
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonthShort}
                  tick={MONO_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={MONO_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatK}
                />
                <Tooltip
                  trigger={tooltipTrigger}
                  formatter={(value, name) => {
                    const labels: Record<string, string> = {
                      net: "Net worth",
                      assets: "Assets",
                      liabilities: "Liabilities",
                    };
                    return [formatCurrency(Number(value)), labels[String(name)] || String(name)];
                  }}
                  labelFormatter={(v) => formatMonthFull(String(v))}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Line
                  type="stepAfter"
                  dataKey="assets"
                  stroke={PALETTE.sage}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="4 3"
                />
                <Line
                  type="stepAfter"
                  dataKey="liabilities"
                  stroke={PALETTE.terracotta}
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="4 3"
                />
                <Line
                  type="stepAfter"
                  dataKey="net"
                  stroke="currentColor"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "currentColor" }}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              <span className="flex items-center gap-1.5 text-xs font-mono">
                <span className="w-2 h-0.5 inline-block bg-foreground" />
                NET
              </span>
              <span className="flex items-center gap-1.5 text-xs font-mono">
                <span className="w-2 h-0.5 inline-block" style={{ backgroundColor: PALETTE.sage }} />
                ASSETS
              </span>
              <span className="flex items-center gap-1.5 text-xs font-mono">
                <span className="w-2 h-0.5 inline-block" style={{ backgroundColor: PALETTE.terracotta }} />
                LIABILITIES
              </span>
            </div>
          </div>

          {/* Balance breakdown */}
          <div className="row-span-2 bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              BALANCES
            </h2>
            <div className="space-y-3">
              {netWorth.accounts.map((a) => (
                <div key={a.name} className="flex items-start justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 inline-block shrink-0"
                      style={{
                        backgroundColor:
                          a.kind === "asset" ? PALETTE.sage : PALETTE.terracotta,
                      }}
                    />
                    <div className="min-w-0">
                      <p className="font-mono truncate">
                        {a.label ?? a.name}
                        {a.closed && (
                          <span className="ml-2 border border-border px-1 py-px text-[9px] tracking-widest uppercase text-muted-foreground">
                            Closed
                          </span>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        {a.type === "manual" ? "manual · " : ""}as of {a.asOf}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-medium shrink-0">
                    {a.current < 0 ? "−" : ""}
                    {formatCurrency(Math.abs(a.current))}
                  </span>
                </div>
              ))}
            </div>
            {netWorth.current && (
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  NET
                </span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {netWorth.current.net < 0 ? "−" : ""}
                  {formatCurrency(Math.abs(netWorth.current.net))}
                </span>
              </div>
            )}
          </div>

          {/* Stat cards */}
          {netWorth.current && (
            <>
              <div className="bg-card p-4 md:p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  NET WORTH
                </h2>
                <p
                  className="font-mono text-3xl font-bold"
                  style={{
                    color: netWorth.current.net >= 0 ? PALETTE.sage : PALETTE.terracotta,
                  }}
                >
                  {netWorth.current.net >= 0 ? "" : "−"}
                  {formatCurrency(Math.abs(netWorth.current.net))}
                </p>
                {netWorth.current.delta !== null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {netWorth.current.delta >= 0 ? "▲" : "▼"}{" "}
                    {formatCurrency(Math.abs(netWorth.current.delta))} vs last month
                  </p>
                )}
              </div>
              <div className="bg-card p-4 md:p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  ASSETS
                </h2>
                <p className="font-mono text-3xl font-bold">
                  {formatCurrency(netWorth.current.assets)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  as of {formatMonthFull(netWorth.current.month)}
                </p>
              </div>
              <div className="bg-card p-4 md:p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  LIABILITIES
                </h2>
                <p className="font-mono text-3xl font-bold">
                  {formatCurrency(netWorth.current.liabilities)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  card balances{netWorth.entries.some((e) => e.kind === "liability") ? " + manual" : ""}
                </p>
              </div>
            </>
          )}

          {/* Manual entries — full width */}
          <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              MANUAL ENTRIES
            </h2>
            {deleteError && (
              <p className="font-mono text-xs text-destructive mb-3">{deleteError}</p>
            )}
            {netWorth.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet — add investments, a vehicle, or other balances that
                don&apos;t come from statements.
              </p>
            ) : (
              <div className="space-y-2">
                {netWorth.entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-muted-foreground w-20 shrink-0">
                        {e.effective_date}
                      </span>
                      <span
                        className="inline-block w-2 h-2 shrink-0"
                        style={{
                          backgroundColor:
                            e.kind === "asset" ? PALETTE.sage : PALETTE.terracotta,
                        }}
                      />
                      <span className="font-mono truncate">{e.name}</span>
                      {e.note && (
                        <span className="text-muted-foreground truncate hidden sm:inline">
                          {e.note}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-medium tabular-nums w-24 text-right">
                        {e.kind === "liability" ? "−" : ""}
                        {formatCurrency(e.amount)}
                      </span>
                      <button
                        onClick={() => handleEditEntry(e)}
                        className="text-muted-foreground hover:text-foreground font-mono"
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => handleDeleteEntry(e.id)}
                        className="text-muted-foreground hover:text-foreground font-mono"
                      >
                        REMOVE
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
