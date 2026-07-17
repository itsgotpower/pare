"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@/components/ui/input-group";
import { categoryColor, PALETTE } from "@/lib/colors";
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

interface GoalProgress {
  category: string;
  monthly_limit: number;
  spent: number;
  remaining: number;
  percentage: number;
}

interface GoalRecord {
  id: number;
  category: string;
  monthly_limit: number;
}

interface Average {
  category: string;
  avg_monthly: number;
}


export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [averages, setAverages] = useState<Average[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalRecord | null>(null);
  const [newCategory, setNewCategory] = useState<string>("");
  const [newLimit, setNewLimit] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchGoals = useCallback(async () => {
    const res = await fetch("/api/goals");
    const data = await res.json();
    setGoals(data.goals);
    setProgress(data.progress);
    setCategories(data.categories);
    setAverages(data.averages);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const handleAdd = async () => {
    if (!newCategory || !newLimit) return;
    const limit = Number(newLimit);
    if (!Number.isFinite(limit) || limit <= 0) {
      setSaveError("Limit must be a positive number");
      return;
    }
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: newCategory,
        monthly_limit: limit,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error || "Couldn't save the goal");
      return;
    }
    setSaveError(null);
    setNewCategory("");
    setNewLimit("");
    setEditingGoal(null);
    setDialogOpen(false);
    fetchGoals();
  };

  const handleEdit = (goal: GoalRecord) => {
    setEditingGoal(goal);
    setNewCategory(goal.category);
    setNewLimit(String(goal.monthly_limit));
    setDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/goals?id=${id}`, { method: "DELETE" });
    fetchGoals();
  };

  const getSuggestedLimit = (category: string): number | null => {
    const avg = averages.find((a) => a.category === category);
    return avg ? Math.round(avg.avg_monthly) : null;
  };

  const categoriesWithoutGoals = categories.filter(
    (c) => !goals.some((g) => g.category === c)
  );

  const totalBudget = progress.reduce((s, g) => s + g.monthly_limit, 0);
  const totalSpent = progress.reduce((s, g) => s + g.spent, 0);
  const overBudget = progress.filter((g) => g.percentage > 100);

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
          GOALS
        </h1>
        <p className="text-muted-foreground font-mono text-sm">LOADING...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">
            GOALS
          </h1>
          {progress.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(totalSpent)} of {formatCurrency(totalBudget)} this month
              {overBudget.length > 0 && (
                <span className="ml-2 font-medium text-foreground">
                  · {overBudget.length} over budget
                </span>
              )}
            </p>
          )}
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          setSaveError(null);
          if (!open) {
            setEditingGoal(null);
            setNewCategory("");
            setNewLimit("");
          }
        }}>
          <DialogTrigger className="inline-flex items-center justify-center border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground">
            ADD GOAL
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-mono tracking-widest uppercase">
                {editingGoal ? "EDIT GOAL" : "SET SPENDING GOAL"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  CATEGORY
                </label>
                {editingGoal ? (
                  <p className="mt-1 font-mono text-sm flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5"
                      style={{ backgroundColor: categoryColor(editingGoal.category) }}
                    />
                    {editingGoal.category}
                  </p>
                ) : (
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(v ?? "")}>
                    <SelectTrigger className="mt-1 font-mono text-sm">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriesWithoutGoals.map((c) => (
                        <SelectItem key={c} value={c} className="font-mono text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className="font-mono text-xs tracking-widest text-muted-foreground">
                  MONTHLY LIMIT
                </label>
                <InputGroup className="mt-1">
                  <InputGroupAddon align="inline-start">
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    placeholder="400"
                    className="font-mono"
                  />
                </InputGroup>
                {newCategory && getSuggestedLimit(newCategory) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Your 6-month average: {formatCurrency(getSuggestedLimit(newCategory)!)}/mo
                    <button
                      className="ml-2 link"
                      onClick={() =>
                        setNewLimit(String(getSuggestedLimit(newCategory)!))
                      }
                    >
                      use this
                    </button>
                  </p>
                )}
              </div>
              {saveError && (
                <p className="font-mono text-xs text-destructive">{saveError}</p>
              )}
              <Button
                onClick={handleAdd}
                className="w-full font-mono text-xs tracking-widest uppercase"
              >
                {editingGoal ? "UPDATE GOAL" : "SET GOAL"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {progress.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground mb-4">
              NO GOALS SET
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Set monthly spending limits per category to track your progress.
              Suggested limits are based on your 6-month average.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-border border border-border">
          {progress.map((g) => {
            const goal = goals.find((gl) => gl.category === g.category);
            const status =
              g.percentage > 100 ? "over" : g.percentage > 80 ? "warning" : "ok";

            return (
              <div key={g.category} className="bg-card p-4 md:p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5"
                        style={{ backgroundColor: categoryColor(g.category) }}
                      />
                      {g.category}
                    </h3>
                    <p className="font-mono text-2xl font-bold mt-1">
                      {formatCurrency(g.spent)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs text-muted-foreground">
                      of {formatCurrency(g.monthly_limit)}
                    </p>
                    <p
                      className={`font-mono text-sm font-bold mt-1 ${
                        status === "over"
                          ? "text-foreground"
                          : status === "warning"
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60"
                      }`}
                    >
                      {g.percentage.toFixed(0)}%
                    </p>
                  </div>
                </div>
                <div className="h-3 bg-muted">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min(100, g.percentage)}%`,
                      backgroundColor:
                        status === "over"
                          ? PALETTE.terracotta
                          : status === "warning"
                          ? PALETTE.mustard
                          : categoryColor(g.category),
                    }}
                  />
                </div>
                <div className="flex justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    {g.remaining > 0
                      ? `${formatCurrency(g.remaining)} remaining`
                      : `${formatCurrency(Math.abs(g.remaining))} over`}
                  </p>
                  {goal && (
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleEdit(goal)}
                        className="text-xs text-muted-foreground hover:text-foreground font-mono"
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => handleDelete(goal.id)}
                        className="text-xs text-muted-foreground hover:text-foreground font-mono"
                      >
                        REMOVE
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {categoriesWithoutGoals.length > 0 && (
        <div className="mt-8">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-1">
            SUGGESTED GOALS
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Recomputed from your last 6 months of spend every time this page
            loads. Each suggestion trims 10% off your average — the yearly figure
            is what sticking to it would keep in your pocket.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {averages
              .filter((a) => categoriesWithoutGoals.includes(a.category))
              .slice(0, 6)
              .map((a) => {
                // Suggested limit = 90% of the 6-month average, rounded to a
                // clean $10 — a goal equal to your average changes nothing.
                const suggested = Math.max(10, Math.round((a.avg_monthly * 0.9) / 10) * 10);
                const yearlySaving = Math.round((a.avg_monthly - suggested) * 12);
                return (
                  <Card key={a.category}>
                    <CardContent className="py-4">
                      <p className="font-mono text-xs">{a.category}</p>
                      <p className="font-mono text-lg font-bold">
                        {formatCurrency(suggested)}
                        <span className="text-xs text-muted-foreground font-normal">
                          /mo limit
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(a.avg_monthly)}/mo average now
                        {yearlySaving > 0 && (
                          <>
                            {" "}
                            · keeps ~
                            <span className="text-foreground font-medium">
                              {formatCurrency(yearlySaving)}/yr
                            </span>
                          </>
                        )}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 font-mono text-xs w-full"
                        onClick={async () => {
                          await fetch("/api/goals", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              category: a.category,
                              monthly_limit: suggested,
                            }),
                          });
                          fetchGoals();
                        }}
                      >
                        SET AS GOAL
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
