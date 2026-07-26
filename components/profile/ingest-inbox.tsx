"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw } from "lucide-react";
import { copyText } from "@/lib/clipboard";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

// STATEMENT INBOX — the per-user email-ingest address. Forwarding a bank
// statement email here drops the PDF into the same parse pipeline as a drag-drop
// upload. Hosted-only: the profile page mounts this card only in hosted
// multi-user mode, and it self-hides if the address can't be loaded (e.g. the
// /api/ingest route 404s in self-host).
export function IngestInbox() {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ingest");
      if (!res.ok) return;
      const data = await res.json();
      setAddress(typeof data.address === "string" ? data.address : null);
    } catch {
      /* leave hidden */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async () => {
    if (!address) return;
    await copyText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      });
      if (res.ok) {
        const data = await res.json();
        setAddress(typeof data.address === "string" ? data.address : null);
      }
    } finally {
      setBusy(false);
      setConfirmRotate(false);
    }
  };

  if (!address) return null;

  return (
    <Card className="rounded-none ring-0 border border-border py-0 gap-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <span className={labelClass}>Statement inbox</span>
        <span className={`${labelClass} hidden sm:inline`}>Forward · parse · done</span>
      </div>
      <div className="px-4 pt-2 pb-4">
        <div className="flex items-center gap-1">
          <p className="font-mono text-sm font-bold break-all min-w-0">{address}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy address"}
            className="rounded-none shrink-0 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Forward a statement email here (or set a bank auto-forward rule) and the
          PDF is parsed into your account automatically.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
          {confirmRotate ? (
            <>
              <span className="text-[11px] text-muted-foreground flex-1 min-w-48">
                Rotating mints a new address — the current one stops working immediately.
              </span>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={rotate}
                className="rounded-none font-mono text-[10px] tracking-widest uppercase"
              >
                <RefreshCw data-icon="inline-start" />
                Rotate now
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmRotate(false)}
                className="rounded-none font-mono text-[10px] tracking-widest uppercase"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="text-[11px] text-muted-foreground flex-1 min-w-48">
                Keep this address private — anyone who has it can add statements to your
                account.
              </span>
              <button
                onClick={() => setConfirmRotate(true)}
                className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                New address →
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
