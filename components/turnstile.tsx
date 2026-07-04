"use client";

// ---------------------------------------------------------------------------
// Turnstile — the Cloudflare captcha widget for user-facing forms.
//
// Gated on the PUBLIC site key (NEXT_PUBLIC_TURNSTILE_SITE_KEY, a build-time var).
// When it's unset — local dev, self-host, any build without Turnstile provisioned
// — this renders NOTHING and the server skips verification (lib/turnstile.ts), so
// forms keep working with no captcha and the zero-scroll marketing landing stays
// zero-scroll. When the key IS set, it lazily loads the Turnstile script, renders
// the widget, and hands the solved token back via onToken.
//
// Token lifecycle: onToken(<token>) on solve; onToken("") on expiry/error so the
// parent clears any stale token. The parent sends the latest token with its POST.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
    }
  ): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __turnstileLoading?: Promise<void>;
  }
}

/** Whether the client widget is configured (mirror of server turnstileEnabled). */
export function turnstileConfigured(): boolean {
  return !!SITE_KEY;
}

// Load the Turnstile script once per page, shared across widget instances.
function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileLoading) return window.__turnstileLoading;
  window.__turnstileLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load"));
    document.head.appendChild(script);
  });
  return window.__turnstileLoading;
}

export function Turnstile({
  onToken,
  className,
  resetSignal,
}: {
  onToken: (token: string) => void;
  className?: string;
  /** Increment to reset the widget — tokens are single-use, so the parent must
   *  reset after any submit that consumed one (even a failed sign-in). */
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!resetSignal) return;
    onToken("");
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        /* widget already gone */
      }
    }
    // onToken is read via the live closure, same as the render effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
          theme: "auto",
          size: "flexible",
        });
      })
      .catch(() => {
        // Script blocked (ad-blocker / outage). Leave the token empty; the server
        // fails open on a siteverify outage, and rate limiting still applies.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget already gone */
        }
        widgetIdRef.current = null;
      }
    };
    // Render exactly once on mount; onToken is read via the live closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className={className} />;
}
