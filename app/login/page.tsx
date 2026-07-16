"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Lock, KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Turnstile, turnstileConfigured } from "@/components/turnstile";
import { Wordmark } from "@/components/layout/wordmark";
import { purgeDataCaches } from "@/lib/purge-data-cache";

// In-app redirect target from ?from=. Only follow same-app paths — never an
// absolute URL from the query string. Default to /dashboard (the app entry);
// "/" is the public marketing page.
function safeFrom(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

// Where to send the user after they sign in. A first-time user has nothing
// imported yet, so the dashboard would just be an empty shell — send them to
// /upload instead. An explicit ?from= deep link always wins over this.
async function resolveLanding(from: string): Promise<string> {
  if (from !== "/dashboard") return from;
  try {
    const res = await fetch("/api/summary?type=has_data");
    if (res.ok) {
      const d = await res.json();
      if (d && d.hasData === false) return "/upload";
    }
  } catch {
    /* fall through to the default landing */
  }
  return from;
}

// Remote-MCP OAuth continuation (hosted only). When the better-auth mcp plugin
// bounces a signed-out authorize request here, it puts the ENTIRE authorize
// query on the login URL (client_id, redirect_uri, code_challenge, …). The
// plugin's own resume mechanism — an after-hook that turns the sign-in response
// into a 302 to the consent page — is invisible to our fetch-based submit (the
// browser follows the redirect internally and hands back the consent page's
// HTML as the fetch body), so the client must re-enter the flow itself: after
// sign-in, navigate (full page) to /api/mcp-authorize with the same query. The
// full-page paths (email-verification link, Google callback) don't need this —
// there the after-hook's 302 really navigates the browser.
function oauthResumeUrl(searchParams: URLSearchParams): string | null {
  const required = ["client_id", "redirect_uri", "response_type"];
  if (!required.every((k) => searchParams.get(k))) return null;
  return `/api/mcp-authorize?${searchParams.toString()}`;
}

// Shared brutalist shell so every auth mode looks identical: a PARE header rule
// (with a security mark), the form body, and a centered tagline footer.
function AuthShell({
  children,
  hideDemo = false,
}: {
  children: React.ReactNode;
  // Hide the "browse the demo" CTA on transient post-submit screens (e.g. the
  // verify-your-email step) where nudging the user away from finishing is wrong.
  hideDemo?: boolean;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <Wordmark className="font-mono text-lg font-bold tracking-tight" />
          <ShieldCheck className="size-4 text-muted-foreground" />
        </div>
        <div className="px-6 py-6">{children}</div>
        <div className="border-t border-border px-6 py-3 space-y-1">
          <p className="text-center font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Personal finance, pared down
          </p>
          {!hideDemo && (
            <p className="text-center font-mono text-[10px] tracking-[0.2em] uppercase">
              <Link
                href="/demo"
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Just looking? Browse the demo
              </Link>
            </p>
          )}
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
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // The login page is the choke point every signed-out state passes through
  // (explicit logout, session expiry, a forged/expired cookie bounced here).
  // Purge the SW's per-user data cache on arrival so no prior tenant's cached
  // financial PII survives into the next sign-in on a shared browser.
  useEffect(() => {
    void purgeDataCaches();
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then(async (res) => {
        if (res.status === 404) {
          // The hosted 404 body doubles as a capability flag (see
          // app/api/auth/route.ts): social.google is true only when the
          // Worker has the Google OAuth secrets, so an unconfigured deploy
          // never shows a dead button.
          const caps = await res.json().catch(() => null);
          setGoogleEnabled(Boolean(caps?.social?.google));
          setMode("hosted");
          return;
        }
        const data = await res.json();
        if (data.authenticated) {
          resolveLanding(from).then((t) => router.replace(t));
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

  // ?signup=1 (from the demo / marketing "Sign up" CTAs) opens the create-account
  // form directly instead of the sign-in form.
  const signup = searchParams.get("signup") === "1";

  return mode === "hosted" ? (
    <HostedForm from={from} signup={signup} googleEnabled={googleEnabled} />
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
      router.replace(await resolveLanding(from));
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

// Monochrome Google "G" mark, inline like the landing page's GithubMark
// (lucide-react dropped its brand icons).
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  );
}

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

function HostedForm({
  from,
  signup = false,
  googleEnabled,
}: {
  from: string;
  signup?: boolean;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSignUp, setIsSignUp] = useState(signup);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // A failed/cancelled OAuth round-trip lands back here with ?error=… (the
  // errorCallbackURL below) — surface it instead of a silent bounce.
  const [error, setError] = useState<string | null>(
    searchParams.get("error")
      ? "Google sign-in didn't complete — try again, or use your email and password."
      : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [busyPasskey, setBusyPasskey] = useState(false);
  const [busyGoogle, setBusyGoogle] = useState(false);
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

  // Mid-OAuth (claude.ai connector) continuation — see oauthResumeUrl above.
  const oauthResume = oauthResumeUrl(searchParams);

  // Already signed in (e.g. returning with a valid cookie)? Skip the form.
  useEffect(() => {
    authClient
      .getSession()
      .then((s) => {
        if (!s.data?.session) return;
        if (oauthResume) window.location.assign(oauthResume);
        else resolveLanding(from).then((t) => router.replace(t));
      })
      .catch(() => {});
  }, [router, from, oauthResume]);

  const finish = async () => {
    router.replace(await resolveLanding(from));
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
      // Mid-OAuth: get the user back to claude.ai's consent step, not a
      // passkey interstitial. Full-page navigation, deliberately not
      // router.replace — the target is an API route, not an app page.
      if (oauthResume) {
        window.location.assign(oauthResume);
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

  const signInWithGoogle = async () => {
    setError(null);
    setBusyGoogle(true);
    try {
      // Kicks off a full-page redirect to Google; better-auth runs the OAuth
      // dance server-side and lands back on `from` (already sanitized by
      // safeFrom). Signup vs sign-in needs no branching — a Google-verified
      // email matching an existing account links to it (trustedProviders in
      // lib/auth/hosted.ts), otherwise an account is created.
      // Mid-OAuth the plugin's after-hook normally supersedes callbackURL with
      // the authorize continuation; pointing callbackURL there too covers the
      // case where its oidc_login_prompt cookie has expired en route.
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: oauthResume ?? from,
        newUserCallbackURL: oauthResume ?? from,
        errorCallbackURL: "/login?error=google",
      });
      if (res?.error) {
        setError(res.error.message || "Google sign-in failed — try again.");
        setBusyGoogle(false);
      }
      // On success the browser navigates away; leave the button disabled.
    } catch {
      setError("Request failed — check your connection and try again.");
      setBusyGoogle(false);
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
      <AuthShell hideDemo>
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

        {googleEnabled && (
          <Button
            type="button"
            variant="outline"
            onClick={signInWithGoogle}
            disabled={busyGoogle}
            className={btnCls}
          >
            <GoogleMark className="size-3.5" />
            {busyGoogle ? "Working…" : "Continue with Google"}
          </Button>
        )}

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
