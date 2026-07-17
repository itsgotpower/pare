"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { categoryColor } from "@/lib/colors";

interface Rule {
  id: number;
  category: string;
  keyword: string;
  sort_order: number;
}

interface Suggestion {
  keyword: string;
  category: string;
  count: number;
}

export default function CategoriesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [ruleError, setRuleError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    const res = await fetch("/api/categories");
    const data = await res.json();
    setRules(data.rules);
    setUncategorizedCount(data.uncategorized_count);
    setSuggestions(data.suggestions || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleAdd = async () => {
    if (!newKeyword || !newCategory) return;
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: newKeyword,
        category: newCategory,
        apply_existing: true,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRuleError(data.error || "Couldn't add the rule");
      return;
    }
    setRuleError(null);
    setNewKeyword("");
    setNewCategory("");
    setDialogOpen(false);
    fetchRules();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/categories?id=${id}`, { method: "DELETE" });
    fetchRules();
  };

  const handleAcceptSuggestion = async (s: Suggestion) => {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: s.keyword,
        category: s.category,
        apply_existing: true,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Couldn't add the rule");
    }
    fetchRules();
  };

  const handleRejectSuggestion = async (s: Suggestion) => {
    // Optimistic: drop it from the list immediately; the dismissal persists
    // server-side so it never comes back.
    setSuggestions((prev) =>
      prev.filter((x) => !(x.keyword === s.keyword && x.category === s.category))
    );
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dismiss_suggestion",
        keyword: s.keyword,
        category: s.category,
      }),
    });
  };

  const [recategorizing, setRecategorizing] = useState(false);

  const handleRecategorizeAll = async () => {
    setRecategorizing(true);
    await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recategorize_all" }),
    });
    setRecategorizing(false);
    fetchRules();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Download the current rules as JSON in the exact shape IMPORT RULES accepts
  // ({ category_rules: [...] } — the same key as the full /api/data export), so
  // export → import round-trips between instances.
  const handleExportRules = () => {
    const payload = JSON.stringify(
      { category_rules: rules.map((r) => ({ category: r.category, keyword: r.keyword })) },
      null,
      2
    );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pare-rules.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setImportMsg(null);
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text());
      // Accept a full /api/data JSON export or a bare rules array.
      const body = Array.isArray(parsed)
        ? { action: "import_rules", rules: parsed }
        : { action: "import_rules", category_rules: parsed.category_rules };
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportMsg(data.error || "Import failed");
      } else {
        const parts = [`${data.added} added`, `${data.updated} updated`];
        if (data.skipped) parts.push(`${data.skipped} skipped`);
        setImportMsg(`${parts.join(", ")} · ${data.recategorized} transactions recategorized`);
        fetchRules();
      }
    } catch {
      setImportMsg("Couldn't read that file — expected a Pare JSON export");
    } finally {
      setImporting(false);
    }
  };

  const categories = [...new Set(rules.map((r) => r.category))];
  const filteredRules = filter
    ? rules.filter(
        (r) =>
          r.keyword.toLowerCase().includes(filter.toLowerCase()) ||
          r.category.toLowerCase().includes(filter.toLowerCase())
      )
    : rules;

  const groupedByCategory = categories.map((cat) => ({
    category: cat,
    rules: filteredRules.filter((r) => r.category === cat),
  })).filter((g) => g.rules.length > 0);

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
          CATEGORIES
        </h1>
        <p className="text-muted-foreground font-mono text-sm">LOADING...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">
            CATEGORIES
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {rules.length} rules · {categories.length} categories
            {uncategorizedCount > 0 && (
              <span className="ml-2 text-foreground font-medium">
                · {uncategorizedCount} uncategorized transactions
              </span>
            )}
          </p>
          {importMsg && (
            <p className="font-mono text-xs text-muted-foreground mt-1">{importMsg}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Import a rules JSON export from another Pare instance"
            className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            {importing ? "IMPORTING..." : "IMPORT RULES"}
          </button>
          <button
            onClick={handleExportRules}
            title="Download your rules as JSON — the file IMPORT RULES accepts on any Pare instance"
            className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground"
          >
            EXPORT RULES
          </button>
          <button
            onClick={handleRecategorizeAll}
            disabled={recategorizing}
            title="Re-apply every rule to all transactions (your manual overrides are never touched)"
            className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            {recategorizing ? "WORKING..." : "RECATEGORIZE ALL"}
          </button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); setRuleError(null); }}>
            <DialogTrigger className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground">
              ADD RULE
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-mono tracking-widest uppercase">
                ADD CATEGORY RULE
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  KEYWORD
                </label>
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="e.g. STARBUCKS"
                  className="mt-1 font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Case-insensitive substring match on merchant descriptions
                </p>
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  CATEGORY
                </label>
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="e.g. Coffee"
                  className="mt-1 font-mono"
                  list="category-suggestions"
                />
                <datalist id="category-suggestions">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              {ruleError && (
                <p className="font-mono text-xs text-destructive">{ruleError}</p>
              )}
              <Button
                onClick={handleAdd}
                className="w-full font-mono text-xs tracking-widest uppercase"
              >
                ADD RULE & RECATEGORIZE
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {suggestions.length > 0 && (
        <Card className="mb-6 border-foreground">
          <CardContent className="py-4">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-3">
              SUGGESTED RULES (FROM YOUR OVERRIDES)
            </h2>
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-t first:border-t-0"
              >
                <div>
                  <span className="font-mono text-sm font-medium">"{s.keyword}"</span>
                  <span className="text-muted-foreground text-sm"> → {s.category}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {s.count > 0
                      ? `(would match ${s.count} more)`
                      : "(covers future charges)"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAcceptSuggestion(s)}
                    className="font-mono text-xs"
                  >
                    ACCEPT
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRejectSuggestion(s)}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    REJECT
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-4">
        <Input
          placeholder="Filter rules..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="font-mono text-sm max-w-xs"
        />
      </div>

      <div className="space-y-6">
        {groupedByCategory.map(({ category, rules: catRules }) => (
          <Card key={category}>
            <CardContent className="py-4">
              <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-3 flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5"
                  style={{ backgroundColor: categoryColor(category) }}
                />
                {category}
                <Badge variant="secondary" className="ml-1 font-mono">
                  {catRules.length}
                </Badge>
              </h3>
              <div className="flex flex-wrap gap-2">
                {catRules.map((rule) => (
                  <span
                    key={rule.id}
                    className="inline-flex items-center gap-1 px-2 py-1 border text-xs font-mono group"
                  >
                    {rule.keyword}
                    {/* No hover on touch — keep the delete × visible there */}
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 ml-1 px-1 -mr-1 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
