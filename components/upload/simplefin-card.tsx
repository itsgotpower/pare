"use client";

// CONNECT VIA SIMPLEFIN — the opt-in "bring your own aggregator" card on
// /upload. Renders NOTHING until the status GET confirms the feature exists
// (self-host, not disabled), so hosted deployments and PARE_SIMPLEFIN_DISABLED
// self-hosts never see it. PDF/OFX drag-drop above stays the default path.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SfinAccount {
  id: string;
  name: string;
  org: string | null;
  currency: string | null;
  kind: string;
  enabled: boolean;
  synced: boolean;
}

interface SfinStatus {
  connected: boolean;
  bridge?: string;
  autoSync?: boolean;
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncErrors?: string[];
  accounts?: SfinAccount[];
}

interface SyncResult {
  inserted: number;
  skipped: number;
  total: number;
  errors: string[];
}

const KINDS = [
  ["chequing", "CHEQUING"],
  ["savings", "SAVINGS"],
  ["card", "CARD"],
  ["investment", "INVESTMENT"],
] as const;

const BRIDGE_URL = "https://beta-bridge.simplefin.org/";

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SimplefinCard() {
  // null = status unknown (or feature absent) → render nothing.
  const [status, setStatus] = useState<SfinStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"claim" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    fetch("/api/simplefin")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setStatus(data))
      .catch(() => {});
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>, action: typeof busy) => {
      setBusy(action);
      setError(null);
      try {
        const res = await fetch("/api/simplefin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Request failed");
          return null;
        }
        return data;
      } catch {
        setError("Request failed — check the server console");
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const claim = useCallback(async () => {
    const data = await post({ action: "claim", token }, "claim");
    if (data) {
      setStatus(data);
      setToken("");
    }
  }, [post, token]);

  const syncNow = useCallback(async () => {
    const data = await post({ action: "sync" }, "sync");
    if (data) {
      setResult(data);
      const fresh = await fetch("/api/simplefin").then((r) => r.json()).catch(() => null);
      if (fresh) setStatus(fresh);
    }
  }, [post]);

  const disconnect = useCallback(async () => {
    if (!window.confirm("Disconnect SimpleFIN? Synced transactions stay; the stored access URL is deleted.")) return;
    const data = await post({ action: "disconnect" }, "disconnect");
    if (data) {
      setStatus({ connected: false });
      setResult(null);
    }
  }, [post]);

  const configure = useCallback(
    async (updates: Record<string, { kind?: string; enabled?: boolean }>, autoSync?: boolean) => {
      const data = await post({ action: "configure", accounts: updates, autoSync }, null);
      if (data) setStatus(data);
    },
    [post]
  );

  if (!status) return null;

  const btn =
    "inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase cursor-pointer hover:bg-foreground hover:text-background transition-colors disabled:opacity-50 disabled:cursor-default";

  if (!status.connected) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            OR: CONNECT A BANK (SIMPLEFIN)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Optional automatic sync. Your bank login lives at{" "}
            <a
              href={BRIDGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              SimpleFIN Bridge
            </a>{" "}
            — a read-only service you pay directly (US$15/yr) and can revoke any
            time. Pare never sees your credentials; it pulls transactions with a
            token you paste once. Prefer zero third parties? Keep uploading
            statements above — nothing changes.
          </p>
          <ol className="text-xs text-muted-foreground list-decimal ml-4 space-y-1">
            <li>Create a bridge account + connect your banks there</li>
            <li>
              Generate a <span className="font-mono">setup token</span>
              {" under “New App Connection”"}
            </li>
            <li>Paste it here</li>
          </ol>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="PASTE SETUP TOKEN"
            rows={2}
            className="w-full border border-muted-foreground/30 bg-transparent p-2 font-mono text-xs focus:outline-none focus:border-foreground"
          />
          <div className="flex items-center gap-3">
            <button className={btn} disabled={busy === "claim" || !token.trim()} onClick={claim}>
              {busy === "claim" ? "CONNECTING..." : "CONNECT"}
            </button>
          </div>
          {error && <p className="font-mono text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const accounts = status.accounts ?? [];
  const bridgeErrors = status.lastSyncErrors ?? [];

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
          SIMPLEFIN — CONNECTED
        </CardTitle>
        <span className="font-mono text-xs text-muted-foreground">
          {status.lastSyncedAt ? `SYNCED ${timeAgo(status.lastSyncedAt).toUpperCase()}` : "NEVER SYNCED"}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 border border-muted-foreground/20 p-2">
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => configure({ [a.id]: { enabled: e.target.checked } })}
                className="accent-foreground"
                aria-label={`Sync ${a.name}`}
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[a.org, a.currency].filter(Boolean).join(" · ")}
                </p>
              </div>
              {a.synced ? (
                <span
                  className="font-mono text-xs uppercase text-muted-foreground"
                  title="Classification is locked once transactions have synced — reconnect to change it"
                >
                  {a.kind}
                </span>
              ) : (
                <select
                  value={a.kind}
                  onChange={(e) => configure({ [a.id]: { kind: e.target.value } })}
                  className="border border-muted-foreground/30 bg-transparent font-mono text-xs uppercase p-1"
                  aria-label={`Account type for ${a.name}`}
                >
                  {KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button className={btn} disabled={busy === "sync"} onClick={syncNow}>
            {busy === "sync" ? "SYNCING..." : "SYNC NOW"}
          </button>
          <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide cursor-pointer">
            <input
              type="checkbox"
              checked={!!status.autoSync}
              onChange={(e) => configure({}, e.target.checked)}
              className="accent-foreground"
            />
            AUTO-SYNC DAILY
          </label>
          <button
            className="ml-auto font-mono text-xs uppercase tracking-wide text-muted-foreground underline underline-offset-2 hover:text-destructive"
            disabled={busy === "disconnect"}
            onClick={disconnect}
          >
            DISCONNECT
          </button>
        </div>

        {result && (
          <p className="font-mono text-xs">
            {result.inserted} inserted
            {result.skipped > 0 ? ` · ${result.skipped} duplicates skipped` : ""}
          </p>
        )}
        {status.lastSyncStatus && status.lastSyncStatus !== "ok" && (
          <p className="font-mono text-xs text-destructive">{status.lastSyncStatus}</p>
        )}
        {/* Protocol requirement: bridge-reported errors must reach the user —
            this is how "reconnect your bank at the bridge" MFA states surface. */}
        {bridgeErrors.map((e) => (
          <p key={e} className="font-mono text-xs text-destructive">
            BRIDGE: {e}
          </p>
        ))}
        {error && <p className="font-mono text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
