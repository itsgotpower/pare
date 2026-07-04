"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Lock, KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Turnstile, turnstileConfigured } from "@/components/turnstile";

// In-app redirect target from ?from=. Only follow same-app paths — never an
// absolute URL from the query string. Default to /dashboard (the app entry);
// "/" is the public marketing page.
function safeFrom(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

// Shared brutalist shell so every auth mode looks identical: a PARE header rule
// (with a security mark), the form body, and a centered tagline footer.
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <span className="font-mono text-lg font-bold tracking-tight">
            <span aria-hidden="true">🍐</span> PARE
          </span>
          <ShieldCheck className="size-4 text-muted-foreground" />
        </div>
        <div className="px-6 py-6">{children}</div>
        <div className="border-t border-border px-6 py-3 space-y-1">
          <p className="text-center font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Personal finance, pared down
          </p>
          <p className="text-center font-mono text-[10px] tracking-[0.2em] uppercase">
            <Link
              href="/demo"
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Just looking? Browse the demo
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// Reassurance row shown above the primary auth action. Copy differs by mode:
// self-host data never leaves the device; hosted data is encrypted at rest under
// the user's key, then synced.
function SecurityNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border border-border bg-muted/40 px-3 py-2.5">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
    </div>
  );
}

const labelCls =
  "font-mono text-xs tracking-widest uppercase text-muted-foreground";
const btnCls = "w-full rounded-none font-mono text-xs tracking-widest uppercase";
const headingCls = "mt-1.5 font-mono text-lg font-bold tracking-wide uppercase";

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
  // Self-host is single-user, but let the visitor switch between first-run
  // profile creation and password sign-in. Defaults to whatever the server
  // reports (configured → sign in; fresh install → create).
  const [showCreate, setShowCreate] = useState(!configured);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (showCreate && password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          showCreate
            ? { action: "setup", display_name: displayName, password }
            : { action: "login", password }
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
          <h1 className={headingCls}>
            {showCreate ? "Create your profile" : "Sign in"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {showCreate
              ? "Set a strong password to secure your account."
              : "Enter your password to unlock your data."}
          </p>
        </div>

        {showCreate && (
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
            autoFocus={!showCreate}
            autoComplete={showCreate ? "new-password" : "current-password"}
            required
            minLength={showCreate ? 8 : undefined}
          />
          {showCreate && (
            <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
              At least 8 characters.
            </p>
          )}
        </div>

        {showCreate && (
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

        <SecurityNote>
          Protected by your password and stored only on this device — nothing is
          ever uploaded or shared.
        </SecurityNote>

        <Button type="submit" disabled={submitting} className={btnCls}>
          {submitting ? "Working…" : showCreate ? "Create profile" : "Sign in"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setError(null);
          }}
          className="w-full text-center font-mono text-[11px] tracking-widest uppercase text-muted-foreground transition-colors hover:text-foreground"
        >
          {showCreate
            ? "Have an account? Sign in here"
            : "Need an account? Create one"}
        </button>
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

// better-auth rejects a sign-in for an unverified account with a 403 whose code
// is EMAIL_NOT_VERIFIED. Match on the code (with a message fallback) so we can
// show the check-your-email screen instead of a generic error.
function isUnverifiedEmailError(err: {
  code?: string;
  message?: string;
}): boolean {
  return (
    err.code === "EMAIL_NOT_VERIFIED" || /not verified|verify/i.test(err.message ?? "")
  );
}

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
  // After sign-up (or a blocked unverified sign-in) there is no session yet —
  // the user must click the emailed link. Holds the address we sent it to so we
  // can show the check-your-email screen.
  const [pendingVerification, setPendingVerification] = useState<string | null>(
    null
  );
  // Turnstile token for the email endpoints — better-auth's captcha plugin
  // (lib/auth/hosted.ts) rejects tokenless sign-up/sign-in POSTs when enforced.
  // Empty in dev/self-host, where the widget renders nothing and the header is
  // omitted. Tokens are single-use: bump captchaReset after every submit that
  // reached the server, or a retry re-sends the consumed token and fails.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);

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
    // The managed widget usually solves itself within a second of mount; an
    // empty token here just means it hasn't finished (or was consumed) — nudge
    // instead of sending a POST the server will reject.
    if (turnstileConfigured() && !captchaToken) {
      setError("Still confirming you're human — give it a second and try again.");
      return;
    }
    setSubmitting(true);
    // Header only when a token exists: better-auth's captcha plugin reads
    // x-captcha-response; dev/self-host has no widget and no enforcement.
    const fetchOptions = captchaToken
      ? { headers: { "x-captcha-response": captchaToken } }
      : undefined;
    try {
      const res = isSignUp
        ? await authClient.signUp.email({ email, password, name, fetchOptions })
        : await authClient.signIn.email({ email, password, fetchOptions });
      if (res.error) {
        // Email+password requires a verified address (lib/auth/hosted.ts). A
        // sign-in against an unverified account is rejected and better-auth
        // re-sends the link — show the check-your-email screen, not a dead end.
        if (isUnverifiedEmailError(res.error)) {
          setPendingVerification(email);
          return;
        }
        setError(res.error.message || "Sign-in failed");
        return;
      }
      // Sign-up never returns a session while verification is required: the user
      // must click the emailed link first. Show the check-your-email screen
      // instead of the (sessionless) passkey offer / redirect.
      if (isSignUp) {
        setPendingVerification(email);
        return;
      }
      // Signed in. Offer a passkey for faster next time instead of redirecting
      // immediately; WebAuthn registration must run from a user gesture, which
      // the button on the next screen provides.
      setOfferPasskey(true);
    } catch {
      setError("Request failed — check your connection and try again.");
    } finally {
      // The token was (probably) consumed by the POST — get a fresh one either
      // way so a retry never re-sends a spent token.
      setCaptchaReset((n) => n + 1);
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

  if (pendingVerification) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div>
            <h1 className={headingCls}>Verify your email</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              We sent a verification link to{" "}
              <span className="font-mono text-foreground">
                {pendingVerification}
              </span>
              . Click it to finish — your account isn&apos;t active until the
              address is confirmed. Check spam if it isn&apos;t there in a minute.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPendingVerification(null);
              setError(null);
              setIsSignUp(false);
            }}
            className="w-full font-mono text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  if (offerPasskey) {
    return (
      <AuthShell>
        <div className="space-y-4">
          <div>
            <h1 className={headingCls}>
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
          <h1 className={headingCls}>
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

        <Turnstile onToken={setCaptchaToken} resetSignal={captchaReset} />

        {error && <p className="font-mono text-xs text-destructive">{error}</p>}

        <SecurityNote>
          Encrypted at rest under your key, then synced securely across your
          devices.
        </SecurityNote>

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
