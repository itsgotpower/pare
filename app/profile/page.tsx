"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PALETTE } from "@/lib/colors";
import { timeAgo } from "@/lib/format";
import { purgeDataCaches } from "@/lib/purge-data-cache";
import { LogOut, Pencil, Download, Database, FileJson, CreditCard, Settings2, MessageSquarePlus } from "lucide-react";
import { IngestInbox } from "@/components/profile/ingest-inbox";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { authClient } from "@/lib/auth/client";

interface SourceHealth {
  source: string;
  label: string;
  nickname: string | null;
  hidden: boolean;
  closed: boolean;
  statement_count: number;
  last_period: string | null;
  last_txn_date: string | null;
  days_since_last: number | null;
  coverage: boolean[];
  // Fed by a sync (SimpleFIN) — staleness keys off sync recency, not
  // days-since-last-transaction (a quiet card syncs daily with no spend).
  synced: boolean;
}

interface Profile {
  display_name: string;
  email: string | null; // null in self-host (no email identity)
  email_verified: boolean | null;
  created_at: string;
  password_changed_at: string | null; // null in hosted (better-auth manages it)
  health: {
    transactions: number;
    statements: number;
    coverage_months: number;
    db_bytes: number;
    first_date: string | null;
    last_date: string | null;
    categorized_pct: number;
    rule_count: number;
    coverage_window: string[];
    sources: SourceHealth[];
  };
  // SimpleFIN connection recency, merged by /api/profile from the config store
  // (null when the feature is disabled or nothing is connected).
  simplefin?: {
    lastSyncedAt: string | null;
    lastSyncStatus: string | null;
  } | null;
}

interface Billing {
  hosted: boolean;
  configured: boolean;
  plan: { id: string; label: string; statementsPerMonth: number | null };
  status: string | null;
  manageable: boolean;
}

const STALE_AFTER_DAYS = 40;
// Mustard nudge before the terracotta flag — statements are monthly, so a
// source quietly approaching a missed cycle gets a heads-up first.
const WARN_AFTER_DAYS = 28;
// Synced (SimpleFIN) sources: auto-sync runs ~daily, so >2 missed days of
// successful syncs is worth a nudge — days-since-last-TRANSACTION is the
// wrong clock for them (a quiet card syncs fine with zero spend).
const SYNC_OVERDUE_AFTER_HOURS = 48;

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

const formatMonth = (period: string | null) =>
  period
    ? new Date(period + "-01T00:00:00").toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
      })
    : "—";

const formatShortDate = (iso: string | null) =>
  iso
    ? new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
      })
    : "—";

const monthAbbr = (ym: string) =>
  new Date(ym + "-01T00:00:00")
    .toLocaleDateString("en-CA", { month: "short" })
    .toUpperCase();

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const categorizedColor = (pct: number) =>
  pct >= 90 ? PALETTE.sage : pct >= 70 ? PALETTE.mustard : PALETTE.terracotta;

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

