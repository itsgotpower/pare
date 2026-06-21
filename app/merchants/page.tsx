"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryColor } from "@/lib/colors";

interface MerchantSummary {
  slug: string;
  merchant: string;
  category: string;
  total: number;
  count: number;
  avg: number;
  months: number;
  firstDate: string;
  lastDate: string;
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then((d) => setMerchants(d.merchants ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter((m) => m.merchant.toLowerCase().includes(q));
  }, [merchants, search]);

  const grandTotal = useMemo(
    () => filtered.reduce((s, m) => s + m.total, 0),
    [filtered]
  );

  return (
    <div className="p-4 md:p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
        MERCHANTS
      </h1>
      <p className="text-xs text-muted-foreground font-mono mb-6">
        {merchants.length} merchants · {formatCurrency(grandTotal)} card spend
      </p>

      <div className="mb-6">
        <InputGroup className="w-full sm:w-80">
          <InputGroupAddon align="inline-start">
            <InputGroupText>⌕</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search merchants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono text-sm"
          />
        </InputGroup>
      </div>

      {/* Phones: tappable list rows */}
      <Card className="md:hidden">
        <CardContent className="p-0">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground text-sm">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground text-sm">
              No merchants found. Upload a card statement first.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((m) => (
                <Link
                  key={m.slug}
                  href={`/merchants/${m.slug}`}
                  className="block px-4 py-3 active:bg-accent transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm truncate min-w-0">{m.merchant}</p>
                    <span className="font-mono text-sm shrink-0">
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono min-w-0">
                      <span
                        className="inline-block w-2 h-2 shrink-0"
                        style={{ backgroundColor: categoryColor(m.category) }}
                      />
                      <span className="truncate">{m.category}</span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground uppercase shrink-0">
                      {m.count}× · {formatCurrency(m.avg)} avg
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs tracking-widest">MERCHANT</TableHead>
                <TableHead className="font-mono text-xs tracking-widest">CATEGORY</TableHead>
                <TableHead className="font-mono text-xs tracking-widest text-right">CHARGES</TableHead>
                <TableHead className="font-mono text-xs tracking-widest text-right">AVG</TableHead>
                <TableHead className="font-mono text-xs tracking-widest text-right">TOTAL</TableHead>
                <TableHead className="font-mono text-xs tracking-widest text-right">LAST SEEN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No merchants found. Upload a card statement first.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((m) => (
                  <TableRow
                    key={m.slug}
                    className="cursor-pointer"
                    onClick={() => {
                      window.location.href = `/merchants/${m.slug}`;
                    }}
                  >
                    <TableCell className="text-sm max-w-xs truncate">
                      <Link
                        href={`/merchants/${m.slug}`}
                        className="hover:underline underline-offset-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.merchant}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(m.category) }}
                        />
                        {m.category}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">
                      {m.count}×
                    </TableCell>
                    <TableCell className="font-mono text-sm text-right">
                      {formatCurrency(m.avg)}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-right font-medium">
                      {formatCurrency(m.total)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-right text-muted-foreground">
                      {m.lastDate}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
