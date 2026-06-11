"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { categoryColor } from "@/lib/colors";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Transaction {
  id: number;
  source: string;
  txn_date: string;
  description: string;
  amount: number;
  effective_category: string;
  flow: string;
  has_override: number;
}

const CUSTOM_CATEGORY = "__custom__";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [flow, setFlow] = useState<string>("spend");
  const [loading, setLoading] = useState(true);

  // Recategorize dialog
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickCategory, setPickCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState<string>("one");
  const [saving, setSaving] = useState(false);

  const limit = 50;

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (search) params.set("search", search);
    if (category && category !== "all") params.set("category", category);
    if (source && source !== "all") params.set("source", source);
    if (flow && flow !== "all") params.set("flow", flow);

    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();
    setTransactions(data.rows);
    setTotal(data.total);
    setCategories(data.categories);
    setLoading(false);
  }, [page, search, category, source, flow]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    setPage(1);
  }, [search, category, source, flow]);

  const totalPages = Math.ceil(total / limit);

  const formatAmount = (amount: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(amount);

  const openRecategorize = (tx: Transaction) => {
    setSelected(tx);
    setPickCategory(tx.effective_category);
    setCustomCategory("");
    setKeyword(tx.description.trim());
    setMode("one");
    setDialogOpen(true);
  };

  const targetCategory =
    pickCategory === CUSTOM_CATEGORY ? customCategory.trim() : pickCategory;

  const finishRecategorize = () => {
    setSaving(false);
    setDialogOpen(false);
    setSelected(null);
    fetchTransactions();
  };

  const handleOverride = async () => {
    if (!selected || !targetCategory) return;
    setSaving(true);
    await fetch("/api/categories/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: selected.id,
        new_category: targetCategory,
      }),
    });
    finishRecategorize();
  };

  const handleAddRule = async () => {
    if (!selected || !targetCategory || !keyword.trim()) return;
    setSaving(true);
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: targetCategory,
        keyword: keyword.trim(),
        apply_existing: true,
      }),
    });
    finishRecategorize();
  };

  const handleRevert = async () => {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/categories/override?transaction_id=${selected.id}`, {
      method: "DELETE",
    });
    finishRecategorize();
  };

  // The select lists known spend categories; make sure the row's current
  // category (e.g. 'Banking' on chequing rows) is always present.
  const dialogCategories =
    selected && !categories.includes(selected.effective_category)
      ? [selected.effective_category, ...categories]
      : categories;

  return (
    <div className="p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
        TRANSACTIONS
      </h1>

      <Tabs value={flow} onValueChange={setFlow} className="mb-4">
        <TabsList variant="line">
          <TabsTrigger value="spend" className="font-mono text-xs tracking-widest">
            SPEND
          </TabsTrigger>
          <TabsTrigger value="all" className="font-mono text-xs tracking-widest">
            ALL
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <InputGroup className="max-w-xs">
          <InputGroupAddon align="inline-start">
            <InputGroupText>⌕</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono text-sm"
          />
        </InputGroup>
        <Select value={category} onValueChange={(v) => setCategory(v ?? "all")}>
          <SelectTrigger className="w-[200px] font-mono text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-xs">
              ALL CATEGORIES
            </SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c} className="font-mono text-xs">
                {c.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setSource(v ?? "all")}>
          <SelectTrigger className="w-[160px] font-mono text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-xs">ALL SOURCES</SelectItem>
            <SelectItem value="amex" className="font-mono text-xs">AMEX</SelectItem>
            <SelectItem value="cibc_visa" className="font-mono text-xs">CIBC VISA</SelectItem>
            <SelectItem value="cibc_chequing" className="font-mono text-xs">CIBC CHEQUING</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs tracking-widest">DATE</TableHead>
                <TableHead className="font-mono text-xs tracking-widest">DESCRIPTION</TableHead>
                <TableHead className="font-mono text-xs tracking-widest">CATEGORY</TableHead>
                <TableHead className="font-mono text-xs tracking-widest">SOURCE</TableHead>
                <TableHead className="font-mono text-xs tracking-widest text-right">AMOUNT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No transactions found. Upload a statement first.
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow
                    key={tx.id}
                    onClick={() => openRecategorize(tx)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs">{tx.txn_date}</TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{tx.description}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(tx.effective_category) }}
                        />
                        {tx.effective_category}
                        {tx.has_override ? (
                          <span
                            className="text-muted-foreground"
                            title="Manual override"
                          >
                            ✱
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs uppercase">{tx.source}</TableCell>
                    <TableCell className="font-mono text-sm text-right">
                      {formatAmount(tx.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground font-mono">
            {total} transactions · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="font-mono text-xs"
            >
              PREV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="font-mono text-xs"
            >
              NEXT
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono tracking-widest uppercase">
              RECATEGORIZE
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="border p-3">
                <p className="text-sm font-medium break-words">{selected.description}</p>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  {selected.txn_date} · {selected.source.toUpperCase()} ·{" "}
                  {formatAmount(selected.amount)}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                    <span
                      className="inline-block w-2 h-2 shrink-0"
                      style={{
                        backgroundColor: categoryColor(selected.effective_category),
                      }}
                    />
                    {selected.effective_category}
                  </span>
                  {selected.has_override ? (
                    <>
                      <span className="font-mono text-xs text-muted-foreground">
                        ✱ MANUAL OVERRIDE
                      </span>
                      <button
                        onClick={handleRevert}
                        disabled={saving}
                        className="font-mono text-xs tracking-widest uppercase underline underline-offset-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        REVERT TO RULES
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  NEW CATEGORY
                </label>
                <Select
                  value={pickCategory}
                  onValueChange={(v) => setPickCategory(v ?? "")}
                >
                  <SelectTrigger className="w-full mt-1 font-mono text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {dialogCategories.map((c) => (
                      <SelectItem key={c} value={c} className="font-mono text-xs">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(c) }}
                        />
                        {c.toUpperCase()}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_CATEGORY} className="font-mono text-xs">
                      + NEW CATEGORY…
                    </SelectItem>
                  </SelectContent>
                </Select>
                {pickCategory === CUSTOM_CATEGORY && (
                  <Input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. Rent / housing"
                    className="mt-2 font-mono"
                    autoFocus
                  />
                )}
              </div>

              <Tabs value={mode} onValueChange={setMode}>
                <TabsList variant="line">
                  <TabsTrigger
                    value="one"
                    className="font-mono text-xs tracking-widest"
                  >
                    JUST THIS ONE
                  </TabsTrigger>
                  <TabsTrigger
                    value="rule"
                    className="font-mono text-xs tracking-widest"
                  >
                    ADD RULE
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {mode === "one" ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Sets a manual override on this transaction only. Overrides
                    survive RECATEGORIZE ALL and feed the rule suggestions on the
                    Categories page.
                  </p>
                  <Button
                    onClick={handleOverride}
                    disabled={
                      saving ||
                      !targetCategory ||
                      targetCategory === selected.effective_category
                    }
                    className="w-full font-mono text-xs tracking-widest uppercase"
                  >
                    {saving ? "SAVING..." : "APPLY TO THIS TRANSACTION"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="font-mono text-xs tracking-widest text-muted-foreground">
                      KEYWORD
                    </label>
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="e.g. STARBUCKS"
                      className="mt-1 font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Case-insensitive substring match. Applies to all matching
                      transactions (manual overrides excluded) and to future
                      uploads. Trim it to the stable part of the merchant name.
                    </p>
                  </div>
                  {selected.source === "cibc_chequing" &&
                    ["income", "payment", "fee_interest"].includes(selected.flow) && (
                      <p className="text-xs text-muted-foreground border p-2">
                        Rules never reclassify chequing income / payment / fee
                        rows, so this rule won't change this transaction — use
                        JUST THIS ONE for that.
                      </p>
                    )}
                  {selected.source === "cibc_chequing" &&
                    selected.flow === "transfer" && (
                      <p className="text-xs text-muted-foreground border p-2">
                        Chequing transfers only pick up your own categories from
                        rules — built-in card categories won't stick. Use JUST
                        THIS ONE for those.
                      </p>
                    )}
                  <Button
                    onClick={handleAddRule}
                    disabled={saving || !targetCategory || !keyword.trim()}
                    className="w-full font-mono text-xs tracking-widest uppercase"
                  >
                    {saving ? "SAVING..." : "ADD RULE & APPLY"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
