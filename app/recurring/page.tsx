"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryColor, PALETTE } from "@/lib/colors";

interface Subscription {
  merchant: string;
  category: string;
  charges: number;
  months: number;
  typical: number;
  monthlyCost: number;
  annualCost: number;
  frequency: string;
  variableAmount: boolean;
  multiPerMonth: boolean;
  lastDate: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

const formatCents = (value: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value);

export default function RecurringPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/recurring")
      .then((r) => r.json())
      .then((data) => {
        setSubs(data.subscriptions || []);
        setMonthlyTotal(data.monthlyTotal || 0);
        setLoading(false);
      });
  }, []);

  const flagged = subs.filter((s) => s.multiPerMonth);

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
          RECURRING
        </h1>
        <p className="text-muted-foreground font-mono text-sm">LOADING...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
        RECURRING
      </h1>
      <p className="text-xs text-muted-foreground mb-6">
        Charges that repeat across 3+ months — detected by stable amount + cadence,
        or known recurring merchants. Review these to find subscriptions to cut.
      </p>

      {subs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              NO RECURRING CHARGES DETECTED — NEED 3+ MONTHS OF DATA
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border mb-6">
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                MONTHLY RECURRING
              </h2>
              <p className="font-mono text-3xl font-bold">{formatCurrency(monthlyTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">{subs.length} recurring charges</p>
            </div>
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                ANNUALIZED
              </h2>
              <p className="font-mono text-3xl font-bold">{formatCurrency(monthlyTotal * 12)}</p>
              <p className="text-xs text-muted-foreground mt-1">per year at this rate</p>
            </div>
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                TO REVIEW
              </h2>
              <p
                className="font-mono text-3xl font-bold"
                style={{ color: flagged.length ? PALETTE.terracotta : undefined }}
              >
                {flagged.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                charged 2+ times in a month
              </p>
            </div>
          </div>

          {/* Phones: list rows instead of the six-column table */}
          <Card className="md:hidden">
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {subs.map((s, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(s.category) }}
                        />
                        <span className="text-sm truncate">{s.merchant}</span>
                        {s.multiPerMonth && (
                          <span
                            className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
                            style={{ borderColor: PALETTE.terracotta, color: PALETTE.terracotta }}
                          >
                            2×/MO?
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-sm font-medium shrink-0">
                        {formatCents(s.monthlyCost)}
                        <span className="text-muted-foreground font-normal text-xs">/mo</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {s.frequency}
                        {s.variableAmount ? " · variable" : ""}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatCents(s.typical)} typical · {formatCurrency(s.annualCost)}/yr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs tracking-widest">MERCHANT</TableHead>
                    <TableHead className="font-mono text-xs tracking-widest">CATEGORY</TableHead>
                    <TableHead className="font-mono text-xs tracking-widest">FREQUENCY</TableHead>
                    <TableHead className="font-mono text-xs tracking-widest text-right">TYPICAL</TableHead>
                    <TableHead className="font-mono text-xs tracking-widest text-right">PER MONTH</TableHead>
                    <TableHead className="font-mono text-xs tracking-widest text-right">PER YEAR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{s.merchant}</span>
                          {s.multiPerMonth && (
                            <span
                              className="font-mono text-[10px] px-1.5 py-0.5 border"
                              style={{ borderColor: PALETTE.terracotta, color: PALETTE.terracotta }}
                              title="Charged 2+ times in a month — verify you're not double-subscribed"
                            >
                              2×/MO?
                            </span>
                          )}
                          {s.variableAmount && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              variable
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono">
                          <span
                            className="inline-block w-2 h-2 shrink-0"
                            style={{ backgroundColor: categoryColor(s.category) }}
                          />
                          {s.category}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.frequency}</TableCell>
                      <TableCell className="font-mono text-sm text-right">
                        {formatCents(s.typical)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-right font-medium">
                        {formatCents(s.monthlyCost)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-right text-muted-foreground">
                        {formatCurrency(s.annualCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