const REPO_URL = "https://github.com/itsgotpower/pare";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wipeError, setWipeError] = useState<string | null>(null);

  // Account management (nickname / hide / mark closed) — one dialog for the
  // source being managed. Open state is its own boolean (like pwOpen/wipeOpen):
  // deriving it from manageSource left an empty dialog shell mounted mid-exit.
  const [manageOpen, setManageOpen] = useState(false);
  const [manageSource, setManageSource] = useState<SourceHealth | null>(null);
  const [acctNickname, setAcctNickname] = useState("");
  const [acctHidden, setAcctHidden] = useState(false);
  const [acctClosed, setAcctClosed] = useState(false);
  const [acctError, setAcctError] = useState<string | null>(null);

  // Account deletion (hosted mode only — the affordance is hidden in self-host).
  const [hosted, setHosted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Billing / plan (hosted + Stripe-provisioned only). billingNotice is the
  // banner shown after returning from Stripe Checkout (?checkout=success|cancel).
  const [billing, setBilling] = useState<Billing | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingNotice, setBillingNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      // Mode-agnostic profile endpoint — the self-host-only GET /api/auth is
      // hostedDisabled() in hosted mode, which used to redirect-loop this page.
      const res = await fetch("/api/profile");
      const data = await res.json();
      if (data.authenticated) {
        setProfile(data.profile);
        setName(data.profile.display_name);
      } else {
        // Session expired between the middleware check and this fetch —
        // bounce to login instead of hanging on "Loading…" forever.
        router.replace("/login?from=/profile");
      }
    } catch {
      router.replace("/login?from=/profile");
    }
  }, [router]);

  const fetchBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/billing");
      if (!res.ok) return;
      setBilling(await res.json());
    } catch {
      /* billing card simply stays hidden */
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    fetchBilling();
    // Whether to show the "delete account" affordance (hosted multi-user only).
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => setHosted(!!d.hosted))
      .catch(() => setHosted(false));
  }, [fetchProfile, fetchBilling]);

  // Returning from Stripe Checkout — success_url/cancel_url append ?checkout=…
  // Show a banner, scrub the query from the URL, and re-pull plan state (the
  // webhook updates it; there can be a brief lag after success).
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (!checkout) return;
    if (checkout === "success") {
      setBillingNotice({ ok: true, msg: "Subscription updated — you're on Plus." });
      fetchBilling();
    } else if (checkout === "cancel") {
      setBillingNotice({ ok: false, msg: "Checkout canceled — no changes made." });
    }
    window.history.replaceState({}, "", "/profile");
  }, [fetchBilling]);

  // Open a Stripe-hosted flow: POST returns { url }, then we redirect the browser.
  const openBillingFlow = async (endpoint: string) => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setBillingError(data.error || "Could not reach Stripe. Please try again.");
    } catch {
      setBillingError("Could not reach Stripe. Please try again.");
    } finally {
      setBillingBusy(false);
    }
  };

  const post = (body: Record<string, unknown>) =>
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const handleSaveName = async () => {
    setBusy(true);
    const res = await post({ action: "update_profile", display_name: name });
    setBusy(false);
    if (res.ok) {
      setEditingName(false);
      fetchProfile();
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwStatus(null);
    if (newPw !== confirmPw) {
      setPwStatus({ ok: false, msg: "New passwords do not match" });
      return;
    }
    setBusy(true);
    const res = await post({
      action: "change_password",
      current_password: currentPw,
      new_password: newPw,
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      fetchProfile();
      // Under an env-var signing secret (PARE_AUTH_SECRET), the server can't
      // revoke other sessions on its own — warn the user and keep the dialog
      // open so they see it. In file-secret mode every other session is already
      // dead, so just close.
      if (data.sessionsInvalidated === false) {
        setPwStatus({
          ok: true,
          msg: "Password changed. Other signed-in sessions stay valid until you rotate PARE_AUTH_SECRET and restart the server.",
        });
      } else {
        setPwStatus(null);
        setPwOpen(false);
      }
    } else {
      setPwStatus({ ok: false, msg: data.error || "Failed to change password" });
    }
  };

  const openManageAccount = (s: SourceHealth) => {
    setAcctNickname(s.nickname ?? "");
    setAcctHidden(s.hidden);
    setAcctClosed(s.closed);
    setAcctError(null);
    setManageSource(s);
    setManageOpen(true);
  };

  const handleSaveAccount = async () => {
    if (!manageSource) return;
    setAcctError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: manageSource.source,
          nickname: acctNickname.trim() || null,
          hidden: acctHidden,
          closed: acctClosed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAcctError(data.error || "Failed to save");
        return;
      }
      // Hiding/unhiding changes every chart — drop the SW's cached /api/* GETs
      // so stale data doesn't linger offline-first.
      await purgeDataCaches();
      setManageOpen(false);
      fetchProfile();
    } catch {
      setAcctError("Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleWipe = async () => {
    setWipeError(null);
    setBusy(true);
    const res = await fetch("/api/data", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: wipeConfirm }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setWipeOpen(false);
      setWipeConfirm("");
      fetchProfile();
    } else {
      setWipeError(data.error || "Wipe failed");
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteError(null);
    setBusy(true);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: deleteConfirm }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      // Account + data are gone; the session no longer resolves. Back to public.
      router.replace("/");
      router.refresh();
    } else {
      setDeleteError(data.error || "Account deletion failed. Please try again.");
    }
  };

  const handleSignOut = async () => {
    // Two deploy modes, two session systems — and each one's sign-out endpoint
    // 404s harmlessly in the other mode, so fire both instead of branching on
    // the async-loaded `hosted` flag (a click before that fetch resolves would
    // pick the wrong branch). Hosted MUST go through authClient.signOut(): the
    // self-host gate's POST /api/auth is hostedDisabled() there, so posting
    // {action:"logout"} alone was a silent no-op — the surviving better-auth
    // session made /login bounce straight back into the app.
    await Promise.allSettled([
      authClient.signOut(),
      post({ action: "logout" }),
    ]);
    // Now that the session is actually gone, evict this session's cached
    // financial data from the SW data cache before the next user can sign in on
    // the same browser (see lib/purge-data-cache).
    await purgeDataCaches();
    router.replace("/login");
    router.refresh();
  };

  if (!profile) {
    return (
      <div className="p-6">
        <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
          Loading…
        </p>
      </div>
    );
  }

  const initials =
    (profile.display_name || "P")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "P";

  const { health } = profile;

  const stats: [string, string][] = [
    ["Transactions", health.transactions.toLocaleString()],
    ["Statements", String(health.statements)],
    ["Coverage", `${health.coverage_months} MO`],
    // Hosted has no SQLite file to stat, so db_bytes comes back 0 — "0 B"
    // under DATA HEALTH reads as lost data. Show freshness there instead.
    health.db_bytes > 0
      ? ["Database", formatBytes(health.db_bytes)]
      : ["Last data", formatShortDate(health.last_date)],
  ];

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
        Profile
      </h1>

      <div className="grid gap-3 md:grid-cols-3 mb-3">
        <Card className="rounded-none ring-0 border border-border md:col-span-2">
          <CardContent className="flex items-center gap-4">
            <div className="size-12 shrink-0 border border-foreground flex items-center justify-center font-mono text-lg font-bold">
              {initials}
            </div>
            <div className="min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                    autoFocus
                    className="h-7 max-w-48 rounded-none font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={handleSaveName}
                    className="rounded-none font-mono text-[10px] tracking-widest uppercase"
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-bold uppercase truncate">
                    {profile.display_name || "Unnamed"}
                  </p>
                  <button
                    onClick={() => setEditingName(true)}
                    aria-label="Edit display name"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Member since {formatDate(profile.created_at)}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline font-mono text-[10px] tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground">
                All data local
              </span>
              <Button
                variant="outline"
                onClick={handleSignOut}
                className="rounded-none font-mono text-xs tracking-widest uppercase"
              >
                <LogOut data-icon="inline-start" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none ring-0 border border-border">
          <CardContent>
            <p className={`${labelClass} mb-2`}>Security</p>
            <p className="text-xs mb-0.5">
              Password changed {formatDate(profile.password_changed_at)}
            </p>
            <p className="text-[11px] text-muted-foreground mb-3">
              Changing it signs out every session.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setPwStatus(null);
                setPwOpen(true);
              }}
              className="rounded-none font-mono text-xs tracking-widest uppercase"
            >
              Change password
            </Button>
          </CardContent>
        </Card>
      </div>

      {billing?.hosted && (
        <Card className="rounded-none ring-0 border border-border py-0 gap-0 mb-3">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className={labelClass}>Plan</span>
            <span
              className={`font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5 ${
                billing.plan.id === "pro" ? "" : "text-muted-foreground border-border"
              }`}
              style={
                billing.plan.id === "pro"
                  ? { color: PALETTE.sage, borderColor: PALETTE.sage }
                  : undefined
              }
            >
              {billing.plan.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
            <CreditCard className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-48">
              <p className="font-mono text-sm font-bold uppercase">
                {billing.plan.label} plan
              </p>
              <p className="text-xs text-muted-foreground">
                {billing.plan.statementsPerMonth === null
                  ? "Unlimited statements per month"
                  : `Up to ${billing.plan.statementsPerMonth} statements per month`}
                {billing.status && billing.status !== "active"
                  ? ` · status: ${billing.status}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {billing.plan.id !== "pro" && (
                  <>Plus is $8/mo or $72/yr USD — 2 accounts, unlimited uploads. </>
                )}
                <Link
                  href="/pricing"
                  className="underline hover:text-foreground transition-colors"
                >
                  See pricing
                </Link>
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {billing.configured && billing.plan.id !== "pro" && (
                <Button
                  onClick={() => openBillingFlow("/api/billing/checkout")}
                  disabled={billingBusy}
                  className="rounded-none font-mono text-xs tracking-widest uppercase"
                >
                  Upgrade to Plus
                </Button>
              )}
              {!billing.configured && (
                <span className="font-mono text-[10px] tracking-widest uppercase border border-border px-2 py-1 text-muted-foreground">
                  Billing opens at launch
                </span>
              )}
              {billing.manageable && (
                <Button
                  variant="outline"
                  onClick={() => openBillingFlow("/api/billing/portal")}
                  disabled={billingBusy}
                  className="rounded-none font-mono text-xs tracking-widest uppercase"
                >
                  Manage billing
                </Button>
              )}
            </div>
          </div>
          {(billingNotice || billingError) && (
            <div className="border-t border-border px-4 py-2">
              {billingError ? (
                <p className="font-mono text-xs text-destructive">{billingError}</p>
              ) : (
                <p
                  className="font-mono text-xs"
                  style={{ color: billingNotice!.ok ? PALETTE.sage : PALETTE.terracotta }}
                >
                  {billingNotice!.msg}
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {hosted && <IngestInbox />}

      <Card className="rounded-none ring-0 border border-border py-0 gap-0 mb-3">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className={labelClass}>Data health</span>
          <Link
            href="/categories"
            className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <span style={{ color: categorizedColor(health.categorized_pct) }}>
              {health.categorized_pct}% categorized
            </span>{" "}
            · {health.rule_count} rules →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-border">
          {stats.map(([label, value], i) => (
            <div
              key={label}
              className={`px-4 py-3 ${i > 0 ? "border-l border-border/50" : ""}`}
            >
              <p className="font-mono text-xl font-bold">{value}</p>
              <p className={labelClass}>{label}</p>
            </div>
          ))}
        </div>
        <div>
          {health.sources.map((s, i) => {
            // Quick-added cash rows have no statement feed behind them — there
            // is nothing to upload, so staleness doesn't apply. Closed accounts
            // are done on purpose — no point nagging for an upload either.
            // ACTIVELY synced sources skip the txn-based clock (badge below) —
            // but only while a SimpleFIN connection exists: after a disconnect
            // the .sync statements remain, and without this guard the source
            // would be exempt from staleness nudges forever.
            const isManual = s.source === "manual";
            const sync = profile.simplefin;
            const syncActive = s.synced && !!sync;
            const stale =
              !isManual &&
              !syncActive &&
              !s.closed &&
              s.days_since_last !== null &&
              s.days_since_last > STALE_AFTER_DAYS;
            const aging =
              !isManual &&
              !syncActive &&
              !s.closed &&
              !stale &&
              s.days_since_last !== null &&
              s.days_since_last > WARN_AFTER_DAYS;
            const syncFresh =
              !!sync?.lastSyncedAt &&
              Date.now() - Date.parse(sync.lastSyncedAt) <
                SYNC_OVERDUE_AFTER_HOURS * 3600_000 &&
              (sync.lastSyncStatus === "ok" || sync.lastSyncStatus === null);
            const coveredCount = s.coverage.filter(Boolean).length;
            return (
              <div
                key={s.source}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 ${
                  i > 0 ? "border-t border-border/50" : ""
                } ${s.hidden ? "opacity-60" : ""}`}
              >
                <span className="font-mono text-xs tracking-widest w-24 shrink-0 truncate" title={s.source}>
                  {s.label}
                </span>
                <span className="text-xs text-muted-foreground flex-1 min-w-40">
                  {isManual
                    ? `Quick-added in app · txns to ${formatDate(s.last_txn_date)}`
                    : `Txns to ${formatDate(s.last_txn_date)} · last statement ${formatMonth(s.last_period)} · ${s.statement_count} statements`}
                </span>
                <span
                  className="flex items-center gap-1"
                  role="img"
                  aria-label={`${coveredCount} of the last ${s.coverage.length} months covered`}
                >
                  <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                    {monthAbbr(health.coverage_window[0])}
                  </span>
                  <span className="flex gap-0.5">
                    {s.coverage.map((covered, j) => (
                      <span
                        key={j}
                        title={health.coverage_window[j]}
                        className={`size-2 ${
                          covered
                            ? "bg-foreground/70"
                            : "border border-border bg-transparent"
                        }`}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                    {monthAbbr(health.coverage_window[health.coverage_window.length - 1])}
                  </span>
                </span>
                {s.hidden && (
                  <span className="font-mono text-[10px] tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                    Hidden
                  </span>
                )}
                {s.closed ? (
                  <span className="font-mono text-[10px] tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                    Closed
                  </span>
                ) : syncActive ? (
                  sync?.lastSyncedAt ? (
                    syncFresh ? (
                      <span
                        className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5"
                        style={{ color: PALETTE.sage, borderColor: PALETTE.sage }}
                      >
                        Synced {timeAgo(sync.lastSyncedAt)}
                      </span>
                    ) : (
                      <Link
                        href="/upload"
                        className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5"
                        style={{ color: PALETTE.mustard, borderColor: PALETTE.mustard }}
                      >
                        Sync overdue — {timeAgo(sync.lastSyncedAt)}
                      </Link>
                    )
                  ) : (
                    <span className="font-mono text-[10px] tracking-widest uppercase border border-border px-1.5 py-0.5 text-muted-foreground">
                      Synced
                    </span>
                  )
                ) : stale || aging ? (
                  <Link
                    href="/upload"
                    className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5"
                    style={
                      stale
                        ? { color: PALETTE.terracotta, borderColor: PALETTE.terracotta }
                        : { color: PALETTE.mustard, borderColor: PALETTE.mustard }
                    }
                  >
                    {s.days_since_last}d — upload
                  </Link>
                ) : isManual ? null : (
                  <span
                    className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5"
                    style={{ color: PALETTE.sage, borderColor: PALETTE.sage }}
                  >
                    Current
                    {s.days_since_last !== null &&
                      ` · ${s.days_since_last === 0 ? "today" : `${s.days_since_last}d`}`}
                  </span>
                )}
                <button
                  onClick={() => openManageAccount(s)}
                  aria-label={`Manage ${s.label}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Settings2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="rounded-none ring-0 border border-border md:col-span-2">
          <CardHeader>
            <CardTitle className={labelClass}>Your data, your files</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <a href="/api/data?format=csv" download>
              <Button variant="outline" className="rounded-none font-mono text-xs tracking-widest uppercase">
                <Download data-icon="inline-start" />
                Export CSV
              </Button>
            </a>
            <a href="/api/data?format=json" download>
              <Button variant="outline" className="rounded-none font-mono text-xs tracking-widest uppercase">
                <FileJson data-icon="inline-start" />
                Export JSON
              </Button>
            </a>
            <a href="/api/data?format=backup" download>
              <Button variant="outline" className="rounded-none font-mono text-xs tracking-widest uppercase">
                <Database data-icon="inline-start" />
                Backup DB
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="rounded-none ring-0 border border-destructive/50">
          <CardHeader>
            <CardTitle className="font-mono text-[10px] tracking-widest uppercase text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                setWipeError(null);
                setWipeConfirm("");
                setWipeOpen(true);
              }}
              className="rounded-none font-mono text-xs tracking-widest uppercase"
            >
              Wipe all data…
            </Button>
            {hosted && (
              <Button
                variant="destructive"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteConfirm("");
                  setDeleteOpen(true);
                }}
                className="rounded-none font-mono text-xs tracking-widest uppercase"
              >
                Delete account…
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <FeedbackDialog
          triggerClassName="inline-flex items-center gap-2 border border-input bg-background px-4 py-2 font-mono text-xs tracking-widest uppercase hover:bg-accent hover:text-accent-foreground transition-colors"
          trigger={
            <>
              <MessageSquarePlus className="size-3.5" />
              SEND FEEDBACK
            </>
          }
        />
      </div>

      {APP_VERSION && (
        <p className="mt-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground/60">
          Pare{" "}
          <a
            href={`${REPO_URL}/releases/tag/v${APP_VERSION}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            v{APP_VERSION}
          </a>
        </p>
      )}

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase">
              Change password
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Current password</label>
              <Input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
                required
                className="rounded-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>New password</label>
              <Input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className="rounded-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Confirm new password</label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                required
                className="rounded-none"
              />
            </div>
            {pwStatus && !pwStatus.ok && (
              <p className="font-mono text-xs text-destructive">{pwStatus.msg}</p>
            )}
            {pwStatus && pwStatus.ok && (
              <p className="font-mono text-xs text-amber-600 dark:text-amber-500">
                {pwStatus.msg}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="rounded-none font-mono text-xs tracking-widest uppercase"
            >
              Update password
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase">
              Manage account
            </DialogTitle>
          </DialogHeader>
          {manageSource && (
            <div className="space-y-4 text-sm">
              <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                {manageSource.source}
              </p>
              <div className="space-y-1.5">
                <label className={labelClass}>Nickname</label>
                <Input
                  value={acctNickname}
                  onChange={(e) => setAcctNickname(e.target.value)}
                  placeholder={manageSource.label}
                  maxLength={40}
                  className="rounded-none font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Shown instead of the derived name. Leave empty to reset.
                </p>
              </div>
              <button
                onClick={() => setAcctHidden((v) => !v)}
                className="flex w-full items-start gap-3 border border-border px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                aria-pressed={acctHidden}
              >
                <span
                  className={`mt-0.5 size-3 shrink-0 border border-foreground ${
                    acctHidden ? "bg-foreground" : "bg-transparent"
                  }`}
                />
                <span>
                  <span className="block font-mono text-[10px] tracking-widest uppercase">
                    Hide from charts
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Excluded from every chart, total, and list. Data stays in
                    the database and in exports.
                  </span>
                </span>
              </button>
              <button
                onClick={() => setAcctClosed((v) => !v)}
                className="flex w-full items-start gap-3 border border-border px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
                aria-pressed={acctClosed}
              >
                <span
                  className={`mt-0.5 size-3 shrink-0 border border-foreground ${
                    acctClosed ? "bg-foreground" : "bg-transparent"
                  }`}
                />
                <span>
                  <span className="block font-mono text-[10px] tracking-widest uppercase">
                    Mark closed
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    History stays in the charts; upload nudges stop, and its
                    last balance no longer carries into net worth or the
                    forecast.
                  </span>
                </span>
              </button>
              {acctError && (
                <p className="font-mono text-xs text-destructive">{acctError}</p>
              )}
              <Button
                disabled={busy}
                onClick={handleSaveAccount}
                className="rounded-none font-mono text-xs tracking-widest uppercase"
              >
                Save
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase text-destructive">
              Wipe all data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Deletes all {health.transactions.toLocaleString()} transactions,{" "}
              {health.statements} statement records, and manual category overrides.
            </p>
            <p className="text-muted-foreground text-xs">
              Kept: your password, category rules (custom rules are also persisted
              to user-rules.json), and goals. Re-upload your PDFs to re-ingest.
            </p>
            <div className="space-y-1.5">
              <label className={labelClass}>Type WIPE to confirm</label>
              <Input
                value={wipeConfirm}
                onChange={(e) => setWipeConfirm(e.target.value)}
                className="rounded-none font-mono"
              />
            </div>
            {wipeError && (
              <p className="font-mono text-xs text-destructive">{wipeError}</p>
            )}
            <Button
              variant="destructive"
              disabled={busy || wipeConfirm !== "WIPE"}
              onClick={handleWipe}
              className="rounded-none font-mono text-xs tracking-widest uppercase"
            >
              Wipe all data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase text-destructive">
              Delete account
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Permanently deletes your account and{" "}
              <span className="font-bold">all</span> of your data — every
              transaction, statement, rule, goal, and any uploaded PDF — plus your
              sign-in identity. This cannot be undone.
            </p>
            <p className="text-muted-foreground text-xs">
              There is no recovery and no soft-delete. See our{" "}
              <Link href="/privacy" className="underline">
                privacy policy
              </Link>{" "}
              for what we hold and how deletion works.
            </p>
            <div className="space-y-1.5">
              <label className={labelClass}>Type DELETE to confirm</label>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="rounded-none font-mono"
              />
            </div>
            {deleteError && (
              <p className="font-mono text-xs text-destructive">{deleteError}</p>
            )}
            <Button
              variant="destructive"
              disabled={busy || deleteConfirm !== "DELETE"}
              onClick={handleDeleteAccount}
              className="rounded-none font-mono text-xs tracking-widest uppercase"
            >
              Delete my account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
