"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { categoryColor } from "@/lib/colors";
import { useSearchHotkey } from "@/lib/use-search-hotkey";
import { deriveKeyword } from "@/lib/db/derive-keyword";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCents } from "@/lib/format";

interface Transaction {
  id: number;
  source: string;
  txn_date: string;
  description: string;
  amount: number;
  effective_category: string;
  flow: string;
  has_override: number;
  has_splits: number;
}

// A saved split part (GET /api/transactions/splits).
interface SplitPartRow {
  id: number;
  transaction_id: number;
  category: string;
  amount: number;
}

// A part being edited in the split dialog (amount kept as the raw input string).
interface SplitPartDraft {
  category: string;
  custom: string;
  amount: string;
}

const CUSTOM_CATEGORY = "__custom__";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  // source → nickname-resolved label (from /api/accounts). Display only: the
  // filter VALUE and query param stay the raw source string (dedup identity).
  const [sourceLabels, setSourceLabels] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [flow, setFlow] = useState<string>("spend");
  const [loading, setLoading] = useState(true);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  // "/" focuses the search box from anywhere; Escape clears it.
  useSearchHotkey("txn-search", () => setSearch(""));

  // Recategorize dialog
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pickCategory, setPickCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState<string>("one");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add-cash dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addCustomCategory, setAddCustomCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCustomCategory, setBulkCustomCategory] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  // Split editor
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitParts, setSplitParts] = useState<SplitPartDraft[]>([]);
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  // The selected row's saved parts (fetched when opening a split row's dialog).
  const [selectedParts, setSelectedParts] = useState<SplitPartRow[] | null>(null);

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
    setSources(data.sources ?? []);
    setLoading(false);
  }, [page, search, category, source, flow]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    setPage(1);
  }, [search, category, source, flow]);

  // Once on mount: AccountInfo.label is already nickname-resolved server-side.
  useEffect(() => {
    fetch("/api/accounts")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { accounts?: { source: string; label: string }[] } | null) => {
        if (!data?.accounts) return;
        setSourceLabels(
          Object.fromEntries(data.accounts.map((a) => [a.source, a.label]))
        );
      })
      .catch(() => {}); // labels fall back to the derived source string
  }, []);

  // Nickname if the map has one, else the derived label (also the pre-fetch
  // and unknown-source fallback).
  const sourceDisplay = (s: string) =>
    sourceLabels[s] ?? s.replace(/_/g, " ").toUpperCase();

  const totalPages = Math.ceil(total / limit);


  const openRecategorize = (tx: Transaction) => {
    // In select mode a row tap/click toggles selection instead of opening the
    // dialog (both renderers route through here).
    if (selectMode) {
      toggleSelected(tx.id);
      return;
    }
    setSelected(tx);
    // A split row's dialog shows its parts — fetch them on open.
    setSelectedParts(null);
    if (tx.has_splits) {
      fetch(`/api/transactions/splits?transaction_id=${tx.id}`)
        .then((r) => r.json())
        .then((d) => setSelectedParts(d.parts ?? []))
        .catch(() => setSelectedParts([]));
    }
    setPickCategory(tx.effective_category);
    setCustomCategory("");
    // Smart-default the keyword to the normalized merchant name ("URBAN FARE"
    // out of "URBAN FARE #7614 VANCOUVER") so one click makes a rule that tags
    // every future charge — not an over-specific one bound to this store/city.
    const derived = deriveKeyword(tx.description);
    setKeyword(derived ?? tx.description.trim());
    // Default to ADD RULE (tag once → auto-tag future) when we have a safe
    // keyword and rules actually apply to this row (spend). Chequing transfers /
    // income — where a rule wouldn't stick — keep the single-row override.
    setMode(derived && tx.flow === "spend" ? "rule" : "one");
    setDialogOpen(true);
  };

  const targetCategory =
    pickCategory === CUSTOM_CATEGORY ? customCategory.trim() : pickCategory;

  const finishRecategorize = () => {
    setSaving(false);
    setSaveError(null);
    setDialogOpen(false);
    setSelected(null);
    fetchTransactions();
  };

  // Shared failure path: keep the dialog open and show why instead of
  // closing as if the change had been saved.
  const failRecategorize = async (res: Response) => {
    const data = await res.json().catch(() => ({}));
    setSaveError(data.error || "Couldn't save the change");
    setSaving(false);
  };

  const handleOverride = async () => {
    if (!selected || !targetCategory) return;
    setSaving(true);
    const res = await fetch("/api/categories/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_id: selected.id,
        new_category: targetCategory,
      }),
    });
    if (!res.ok) return failRecategorize(res);
    finishRecategorize();
  };

  const handleAddRule = async () => {
    if (!selected || !targetCategory || !keyword.trim()) return;
    setSaving(true);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: targetCategory,
        keyword: keyword.trim(),
        apply_existing: true,
      }),
    });
    if (!res.ok) return failRecategorize(res);
    finishRecategorize();
  };

  const handleRevert = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/categories/override?transaction_id=${selected.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return failRecategorize(res);
    finishRecategorize();
  };

  // The select lists known spend categories; make sure the row's current
  // category (e.g. 'Banking' on chequing rows) is always present.
  const dialogCategories =
    selected && !categories.includes(selected.effective_category)
      ? [selected.effective_category, ...categories]
      : categories;

  const activeFilters =
    (category !== "all" ? 1 : 0) + (source !== "all" ? 1 : 0);

  const addTargetCategory =
    addCategory === CUSTOM_CATEGORY ? addCustomCategory.trim() : addCategory;
  const addAmountNumber = parseFloat(addAmount);
  const addValid =
    addDate &&
    addDescription.trim() &&
    addTargetCategory &&
    Number.isFinite(addAmountNumber) &&
    addAmountNumber > 0;

  const openAddCash = (open: boolean) => {
    setAddOpen(open);
    setAddError(null);
    if (open) {
      // toLocaleDateString("en-CA") = local YYYY-MM-DD (UTC would shift the
      // date after ~4pm Pacific).
      setAddDate(new Date().toLocaleDateString("en-CA"));
      setAddAmount("");
      setAddDescription("");
      setAddCategory("");
      setAddCustomCategory("");
    }
  };

  const handleAddCash = async () => {
    if (!addValid) return;
    setAdding(true);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txn_date: addDate,
        description: addDescription.trim(),
        amount: addAmountNumber,
        category: addTargetCategory,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error || "Couldn't add the transaction");
      setAdding(false);
      return;
    }
    setAdding(false);
    setAddOpen(false);
    fetchTransactions();
  };

  const handleDeleteManual = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/transactions?id=${selected.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return failRecategorize(res);
    finishRecategorize();
  };

  // --- Bulk select -----------------------------------------------------------

  const toggleSelectMode = () => {
    setSelectMode((m) => !m);
    setSelectedIds(new Set());
    setBulkNotice(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageSelected =
    transactions.length > 0 && transactions.every((tx) => selectedIds.has(tx.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) transactions.forEach((tx) => next.delete(tx.id));
      else transactions.forEach((tx) => next.add(tx.id));
      return next;
    });
  };

  const bulkTargetCategory =
    bulkCategory === CUSTOM_CATEGORY ? bulkCustomCategory.trim() : bulkCategory;

  const openBulkDialog = (open: boolean) => {
    setBulkOpen(open);
    setBulkError(null);
    if (open) {
      setBulkCategory("");
      setBulkCustomCategory("");
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkTargetCategory || selectedIds.size === 0) return;
    setBulkSaving(true);
    const res = await fetch("/api/categories/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_ids: [...selectedIds],
        new_category: bulkTargetCategory,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBulkError(data.error || "Couldn't apply the category");
      setBulkSaving(false);
      return;
    }
    const data = await res.json();
    setBulkNotice(
      `${data.updated} updated, ${data.skipped} skipped${
        data.skipped ? " (split rows keep their splits)" : ""
      }`
    );
    setBulkSaving(false);
    setBulkOpen(false);
    setSelectedIds(new Set());
    fetchTransactions();
  };

  // --- Split editor ----------------------------------------------------------

  const openSplitEditor = () => {
    if (!selected) return;
    if (selected.has_splits && selectedParts?.length) {
      // EDIT: prefill with the saved parts.
      setSplitParts(
        selectedParts.map((p) => ({
          category: p.category,
          custom: "",
          amount: p.amount.toFixed(2),
        }))
      );
    } else {
      // New split: current category with the full amount, plus an empty part.
      setSplitParts([
        {
          category: selected.effective_category,
          custom: "",
          amount: selected.amount.toFixed(2),
        },
        { category: "", custom: "", amount: "0.00" },
      ]);
    }
    setSplitError(null);
    setSplitOpen(true);
  };

  const updateSplitPart = (i: number, patch: Partial<SplitPartDraft>) =>
    setSplitParts((parts) => parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addSplitPart = () =>
    setSplitParts((parts) => [...parts, { category: "", custom: "", amount: "0.00" }]);

  const removeSplitPart = (i: number) =>
    setSplitParts((parts) => (parts.length > 2 ? parts.filter((_, idx) => idx !== i) : parts));

  // A part's select options: the known categories, plus its own saved category
  // when that isn't in the list (e.g. a custom category from an earlier split).
  const partCategoryOptions = (part: SplitPartDraft) =>
    part.category && part.category !== CUSTOM_CATEGORY && !categories.includes(part.category)
      ? [part.category, ...categories]
      : categories;

  const splitSum = splitParts.reduce((s, p) => {
    const n = parseFloat(p.amount);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
  const splitRemainder = selected
    ? Math.round((selected.amount - splitSum) * 100) / 100
    : 0;
  const splitPartsValid =
    splitParts.length >= 2 &&
    splitParts.every((p) => {
      const cat = p.category === CUSTOM_CATEGORY ? p.custom.trim() : p.category;
      const n = parseFloat(p.amount);
      return cat && Number.isFinite(n) && n > 0;
    });
  const splitValid = splitPartsValid && Math.abs(splitRemainder) < 0.005;

  const handleSaveSplit = async () => {
    if (!selected || !splitValid) return;
    setSplitSaving(true);
    const parts = splitParts.map((p) => ({
      category: p.category === CUSTOM_CATEGORY ? p.custom.trim() : p.category,
      amount: parseFloat(p.amount),
    }));
    const res = await fetch("/api/transactions/splits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: selected.id, parts }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSplitError(data.error || "Couldn't save the split");
      setSplitSaving(false);
      return;
    }
    setSplitSaving(false);
    setSplitOpen(false);
    setDialogOpen(false);
    setSelected(null);
    fetchTransactions();
  };

  const handleRemoveSplit = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await fetch(`/api/transactions/splits?transaction_id=${selected.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return failRecategorize(res);
    finishRecategorize();
  };

  const filterSelects = (
    <>
      <Select value={category} onValueChange={(v) => setCategory(v ?? "all")}>
        <SelectTrigger className="w-full sm:w-[200px] font-mono text-xs">
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
        <SelectTrigger className="w-full sm:w-[160px] font-mono text-xs">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="font-mono text-xs">ALL SOURCES</SelectItem>
          {sources.map((s) => (
            <SelectItem key={s} value={s} className="font-mono text-xs">
              {sourceDisplay(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <div className="p-4 md:p-6">
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

      <div className="flex gap-3 mb-6">
        <InputGroup className="flex-1 sm:flex-none sm:w-72">
          <InputGroupAddon align="inline-start">
            <InputGroupText>⌕</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="txn-search"
            placeholder="Search descriptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono text-sm"
          />
          <InputGroupAddon align="inline-end">
            <kbd className="hidden sm:inline font-mono text-[10px] text-muted-foreground border border-border px-1 py-0.5 leading-none">
              /
            </kbd>
          </InputGroupAddon>
        </InputGroup>
        {/* Phones: category/source live in a bottom sheet */}
        <button
          onClick={() => setFilterSheetOpen(true)}
          className="sm:hidden inline-flex items-center gap-1.5 border border-input bg-background px-3 font-mono text-xs tracking-widest uppercase hover:bg-accent shrink-0"
        >
          FILTERS
          {activeFilters > 0 && (
            <span className="bg-foreground text-background px-1.5 text-[10px]">
              {activeFilters}
            </span>
          )}
        </button>
        <div className="hidden sm:flex gap-3">{filterSelects}</div>
        <button
          onClick={toggleSelectMode}
          className={`inline-flex items-center justify-center border px-3 sm:px-4 font-mono text-xs tracking-widest uppercase shrink-0 sm:ml-auto ${
            selectMode
              ? "border-foreground bg-foreground text-background"
              : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          SELECT
        </button>
        <Dialog open={addOpen} onOpenChange={openAddCash}>
          <DialogTrigger className="inline-flex items-center justify-center border border-input bg-background px-3 sm:px-4 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground shrink-0">
            + ADD CASH
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-mono tracking-widest uppercase">
                ADD CASH TRANSACTION
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <p className="text-xs text-muted-foreground">
                For spending that never hits a statement — cash, someone paid
                back in person, the farmers market. Counts in every spend chart.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-xs tracking-widest text-muted-foreground">
                    DATE
                  </label>
                  <Input
                    type="date"
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="mt-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="font-mono text-xs tracking-widest text-muted-foreground">
                    AMOUNT (CAD)
                  </label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value)}
                    className="mt-1 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  DESCRIPTION
                </label>
                <Input
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  placeholder="e.g. Farmers market"
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  CATEGORY
                </label>
                <Select
                  value={addCategory}
                  onValueChange={(v) => setAddCategory(v ?? "")}
                >
                  <SelectTrigger className="w-full mt-1 font-mono text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
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
                {addCategory === CUSTOM_CATEGORY && (
                  <Input
                    value={addCustomCategory}
                    onChange={(e) => setAddCustomCategory(e.target.value)}
                    placeholder="e.g. Haircuts"
                    className="mt-2 font-mono"
                    autoFocus
                  />
                )}
              </div>
              <Button
                onClick={handleAddCash}
                disabled={adding || !addValid}
                className="w-full font-mono text-xs tracking-widest uppercase"
              >
                {adding ? "ADDING..." : "ADD TRANSACTION"}
              </Button>
              {addError && (
                <p className="font-mono text-xs text-destructive">{addError}</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {bulkNotice && (
        <p className="font-mono text-xs text-muted-foreground -mt-4 mb-4">{bulkNotice}</p>
      )}

      <Dialog open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <DialogContent className="top-auto bottom-0 left-0 translate-x-0 translate-y-0 w-full max-w-full rounded-none border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))] data-open:slide-in-from-bottom-4">
          <DialogHeader>
            <DialogTitle className="font-mono tracking-widest uppercase">
              FILTERS
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {filterSelects}
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  setCategory("all");
                  setSource("all");
                }}
                disabled={activeFilters === 0}
                className="flex-1 font-mono text-xs tracking-widest uppercase"
              >
                CLEAR
              </Button>
              <Button
                onClick={() => setFilterSheetOpen(false)}
                className="flex-1 font-mono text-xs tracking-widest uppercase"
              >
                DONE
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Phones: tappable list rows instead of a five-column table */}
      <Card className="md:hidden">
        <CardContent className="p-0">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              Loading...
            </p>
          ) : transactions.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              No transactions found.{" "}
              <Link href="/upload" className="underline hover:text-foreground transition-colors">
                Upload a statement first.
              </Link>
            </p>
          ) : (
            <div className="divide-y divide-border">
              {transactions.map((tx) => (
                <button
                  key={tx.id}
                  onClick={() => openRecategorize(tx)}
                  className={`w-full text-left px-4 py-3 active:bg-accent transition-colors ${
                    selectMode && selectedIds.has(tx.id) ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {selectMode && (
                      <span
                        aria-hidden
                        className={`inline-block w-3.5 h-3.5 border border-foreground shrink-0 mt-0.5 ${
                          selectedIds.has(tx.id) ? "bg-foreground" : ""
                        }`}
                      />
                    )}
                    <p className="text-sm truncate min-w-0">{tx.description}</p>
                    <span className="font-mono text-sm shrink-0 ml-auto">
                      {formatCents(tx.amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    {tx.has_splits ? (
                      <span className="inline-flex items-center px-2 py-0.5 border text-xs font-mono text-muted-foreground min-w-0">
                        SPLIT
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono min-w-0">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(tx.effective_category) }}
                        />
                        <span className="truncate">{tx.effective_category}</span>
                        {tx.has_override ? (
                          <span className="text-muted-foreground">✱</span>
                        ) : null}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground uppercase shrink-0">
                      {tx.txn_date} · {sourceDisplay(tx.source)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {selectMode && (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      className="accent-foreground"
                      aria-label="Select all on page"
                    />
                  </TableHead>
                )}
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
                  <TableCell colSpan={selectMode ? 6 : 5} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={selectMode ? 6 : 5} className="text-center py-8 text-muted-foreground">
                    No transactions found.{" "}
                    <Link href="/upload" className="underline hover:text-foreground transition-colors">
                      Upload a statement first.
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow
                    key={tx.id}
                    onClick={() => openRecategorize(tx)}
                    className="cursor-pointer"
                  >
                    {selectMode && (
                      <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tx.id)}
                          onChange={() => toggleSelected(tx.id)}
                          className="accent-foreground"
                          aria-label={`Select ${tx.description}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{tx.txn_date}</TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{tx.description}</TableCell>
                    <TableCell>
                      {tx.has_splits ? (
                        <span className="inline-flex items-center px-2 py-0.5 border text-xs font-mono text-muted-foreground">
                          SPLIT
                        </span>
                      ) : (
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
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs uppercase">
                      {sourceDisplay(tx.source)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-right">
                      {formatCents(tx.amount)}
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

      {/* Bulk action bar — sticks to the bottom while a selection exists */}
      {selectMode && selectedIds.size > 0 && (
        <>
          <div className="h-16" aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between gap-3 max-w-3xl mx-auto">
              <span className="font-mono text-xs tracking-widest">
                {selectedIds.size} SELECTED
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => openBulkDialog(true)}
                  className="font-mono text-xs tracking-widest uppercase"
                >
                  CATEGORIZE
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  className="font-mono text-xs tracking-widest uppercase"
                >
                  CLEAR
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <Dialog open={bulkOpen} onOpenChange={openBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono tracking-widest uppercase">
              BULK CATEGORIZE
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              Sets a manual override on {selectedIds.size} selected transaction
              {selectedIds.size === 1 ? "" : "s"}. Overrides survive RECATEGORIZE
              ALL; rows with splits are skipped and keep their splits.
            </p>
            <div>
              <label className="font-mono text-xs tracking-widest text-muted-foreground">
                CATEGORY
              </label>
              <Select
                value={bulkCategory}
                onValueChange={(v) => setBulkCategory(v ?? "")}
              >
                <SelectTrigger className="w-full mt-1 font-mono text-xs">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
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
              {bulkCategory === CUSTOM_CATEGORY && (
                <Input
                  value={bulkCustomCategory}
                  onChange={(e) => setBulkCustomCategory(e.target.value)}
                  placeholder="e.g. Haircuts"
                  className="mt-2 font-mono"
                  autoFocus
                />
              )}
            </div>
            <Button
              onClick={handleBulkAssign}
              disabled={bulkSaving || !bulkTargetCategory || selectedIds.size === 0}
              className="w-full font-mono text-xs tracking-widest uppercase"
            >
              {bulkSaving ? "SAVING..." : `APPLY TO ${selectedIds.size}`}
            </Button>
            {bulkError && (
              <p className="font-mono text-xs text-destructive">{bulkError}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); setSaveError(null); }}>
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
                  {selected.txn_date} · {sourceDisplay(selected.source)} ·{" "}
                  {formatCents(selected.amount)}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  {selected.has_splits ? (
                    <span className="inline-flex items-center px-2 py-0.5 border text-xs font-mono text-muted-foreground">
                      SPLIT
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                      <span
                        className="inline-block w-2 h-2 shrink-0"
                        style={{
                          backgroundColor: categoryColor(selected.effective_category),
                        }}
                      />
                      {selected.effective_category}
                    </span>
                  )}
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

              {selected.has_splits ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    This transaction is split across categories — every chart
                    counts each part under its own category. Remove the split to
                    go back to a single category.
                  </p>
                  <div className="border divide-y divide-border">
                    {(selectedParts ?? []).map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-3 py-2"
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono">
                          <span
                            className="inline-block w-2 h-2 shrink-0"
                            style={{ backgroundColor: categoryColor(p.category) }}
                          />
                          {p.category}
                        </span>
                        <span className="font-mono text-xs">
                          {formatCents(p.amount)}
                        </span>
                      </div>
                    ))}
                    {selectedParts === null && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Loading parts…
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={openSplitEditor}
                      disabled={selectedParts === null || saving}
                      className="flex-1 font-mono text-xs tracking-widest uppercase"
                    >
                      EDIT SPLIT
                    </Button>
                    <button
                      onClick={handleRemoveSplit}
                      disabled={saving}
                      className="flex-1 border border-input font-mono text-xs tracking-widest uppercase text-destructive hover:opacity-80 disabled:opacity-50"
                    >
                      REMOVE SPLIT
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                      Auto-filled from the merchant name (store number and
                      province trimmed). Case-insensitive substring match —
                      applies to all matching transactions (manual overrides
                      excluded) and to future uploads. Edit to broaden or narrow.
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
              {selected.flow === "spend" && (
                <div className="border p-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Multiple things on one charge? Split it across categories —
                    replaces the current category.
                  </p>
                  <button
                    onClick={openSplitEditor}
                    className="font-mono text-xs tracking-widest uppercase underline underline-offset-2 text-muted-foreground hover:text-foreground shrink-0"
                  >
                    SPLIT…
                  </button>
                </div>
              )}
                </>
              )}
              {selected.source === "manual" && (
                <div className="border p-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Quick-added cash entry — not from a statement, safe to
                    remove.
                  </p>
                  <button
                    onClick={handleDeleteManual}
                    disabled={saving}
                    className="font-mono text-xs tracking-widest uppercase underline underline-offset-2 text-destructive hover:opacity-80 disabled:opacity-50 shrink-0"
                  >
                    DELETE ENTRY
                  </button>
                </div>
              )}
              {saveError && (
                <p className="font-mono text-xs text-destructive">{saveError}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={splitOpen}
        onOpenChange={(open) => {
          setSplitOpen(open);
          setSplitError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono tracking-widest uppercase">
              SPLIT TRANSACTION
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 mt-2">
              <div className="border p-3">
                <p className="text-sm font-medium break-words">{selected.description}</p>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  {selected.txn_date} · {formatCents(selected.amount)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Divide this charge across categories — the parts must add up to
                the full amount. Replaces the current category; every chart
                counts each part under its own category. Splits survive
                RECATEGORIZE ALL.
              </p>
              <div className="space-y-2">
                {splitParts.map((part, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 min-w-0">
                      <Select
                        value={part.category}
                        onValueChange={(v) => updateSplitPart(i, { category: v ?? "" })}
                      >
                        <SelectTrigger className="w-full font-mono text-xs">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {partCategoryOptions(part).map((c) => (
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
                      {part.category === CUSTOM_CATEGORY && (
                        <Input
                          value={part.custom}
                          onChange={(e) => updateSplitPart(i, { custom: e.target.value })}
                          placeholder="e.g. Office supplies"
                          className="mt-2 font-mono"
                          autoFocus
                        />
                      )}
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={part.amount}
                      onChange={(e) => updateSplitPart(i, { amount: e.target.value })}
                      className="w-28 font-mono text-right shrink-0"
                      aria-label={`Part ${i + 1} amount`}
                    />
                    <button
                      onClick={() => removeSplitPart(i)}
                      disabled={splitParts.length <= 2}
                      className="border border-input px-2.5 py-1.5 font-mono text-sm hover:bg-accent disabled:opacity-30 shrink-0"
                      aria-label={`Remove part ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={addSplitPart}
                  className="font-mono text-xs tracking-widest uppercase underline underline-offset-2 text-muted-foreground hover:text-foreground"
                >
                  + ADD PART
                </button>
                <p
                  className={`font-mono text-xs ${
                    Math.abs(splitRemainder) < 0.005
                      ? "text-muted-foreground"
                      : "text-destructive"
                  }`}
                >
                  REMAINDER: {formatCents(splitRemainder)}
                </p>
              </div>
              <Button
                onClick={handleSaveSplit}
                disabled={splitSaving || !splitValid}
                className="w-full font-mono text-xs tracking-widest uppercase"
              >
                {splitSaving ? "SAVING..." : "SAVE SPLIT"}
              </Button>
              {splitError && (
                <p className="font-mono text-xs text-destructive">{splitError}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
