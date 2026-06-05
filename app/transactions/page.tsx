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

interface Transaction {
  id: number;
  source: string;
  txn_date: string;
  description: string;
  amount: number;
  effective_category: string;
  flow: string;
}

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
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-xs">{tx.txn_date}</TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{tx.description}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border text-xs font-mono">
                        <span
                          className="inline-block w-2 h-2 shrink-0"
                          style={{ backgroundColor: categoryColor(tx.effective_category) }}
                        />
                        {tx.effective_category}
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
    </div>
  );
}
