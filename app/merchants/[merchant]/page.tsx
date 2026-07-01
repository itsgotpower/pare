"use client";

import { useState, useEffect } from "react";
import { formatCents as formatCurrency } from "@/lib/format";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryColor } from "@/lib/colors";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MerchantMonthly {
  month: string;
  total: number;
  count: number;
}
interface MerchantCategorySplit {
  category: string;
  total: number;
  count: number;
}
interface MerchantTxn {
  id: number;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  source: string;
}
interface MerchantDetail {
  slug: string;
  merchant: string;
  total: number;
  count: number;
  avg: number;
  typical: number;
  months: number;
  monthlyAvg: number;
  firstDate: string;
  lastDate: string;
  frequency: string;
  monthly: MerchantMonthly[];
  categories: MerchantCategorySplit[];
  transactions: MerchantTxn[];
}


// "2025-03" -> "MAR" / "MAR 2025"
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const formatMonthShort = (m: string) => MONTHS[parseInt(m.slice(5, 7), 10) - 1] ?? m;
const formatMonthFull = (m: string) => `${formatMonthShort(m)} ${m.slice(0, 4)}`;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card p-4 md:p-6">
      <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
        {label}
      </p>
      <p className="font-mono text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="font-mono text-[10px] text-muted-foreground mt-1 uppercase">{sub}</p>}
    </div>
  );
}

export default function MerchantDetailPage() {
  const params = useParams<{ merchant: string }>();
  const slug = params.merchant;

  const [data, setData] = useState<MerchantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/merchants?merchant=${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }, [slug]);

  const maxCat = data ? Math.max(...data.categories.map((c) => c.total), 1) : 1;

  return (
    <div className="p-4 md:p-6">
      <Link
        href="/merchants"
        className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="size-3.5" /> ALL MERCHANTS
      </Link>

      {loading ? (
        <p className="text-muted-foreground text-sm py-8">Loading...</p>
      ) : notFound || !data ? (
        <p className="text-muted-foreground text-sm py-8">
          Merchant not found. It may have no card spend, or the link is stale.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
            <h1 className="font-mono text-2xl font-bold tracking-tight uppercase break-words">
              {data.merchant}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-1 border text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {data.frequency}
            </span>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-border border border-border mb-[1px]">
            <Stat label="Total" value={formatCurrency(data.total)} sub={`${data.count} charges`} />
            <Stat label="Avg charge" value={formatCurrency(data.avg)} sub={`median ${formatCurrency(data.typical)}`} />
            <Stat label="Per month" value={formatCurrency(data.monthlyAvg)} sub={`${data.months} months active`} />
            <Stat
              label="Seen"
              value={data.firstDate.slice(0, 7)}
              sub={`through ${data.lastDate.slice(0, 7)}`}
            />
          </div>

          {/* Monthly trend + category split */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
            <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                MONTHLY SPEND
              </h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.monthly}>
                  <XAxis
                    dataKey="month"
                    tickFormatter={formatMonthShort}
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                  />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                    labelFormatter={(v) => formatMonthFull(String(v))}
                    contentStyle={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      border: "1px solid #000",
                      borderRadius: 0,
                    }}
                  />
                  <Bar dataKey="total" fill={categoryColor(data.categories[0]?.category ?? "")} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                CATEGORIES
              </h2>
              <div className="space-y-3">
                {data.categories.map((c) => (
                  <div key={c.category}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(c.category) }}
                        />
                        <span className="truncate">{c.category}</span>
                      </span>
                      <span className="font-mono shrink-0 ml-2">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="h-1.5 bg-accent">
                      <div
                        className="h-full"
                        style={{
                          width: `${(c.total / maxCat) * 100}%`,
                          backgroundColor: categoryColor(c.category),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Transactions */}
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mt-8 mb-3">
            ALL TRANSACTIONS · {data.count}
          </h2>
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
                  {data.transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">{t.txn_date}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{t.description}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                          <span
                            className="inline-block w-2 h-2 shrink-0"
                            style={{ backgroundColor: categoryColor(t.category) }}
                          />
                          {t.category}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs uppercase">{t.source}</TableCell>
                      <TableCell className="font-mono text-sm text-right">
                        {formatCurrency(t.amount)}
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
