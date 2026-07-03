"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency, formatCents } from "@/lib/format";
import Link from "next/link";
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
import { BillCalendar } from "@/components/recurring/bill-calendar";
import { cancelGuide } from "@/lib/cancel-guides";

interface PriceChange {
  from: number;
  to: number;
  pct: number;
}

interface Subscription {
  merchant: string;
  slug: string;
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
  priceChange: PriceChange | null;
  lapsed: boolean;
  markedAt: string | null;
  markedMonthlyCost: number;
  chargedSinceMark: number;
}

function SubBadges({ s }: { s: Subscription }) {
  return (
    <>
      {s.priceChange && s.priceChange.pct > 0 && !s.lapsed && (
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
          style={{ borderColor: PALETTE.mustard, color: PALETTE.mustard }}
          title={`${formatCents(s.priceChange.from)} → ${formatCents(s.priceChange.to)} per charge`}
        >
          HIKE +{s.priceChange.pct}%
        </span>
      )}
      {s.multiPerMonth && (
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
          style={{ borderColor: PALETTE.terracotta, color: PALETTE.terracotta }}
          title="Charged 2+ times in a month — verify you're not double-subscribed"
        >
          2×/MO?
        </span>
      )}
      {s.lapsed && (
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
          style={{ borderColor: PALETTE.sage, color: PALETTE.sage }}
          title={`No charge since ${s.lastDate}`}
        >
          GONE
        </span>
      )}
      {s.markedAt && !s.lapsed && s.chargedSinceMark > 0 && (
        <span
          className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
          style={{ borderColor: PALETTE.terracotta, color: PALETTE.terracotta }}
          title={`Marked to cancel ${s.markedAt}, still charging`}
        >
          {formatCurrency(s.chargedSinceMark)} SINCE MARK
        </span>
      )}
    </>
  );
}

function RowActions({
  s,
  onToggle,
  busy,
}: {
  s: Subscription;
  onToggle: (s: Subscription) => void;
  busy: boolean;
}) {
  const guide = cancelGuide(s.merchant);
  return (
    <div className="flex items-center gap-3 shrink-0">
      {s.markedAt && !s.lapsed && (
        <a
          href={guide.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] tracking-widest underline underline-offset-2 hover:text-foreground text-muted-foreground"
          title={guide.note}
        >
          CANCEL ↗
        </a>
      )}
      <button
        onClick={() => onToggle(s)}
        disabled={busy}
        className={`font-mono text-[10px] tracking-widest px-1.5 py-0.5 border transition-colors disabled:opacity-50 ${
          s.markedAt
            ? "text-muted-foreground border-border hover:text-foreground"
            : "border-border hover:bg-foreground hover:text-background"
        }`}
      >
        {s.markedAt ? "UNMARK" : "MARK TO CANCEL"}
      </button>
    </div>
  );
}

export default function RecurringPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/recurring")
      .then((r) => r.json())
      .then((data) => {
        setSubs(data.subscriptions || []);
        setMonthlyTotal(data.monthlyTotal || 0);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleMark = useCallback(
    (s: Subscription) => {
      setBusySlug(s.slug);
      fetch("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          s.markedAt
            ? { action: "unmark", slug: s.slug }
            : {
                action: "mark",
                slug: s.slug,
                merchant: s.merchant,
                monthlyCost: s.monthlyCost,
              }
        ),
      })
        .then(() => load())
        .finally(() => setBusySlug(null));
    },
    [load]
  );

  const flagged = subs.filter(
    (s) => !s.lapsed && (s.multiPerMonth || (s.priceChange && s.priceChange.pct > 0))
  );
  const marked = subs.filter((s) => s.markedAt);
  const markedLive = marked.filter((s) => !s.lapsed);
  const markedGone = marked.filter((s) => s.lapsed);
  const atStakeYearly = markedLive.reduce((t, s) => t + s.markedMonthlyCost * 12, 0);
  const savedYearly = markedGone.reduce((t, s) => t + s.markedMonthlyCost * 12, 0);
  const bleeding = markedLive.reduce((t, s) => t + s.chargedSinceMark, 0);

  return (
    <div className="p-4 md:p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
        RECURRING
      </h1>
      <p className="text-xs text-muted-foreground mb-6">
        Charges that repeat across 3+ months — detected by stable amount + cadence,
        or known recurring merchants. Mark the ones you mean to cancel; Pare keeps
        score until the charges actually stop.
      </p>

      <BillCalendar />

      {loading ? (
        <p className="text-muted-foreground font-mono text-sm">LOADING...</p>
      ) : subs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              NO RECURRING CHARGES DETECTED — NEED 3+ MONTHS OF DATA
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className={`grid grid-cols-1 ${marked.length ? "md:grid-cols-4" : "md:grid-cols-3"} gap-[1px] bg-border border border-border mb-6`}
          >
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                MONTHLY RECURRING
              </h2>
              <p className="font-mono text-3xl font-bold">{formatCurrency(monthlyTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {subs.filter((s) => !s.lapsed).length} active recurring charges
              </p>
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
                double-bills + price hikes
              </p>
            </div>
            {marked.length > 0 && (
              <div className="bg-card p-4 md:p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  CANCEL LIST
                </h2>
                <p
                  className="font-mono text-3xl font-bold"
                  style={{
                    color: bleeding > 0 ? PALETTE.terracotta : PALETTE.sage,
                  }}
                >
                  {formatCurrency(atStakeYearly)}
                  <span className="text-sm font-normal">/yr</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {bleeding > 0
                    ? `${formatCurrency(bleeding)} charged since you marked`
                    : markedGone.length
                    ? `stopped — saving ${formatCurrency(savedYearly)}/yr`
                    : `${markedLive.length} marked, no charges since`}
                </p>
              </div>
            )}
          </div>

          {/* Phones: list rows instead of the seven-column table */}
          <Card className="md:hidden">
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {subs.map((s, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(s.category) }}
                        />
                        <Link
                          href={`/merchants/${s.slug}`}
                          className="text-sm truncate hover:underline underline-offset-2"
                        >
                          {s.merchant}
                        </Link>
                        <SubBadges s={s} />
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
                    <div className="flex justify-end mt-2">
                      <RowActions s={s} onToggle={toggleMark} busy={busySlug === s.slug} />
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
                    <TableHead className="font-mono text-xs tracking-widest text-right">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s, i) => (
                    <TableRow key={i} className={s.lapsed ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/merchants/${s.slug}`}
                            className="text-sm hover:underline underline-offset-2"
                          >
                            {s.merchant}
                          </Link>
                          <SubBadges s={s} />
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
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <RowActions s={s} onToggle={toggleMark} busy={busySlug === s.slug} />
                        </div>
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
