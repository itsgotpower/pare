"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from");
  // Only follow in-app paths — never an absolute URL from the query string.
  const from = rawFrom && rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : "/";

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          router.replace(from);
        } else {
          setConfigured(data.configured);
        }
      })
      .catch(() => setConfigured(true));
  }, [router, from]);

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border bg-card">
        <div className="border-b border-border px-6 py-4 flex items-center justify-between">
          <span className="font-mono text-lg font-bold tracking-tight">PARSE</span>
          <Lock className="size-4 text-muted-foreground" />
        </div>

        <div className="px-6 py-6">
          {configured === null ? (
            <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
              Loading…
            </p>
          ) : (
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
                  <label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                    Name
                  </label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Scott"
                    autoComplete="name"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  Password
                </label>
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
                  <label className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                    Confirm password
                  </label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              )}

              {error && (
                <p className="font-mono text-xs text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full rounded-none font-mono text-xs tracking-widest uppercase"
              >
                {submitting ? "Working…" : configured ? "Sign in" : "Create profile"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
