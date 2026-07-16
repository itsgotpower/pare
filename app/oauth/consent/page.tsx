"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Lock } from "lucide-react";

// OAuth consent screen for the remote MCP connector (hosted only).
//
// The forced-consent authorize shim (/api/mcp-authorize → prompt=consent)
// lands here with ?consent_code=…&client_id=…&scope=…; better-auth has also
// set a signed oidc_consent_prompt cookie. ALLOW/DENY posts to the plugin's
// /api/auth/oauth2/consent endpoint, which answers { redirectURI } — we send
// the browser there (back to the client's redirect_uri with a code, or an
// access_denied error). Spec: internal/remote-mcp-spec.md.

// Human copy for the OIDC scopes the mcp plugin issues. The scopes gate
// IDENTITY claims only — Pare data tools are all-or-nothing behind the token
// (plus Claude's own per-tool-call approval), so the meaningful consent here
// is "this app may query my Pare data as me".
const SCOPE_COPY: Record<string, string> = {
  openid: "Confirm who you are (account id)",
  profile: "Read your display name",
  email: "Read your account email",
  offline_access: "Stay connected without re-approving each session",
};

function ConsentInner() {
  const params = useSearchParams();
  const consentCode = params.get("consent_code");
  const clientId = params.get("client_id");
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
  const [busy, setBusy] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    setBusy(accept ? "accept" : "deny");
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const data = (await res.json()) as { redirectURI?: string; message?: string };
      if (!res.ok || !data.redirectURI) {
        setError(data.message ?? "Consent request expired — close this tab and reconnect from Claude.");
        setBusy(null);
        return;
      }
      window.location.href = data.redirectURI;
    } catch {
      setError("Network error — try again.");
      setBusy(null);
    }
  };

  return (
    <div className="w-full max-w-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h1 className="font-mono text-sm tracking-[0.2em] uppercase">Connect to Pare</h1>
      </div>
      <div className="space-y-4 px-6 py-6">
        {/* Deliberately client-neutral: DCR client names are self-declared, so
            naming the requester ("Claude") would lend false authority to any
            client that registers with that name. The user's own provenance —
            "did I just start this from Claude's settings?" — is the real check. */}
        <p className="text-sm leading-snug">
          An app is asking to access your Pare financial data — spending,
          transactions, budgets, and subscriptions — acting as you.
        </p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Only continue if you started this yourself — e.g. you just added Pare
          under Claude&apos;s connector settings.
        </p>
        <div className="border border-border">
          {(scopes.length ? scopes : ["openid"]).map((s) => (
            <div key={s} className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="text-[11px] leading-snug">
                <span className="font-mono uppercase text-muted-foreground">{s}</span>
                <p>{SCOPE_COPY[s] ?? "Additional access requested by the app"}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Every tool call still shows up for approval inside Claude. Disconnect anytime from
          Claude&apos;s connector settings; tokens are revoked when your account is deleted.
        </p>
        {clientId ? (
          <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            client {clientId.slice(0, 8)}…
          </p>
        ) : null}
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy !== null || !consentCode} onClick={() => decide(true)}>
            {busy === "accept" ? "CONNECTING…" : "ALLOW"}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy !== null || !consentCode} onClick={() => decide(false)}>
            {busy === "deny" ? "…" : "DENY"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Suspense fallback={null}>
        <ConsentInner />
      </Suspense>
    </div>
  );
}
