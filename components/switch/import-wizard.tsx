"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ImportPreview } from "@/lib/import/preview";
import type { AccountMapping } from "@/lib/import/normalizer";
import type { AccountKind } from "@/lib/db/account-kinds";
import { ImportsList } from "./imports-list";

const ACCOUNT_KINDS: AccountKind[] = [
  "card",
  "chequing",
  "savings",
  "cash",
  "investment",
  "unknown",
];

const PROVIDER_LABELS: Record<string, string> = {
  monarch: "Monarch Money",
  mint: "Mint",
  ynab: "YNAB",
};

// Preview payload = ImportPreview plus the category dropdown options the route adds.
type PreviewResponse = ImportPreview & { categoryOptions: string[] };

interface CommitResult {
  importId: number;
  inserted: number;
  skipped: number;
  dropped: number;
  total: number;
}

type Step = "upload" | "map" | "review" | "done";

const selectClass =
  "border border-border bg-background font-mono text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-foreground";
const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [providerChoices, setProviderChoices] = useState<string[] | null>(null);
  const [providerPick, setProviderPick] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [accountMap, setAccountMap] = useState<Record<string, AccountMapping>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needAuth, setNeedAuth] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const runPreview = useCallback(async (theFile: File, provider?: string) => {
    setBusy(true);
    setError(null);
    setNeedAuth(false);
    try {
      const fd = new FormData();
      fd.append("file", theFile);
      if (provider) fd.append("provider", provider);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      if (res.status === 401) {
        setNeedAuth(true);
        return;
      }
      const data = await res.json();
      if (res.status === 422 && data.error === "unknown_provider") {
        setProviderChoices(data.providers as string[]);
        setError("Couldn't auto-detect the source app — pick it below.");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Preview failed");
        return;
      }
      const p = data as PreviewResponse;
      setPreview(p);
      // Seed the editable maps from the server's suggestions.
      const am: Record<string, AccountMapping> = {};
      for (const a of p.accounts) am[a.foreignAccount] = { ...a.suggested };
      const cm: Record<string, string> = {};
      for (const c of p.categories) cm[c.foreignCategory] = c.suggested;
      setAccountMap(am);
      setCategoryMap(cm);
      setProviderChoices(null);
      setStep("map");
    } catch {
      setError("Preview failed — check the server console");
    } finally {
      setBusy(false);
    }
  }, []);

  const onPick = useCallback(
    async (f: File) => {
      setFile(f);
      setCsvText(await f.text());
      await runPreview(f);
    },
    [runPreview]
  );

  const commit = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: preview.provider,
          csv: csvText,
          accountMap,
          categoryMap,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setNeedAuth(true);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }
      setResult(data as CommitResult);
      setRefreshKey((k) => k + 1);
      setStep("done");
    } catch {
      setError("Import failed — check the server console");
    } finally {
      setBusy(false);
    }
  }, [preview, csvText, accountMap, categoryMap]);

  function reset() {
    setStep("upload");
    setFile(null);
    setCsvText("");
    setPreview(null);
    setResult(null);
    setError(null);
    setProviderChoices(null);
    setProviderPick("");
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {needAuth && (
        <Card className="border-foreground">
          <CardContent className="py-4 text-sm">
            You need to be signed in to import.{" "}
            <Link href="/login?from=/switch" className="link font-medium">
              Sign in
            </Link>{" "}
            and come back — your history and categories import in one pass.
          </CardContent>
        </Card>
      )}

      {error && !needAuth && (
        <Card className="border-destructive">
          <CardContent className="py-3 font-mono text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {step === "upload" && (
        <UploadStep
          busy={busy}
          providerChoices={providerChoices}
          providerPick={providerPick}
          setProviderPick={setProviderPick}
          onPick={onPick}
          onRetryWithProvider={() => file && providerPick && runPreview(file, providerPick)}
        />
      )}

      {step === "map" && preview && (
        <MapStep
          preview={preview}
          accountMap={accountMap}
          setAccountMap={setAccountMap}
          categoryMap={categoryMap}
          setCategoryMap={setCategoryMap}
          onBack={reset}
          onNext={() => setStep("review")}
        />
      )}

      {step === "review" && preview && (
        <ReviewStep
          preview={preview}
          accountMap={accountMap}
          categoryMap={categoryMap}
          busy={busy}
          onBack={() => setStep("map")}
          onCommit={commit}
        />
      )}

      {step === "done" && result && (
        <Card>
          <CardContent className="py-6 space-y-3">
            <h3 className="font-mono text-sm font-bold tracking-widest uppercase">Import complete</h3>
            <p className="text-sm">
              <span className="font-mono font-bold">{result.inserted}</span> transactions imported
              {result.skipped > 0 && <> · {result.skipped} skipped as duplicates</>}
              {result.dropped > 0 && <> · {result.dropped} dropped (bad date/amount)</>}.
            </p>
            <div className="flex gap-3 pt-1">
              <Link href="/dashboard">
                <Button>Go to dashboard</Button>
              </Link>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ImportsList refreshKey={refreshKey} />
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ["upload", "1 · Upload"],
    ["map", "2 · Map"],
    ["review", "3 · Review"],
  ];
  const order: Step[] = ["upload", "map", "review", "done"];
  const idx = order.indexOf(step);
  return (
    <div className="flex gap-[1px] bg-border border border-border">
      {steps.map(([s, label]) => {
        const active = step === s;
        const done = order.indexOf(s) < idx;
        return (
          <div
            key={s}
            className={`flex-1 bg-card px-3 py-2 font-mono text-[10px] tracking-widest uppercase ${
              active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/50"
            }`}
          >
            {label}
            {done && " ✓"}
          </div>
        );
      })}
    </div>
  );
}

function UploadStep({
  busy,
  providerChoices,
  providerPick,
  setProviderPick,
  onPick,
  onRetryWithProvider,
}: {
  busy: boolean;
  providerChoices: string[] | null;
  providerPick: string;
  setProviderPick: (v: string) => void;
  onPick: (f: File) => void;
  onRetryWithProvider: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div className="space-y-4">
      <Card
        className={`border-2 transition-colors cursor-pointer ${
          dragOver ? "border-foreground bg-accent" : "border-dashed border-muted-foreground/30"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onPick(f);
        }}
      >
        <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
          <p className="font-mono text-sm tracking-widest uppercase text-muted-foreground">
            {busy ? "ANALYZING…" : "DROP YOUR EXPORTED CSV HERE"}
          </p>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            Export your transactions from Monarch, Mint, or YNAB and drop the CSV here. Nothing is
            written until you review the mapping.
          </p>
          <label className="mt-1">
            <span className="inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase cursor-pointer hover:bg-foreground hover:text-background transition-colors">
              BROWSE FILES
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {providerChoices && (
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <span className={labelClass}>Source app</span>
            <select
              className={selectClass}
              value={providerPick}
              onChange={(e) => setProviderPick(e.target.value)}
            >
              <option value="">Select…</option>
              {providerChoices.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p] ?? p}
                </option>
              ))}
            </select>
            <Button disabled={!providerPick || busy} onClick={onRetryWithProvider}>
              Continue
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MapStep({
  preview,
  accountMap,
  setAccountMap,
  categoryMap,
  setCategoryMap,
  onBack,
  onNext,
}: {
  preview: PreviewResponse;
  accountMap: Record<string, AccountMapping>;
  setAccountMap: (m: Record<string, AccountMapping>) => void;
  categoryMap: Record<string, string>;
  setCategoryMap: (m: Record<string, string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className={labelClass}>Accounts → kind</p>
        <p className="text-xs text-muted-foreground mt-1 mb-2">
          The kind drives which charts each account feeds. Cards count as spend; chequing feeds
          cash-flow.
        </p>
        <div className="border border-border divide-y divide-border">
          {preview.accounts.map((a) => (
            <div key={a.foreignAccount} className="flex items-center justify-between px-3 py-2 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-sm truncate">{a.foreignAccount}</p>
                <p className="text-[11px] text-muted-foreground">{a.txnCount} transactions</p>
              </div>
              <select
                className={selectClass}
                value={accountMap[a.foreignAccount]?.account_kind ?? "unknown"}
                onChange={(e) =>
                  setAccountMap({
                    ...accountMap,
                    [a.foreignAccount]: {
                      ...accountMap[a.foreignAccount],
                      account_kind: e.target.value as AccountKind,
                    },
                  })
                }
              >
                {ACCOUNT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={labelClass}>Categories → Pare categories</p>
        <p className="text-xs text-muted-foreground mt-1 mb-2">
          Highlighted rows weren&apos;t auto-matched — assign them or leave as Other.
        </p>
        <div className="border border-border divide-y divide-border max-h-[420px] overflow-auto">
          {preview.categories.map((c) => (
            <div
              key={c.foreignCategory || "(uncategorized)"}
              className={`flex items-center justify-between px-3 py-2 gap-3 ${
                c.isUnknown ? "bg-accent/40" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-mono text-sm truncate">
                  {c.foreignCategory || "(uncategorized)"}
                </p>
                <p className="text-[11px] text-muted-foreground">{c.txnCount} transactions</p>
              </div>
              <select
                className={selectClass}
                value={categoryMap[c.foreignCategory] ?? "Other / uncategorized"}
                onChange={(e) =>
                  setCategoryMap({ ...categoryMap, [c.foreignCategory]: e.target.value })
                }
              >
                {preview.categoryOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Start over
        </Button>
        <Button onClick={onNext}>Review →</Button>
      </div>
    </div>
  );
}

function ReviewStep({
  preview,
  accountMap,
  categoryMap,
  busy,
  onBack,
  onCommit,
}: {
  preview: PreviewResponse;
  accountMap: Record<string, AccountMapping>;
  categoryMap: Record<string, string>;
  busy: boolean;
  onBack: () => void;
  onCommit: () => void;
}) {
  const willImport = preview.rowCount - preview.dropped.length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-border border border-border">
        <Stat label="To import" value={String(willImport)} />
        <Stat label="Dropped" value={String(preview.dropped.length)} />
        <Stat label="From" value={preview.dateRange.min ?? "—"} />
        <Stat label="To" value={preview.dateRange.max ?? "—"} />
      </div>
      {preview.dateOrder === "dmy" && (
        <p className="font-mono text-xs text-muted-foreground">
          SLASH DATES READ AS DD/MM/YYYY (detected from the file). Check the sample dates below.
        </p>
      )}

      <div>
        <p className={labelClass}>Sample (first {preview.sample.length} rows)</p>
        <div className="border border-border mt-2 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left font-mono uppercase text-[10px] tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5">Kind</th>
                <th className="px-2 py-1.5">Category</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.txn_date}</td>
                  <td className="px-2 py-1.5 truncate max-w-[220px]">{r.description}</td>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">
                    {accountMap[r.foreignAccount]?.account_kind ?? r.account_kind}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {categoryMap[r.foreignCategory] ?? r.category}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-right">{r.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Card className="border-muted-foreground/30">
        <CardContent className="py-3 text-xs text-muted-foreground leading-relaxed">
          Imported transactions become a historical backfill. If you later upload PDF statements
          that overlap this date range, Pare skips the duplicates at the seam. Inter-account
          transfers can appear twice in exports — eyeball the sample above for doubles before
          importing. You can undo this whole import in one click afterward.
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button disabled={busy || willImport === 0} onClick={onCommit}>
          {busy ? "Importing…" : `Import ${willImport} transactions`}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2">
      <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-sm font-bold mt-0.5">{value}</p>
    </div>
  );
}
