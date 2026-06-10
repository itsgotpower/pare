"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBlock({ label, text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context — fall back for plain-HTTP (LAN) access.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 h-8">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {label ?? ""}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground hover:text-foreground transition-colors uppercase"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {text}
      </pre>
    </div>
  );
}
