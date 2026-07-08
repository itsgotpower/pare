"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REPO_URL = "https://github.com/itsgotpower/pare";
const MESSAGE_MAX = 2000;

const KINDS = [
  { value: "bug", label: "BUG" },
  { value: "idea", label: "IDEA" },
  { value: "other", label: "OTHER" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

// Deploy mode decides where feedback goes: hosted -> POST /api/feedback (the
// shared store bauer exports); self-host -> a GitHub-issues link (feedback
// never phones home from a self-host install). Probed at runtime from the
// route's tokenless GET — same detect-don't-configure approach as /login.
type Mode = "loading" | "hosted" | "self";

export function FeedbackDialog({
  trigger,
  triggerClassName,
  triggerTitle,
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("loading");
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const probeMode = async () => {
    try {
      const res = await fetch("/api/feedback");
      const data = res.ok ? await res.json() : null;
      setMode(data?.hosted ? "hosted" : "self");
    } catch {
      // Can't distinguish the modes on a network error; GitHub works everywhere.
      setMode("self");
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setError(null);
    if (next) {
      setStatus("idle");
      if (mode === "loading") void probeMode();
    }
  };

  const handleSend = async () => {
    if (!message.trim()) {
      setError("Write a message first.");
      return;
    }
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus("idle");
        setError(data?.error ?? "Something went wrong. Try again.");
        return;
      }
      setStatus("sent");
      setMessage("");
      setEmail("");
    } catch {
      setStatus("idle");
      setError("Network error. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger className={triggerClassName} title={triggerTitle}>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono tracking-widest uppercase">
            FEEDBACK
          </DialogTitle>
        </DialogHeader>

        {mode === "loading" && (
          <p className="mt-4 font-mono text-xs tracking-widest text-muted-foreground">
            LOADING…
          </p>
        )}

        {mode === "self" && (
          <div className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              This is a self-hosted build, so feedback goes through GitHub —
              nothing leaves your machine from here.
            </p>
            <a
              href={`${REPO_URL}/issues/new`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground"
            >
              OPEN A GITHUB ISSUE ↗
            </a>
          </div>
        )}

        {mode === "hosted" && status === "sent" && (
          <div className="space-y-4 mt-4">
            <p className="font-mono text-sm tracking-widest">THANKS — LOGGED.</p>
            <Button
              onClick={() => setOpen(false)}
              className="w-full font-mono text-xs tracking-widest uppercase"
            >
              DONE
            </Button>
          </div>
        )}

        {mode === "hosted" && status !== "sent" && (
          <div className="space-y-4 mt-4">
            <div>
              <label className="font-mono text-xs tracking-widest text-muted-foreground">
                TYPE
              </label>
              <div className="mt-1 grid grid-cols-3 border border-input">
                {KINDS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    className={`px-2 py-2 font-mono text-xs tracking-widest transition-colors ${
                      kind === value
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor="feedback-message"
                className="font-mono text-xs tracking-widest text-muted-foreground"
              >
                MESSAGE
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MESSAGE_MAX}
                rows={5}
                placeholder="What's broken, missing, or annoying?"
                className="mt-1 w-full border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>
            <div>
              <label
                htmlFor="feedback-email"
                className="font-mono text-xs tracking-widest text-muted-foreground"
              >
                EMAIL <span className="normal-case">(optional — only if you want a reply)</span>
              </label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 font-mono text-sm"
              />
            </div>
            {error && <p className="font-mono text-xs text-destructive">{error}</p>}
            <Button
              onClick={handleSend}
              disabled={status === "sending"}
              className="w-full font-mono text-xs tracking-widest uppercase"
            >
              {status === "sending" ? "SENDING…" : "SEND FEEDBACK"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
