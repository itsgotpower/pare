"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";

// In-app redirect target from ?from=. Only follow same-app paths — never an
// absolute URL from the query string. Default to /dashboard (the app entry);
// "/" is the public marketing page.
function safeFrom(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

// Shared brutalist shell so both auth modes look identical.
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <span className="font-mono text-lg font-bold tracking-tight">PARE</span>
          <Lock className="size-4 text-muted-foreground" />
        </div>
        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

const labelCls =
  "font-mono text-xs tracking-widest uppercase text-muted-foreground";
const btnCls = "w-full rounded-none font-mono text-xs tracking-widest uppercase";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = safeFrom(searchParams.get("from"));

  // Deploy mode is detected, not configured: the self-hosted single-user gate
  // serves GET /api/auth as JSON, while hosted mode returns 404 there
  // (hostedDisabled()). So a 404 means "hosted", anything else means
  // "self-hosted" — no NEXT_PUBLIC build-time flag to keep in sync.
  const [mode, setMode] = useState<"loading" | "self" | "hosted">("loading");
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth")
      .then(async (res) => {
        if (res.status === 404) {
          setMode("hosted");
          return;
        }
        const data = await res.json();
        if (data.authenticated) {
          router.replace(from);
          return;
        }
        setConfigured(data.configured);
        setMode("self");
      })
      // A network error can't distinguish the modes; assume self-hosted (the
      // default target) and let the form surface the real failure on submit.
      .catch(() => {
        setConfigured(true);
        setMode("self");
      });
  }, [router, from]);

  if (mode === "loading") {
    return (
      <AuthShell>
        <p className={labelCls}>Loading…</p>
      </AuthShell>
    );
  }

  return mode === "hosted" ? (
    <HostedForm from={from} />
  ) : (
    <SelfHostForm from={from} configured={configured} />
  );
}

// ---------------------------------------------------------------------------
// Self-hosted single-user gate (unchanged behavior): first run creates a
// profile, afterwards a password sign-in. Posts to app/api/auth/route.ts.
// ---------------------------------------------------------------------------
function SelfHostForm({
  from,
  configured,
}: {
  from: string;
  configured: boolean | null;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!configured && password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          configured
            ? { action: "login", password }
            : { action: "setup", display_name: displayName, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      router.replace(from);
      router.refresh();
    } catch {
      setError("Request failed — is the server running?");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h1 className="font-mono text-sm font-bold tracking-widest uppercase">
            {configured ? "Sign in" : "Create your profile"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {configured
              ? "Enter your password to unlock your data."
              : "First run — set a password to protect this app. Everything stays on this machine."}
          </p>
        </div>

        {!configured && (
          <div className="space-y-1.5">
            <label className={labelCls}>Name</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Scott"
              autoComplete="name"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className={labelCls}>Password</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={configured === true}
            autoComplete={configured ? "current-password" : "new-password"}
            required
            minLength={configured ? undefined : 8}
          />
        </div>

        {!configured && (
          <div className="space-y-1.5">
            <label className={labelCls}>Confirm password</label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
        )}

        {error && <p className="font-mono text-xs text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className={btnCls}>
          {submitting ? "Working…" : configured ? "Sign in" : "Create profile"}
        </Button>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Hosted multi-tenant gate (better-auth). Email + password (sign in / sign up)
// and passkey sign-in, all via authClient -> /api/auth/* (the [...all] handler).
// After a successful credential sign-in we offer passkey registration so a first
// passkey can be created without the (not-yet-built) hosted account-settings page.
// ---------------------------------------------------------------------------
function HostedForm({ from }: { from: string }) {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyPasskey, setBusyPasskey] = useState(false);
  // After a credential sign-in, offer to register a passkey before continuing.
  const [offerPasskey, setOfferPasskey] = useState(false);

  // Already signed in (e.g. returning with a valid cookie)? Skip the form.
  useEffect(() => {
    authClient
      .getSession()
      .then((s) => {
        if (s.data?.session) router.replace(from);
      })
      .catch(() => {});
  }, [router, from]);

  const finish = () => {
    router.replace(from);
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = isSignUp
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message || "Sign-in failed");
        return;
      }
      // Signed in. Offer a passkey for faster next time instead of redirecting
      // immediately; WebAuthn registration must run from a user gesture, which
      // the button on the next screen provides.
      setOfferPasskey(true);
    } catch {
      setError("Request failed — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithPasskey = async () => {
    setError(null);
    setBusyPasskey(true);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        setError(res.error.message || "Passkey sign-in failed or was cancelled.");
        return;
      }
      finish();
    } finally {
      setBusyPasskey(false);
    }
  };

  const registerPasskey = async () => {
    setError(null);
    setBusyPasskey(true);
    try {
      const res = await authClient.passkey.addPasskey();
      // A cancelled prompt is not a hard error — continue into the app either way.
      if (res?.error) setError(res.error.message || "Couldn't add a passkey.");
      finish();
    } finally {
      setBusyPasskey(false);
    }
  };

  if (offerPasskey) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div>
            <h1 className="font-mono text-sm font-bold tracking-widest uppercase">
              Add a passkey
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in faster next time with Face ID, Touch ID, or your device PIN —
              no password to type. You can always use your password instead.
            </p>
          </div>
          {error && <p className="font-mono text-xs text-destructive">{error}</p>}
          <Button onClick={registerPasskey} disabled={busyPasskey} className={btnCls}>
            <KeyRound className="size-3.5" />
            {busyPasskey ? "Working…" : "Add a passkey"}
          </Button>
          <button
            type="button"
            onClick={finish}
            className="w-full font-mono text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h1 className="font-mono text-sm font-bold tracking-widest uppercase">
            {isSignUp ? "Create account" : "Sign in"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSignUp
              ? "Set up your Pare account to sync across devices."
              : "Welcome back. Sign in to your Pare account."}
          </p>
        </div>

        {isSignUp && (
          <div className="space-y-1.5">
            <label className={labelCls}>Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Scott"
              autoComplete="name"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className={labelCls}>Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>Password</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={isSignUp ? 8 : undefined}
          />
        </div>

        {error && <p className="font-mono text-xs text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className={btnCls}>
          {submitting ? "Working…" : isSignUp ? "Create account" : "Sign in"}
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            or
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={signInWithPasskey}
          disabled={busyPasskey}
          className={btnCls}
        >
          <KeyRound className="size-3.5" />
          {busyPasskey ? "Working…" : "Sign in with a passkey"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setIsSignUp((v) => !v);
            setError(null);
          }}
          className="w-full font-mono text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground"
        >
          {isSignUp ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
