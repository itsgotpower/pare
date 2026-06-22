"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Copy, Check, RefreshCw } from "lucide-react";

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
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Fallback for non-secure contexts (mirrors components/connect/copy-block).
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
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
    <Card className="rounded-none ring-0 border border-border py-0 gap-0 mb-3">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className={labelClass}>Statement inbox</span>
        <span className={`${labelClass} hidden sm:inline`}>Forward · parse · done</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
        <Mail className="size-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-56">
          <p className="font-mono text-sm font-bold break-all">{address}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Forward a statement email here (or set a bank auto-forward rule) and the
            PDF is parsed into your account automatically.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={copy}
          className="rounded-none font-mono text-xs tracking-widest uppercase shrink-0"
        >
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2.5">
        {confirmRotate ? (
          <>
            <span className="text-xs text-muted-foreground flex-1 min-w-48">
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
            <span className="text-xs text-muted-foreground flex-1 min-w-48">
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
    </Card>
  );
}
