import Link from "next/link";
import type { Metadata } from "next";

// Public security/trust page. Reachable signed-out (added to middleware.ts
// PUBLIC_PATHS + WAITLIST_PUBLIC). The Sidebar hides itself here, so this page
// renders its own chrome — same pattern as /privacy and /terms.
//
// EVERY claim on this page is verified against the actual code. The hard rule:
// describe what ships TODAY, not the roadmap. In particular, data at rest is
// encrypted by Cloudflare (operator-managed keys) — NOT under a key only the
// user holds — so there is no "zero-knowledge" / "we can't see your data" claim
// here. The honest "Straight talk" section says so explicitly. If user-key
// envelope encryption ever ships (the Model-B spike was removed from tree —
// see git history for lib/repo/web-crypto-box.ts), update the "At rest" +
// "Straight talk" sections; don't promise it before it ships.

export const metadata: Metadata = {
  title: "Security — PARE",
  description:
    "How Pare protects your financial data: per-account isolation, ephemeral PDFs, hard deletion, and the trade-offs we're honest about.",
};

const SECURITY_EMAIL = "security@pare.money";
const REPO_URL = "https://github.com/itsgotpower/pare";
const LAST_UPDATED = "June 16, 2026";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function SecurityPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Top bar — this page has no app sidebar. */}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-border">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          PARE
        </Link>
        <Link
          href="/"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </Link>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>Security &amp; trust</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Built to hold your money data carefully.
        </h1>
        <p className="text-sm text-muted-foreground mt-3">Last updated: {LAST_UPDATED}</p>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare reads your bank and credit-card PDF statements. That&apos;s about as
          sensitive as data gets, so this page lays out how the app is built to
          protect it — and, just as importantly, the trade-offs we&apos;re honest
          about rather than papering over. Everything here describes how Pare works
          today, not a roadmap.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="The short version">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Every account gets its own isolated database. There is no query in
                the app that can reach another account&apos;s data.
              </li>
              <li>
                We never ask for your bank login and don&apos;t use account
                aggregators. You hand us a PDF; nothing connects to your bank.
              </li>
              <li>Uploaded PDFs are deleted the moment they&apos;re parsed.</li>
              <li>Everything is encrypted in transit (TLS) and at rest.</li>
              <li>No analytics, no ad trackers, no data selling.</li>
              <li>
                You can hard-delete your account and everything in it, yourself, at
                any time.
              </li>
              <li>
                The whole app is{" "}
                <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
                  open source
                </a>{" "}
                — you can read exactly what it does, and self-host it if you&apos;d
                rather trust no one.
              </li>
            </ul>
          </Section>

          <Section title="Per-account isolation">
            <p>
              Your financial data doesn&apos;t sit in a shared table behind an{" "}
              <code className="font-mono text-xs">account_id</code> filter — the
              usual place multi-tenant apps spring a leak. Instead,{" "}
              <span className="font-medium">each account gets its own database</span>{" "}
              (a Cloudflare Durable Object with a private SQLite store).
            </p>
            <p>
              The database is addressed by your account ID, so every request is
              routed to <span className="font-medium">your</span> store and only
              yours. There is no code path that can query across accounts — the
              boundary is enforced by construction, not by a{" "}
              <code className="font-mono text-xs">WHERE</code> clause someone could
              forget. We keep automated tests that prove two accounts can&apos;t see
              each other&apos;s data.
            </p>
          </Section>

          <Section title="You upload PDFs — we never touch your bank">
            <p>
              Pare has no link to your financial institution. There&apos;s no
              &ldquo;connect your bank&rdquo; step, no stored bank credentials, and
              no third-party aggregator (Plaid and the like) sitting between you and
              your accounts. You export a statement PDF and upload it. That&apos;s
              the whole pipeline — which means there&apos;s no standing connection
              for anyone to abuse.
            </p>
          </Section>

          <Section title="PDFs are ephemeral">
            <p>
              An uploaded PDF lives in object storage (Cloudflare R2) only long
              enough to be parsed into transactions, then it&apos;s deleted. We
              don&apos;t keep a copy of your original statements. The parsed
              numbers — transactions, balances, the categories and goals you
              create — are what stays, in your isolated database, until you remove
              them.
            </p>
          </Section>

          <Section title="Encryption">
            <p>
              <span className="font-medium">In transit:</span> every connection is
              TLS-encrypted, end to end.
            </p>
            <p>
              <span className="font-medium">At rest:</span> your data is encrypted on
              disk by Cloudflare, our infrastructure provider. To be precise about
              what that means: the encryption keys are managed by the platform, not
              derived from your password — so this protects against a stolen disk or
              storage dump, not against Pare&apos;s own running server (see{" "}
              <span className="font-medium">Straight talk</span> below). We don&apos;t
              overstate this.
            </p>
          </Section>

          <Section title="Accounts &amp; sign-in">
            <p>
              Passwords are never stored in readable form — only as a salted hash.
              Sign-in supports <span className="font-medium">passkeys</span>{" "}
              (WebAuthn), so you can skip passwords entirely and use your
              device&apos;s biometrics. Sessions are carried in a hardened,
              HTTP-only cookie.
            </p>
            <p>
              Sign-in, sign-up, and password-reset endpoints are rate-limited to
              blunt brute-force and abuse, and sensitive forms run a bot check.
            </p>
          </Section>

          <Section title="No tracking, scrubbed logs">
            <p>
              There are no analytics SDKs, advertising identifiers, or third-party
              trackers in Pare. We keep basic operational logs to run the service
              and fix bugs, and our error reporting is{" "}
              <span className="font-medium">scrubbed of personal data</span> before
              anything is recorded — email addresses, auth tokens, cookies, and
              request bodies are stripped out.
            </p>
          </Section>

          <Section title="Delete everything, yourself">
            <p>
              From your{" "}
              <Link href="/profile" className="underline">
                profile
              </Link>{" "}
              you can permanently delete your account. It&apos;s a real, hard
              delete: your entire per-account database is dropped, any stored PDFs
              are purged, and your sign-in identity is removed. No soft-delete, no
              tombstone, no recovery. You can also export everything (CSV/JSON)
              first, or wipe transactions while keeping your account.
            </p>
          </Section>

          <Section title="Open source &amp; self-hostable">
            <p>
              Pare&apos;s source is{" "}
              <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
                public on GitHub
              </a>
              . You don&apos;t have to take any of the above on faith — you can read
              the code that handles your data. And if you&apos;d rather not trust a
              hosted service at all, you can run Pare entirely on your own machine,
              where your data never leaves your computer.
            </p>
          </Section>

          <Section title="Straight talk about the limits">
            <p>
              Security pages love absolutes. Here&apos;s where we won&apos;t use
              them, because they&apos;d be untrue:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Pare is not zero-knowledge.</span> To
                parse your statements and build your dashboards, the server works
                with your data in the clear, in memory, during that processing.
                At-rest encryption uses platform-managed keys, so a claim like
                &ldquo;we can never see your data&rdquo; would be false. We&apos;d
                rather say it plainly.
              </li>
              <li>
                <span className="font-medium">We don&apos;t guarantee a storage region.</span>{" "}
                Data runs on Cloudflare&apos;s global network; we don&apos;t pin it to
                a specific country today.
              </li>
              <li>
                <span className="font-medium">No SOC 2 report yet.</span> Pare is
                early. The controls above are real and you can verify them in the
                source, but we haven&apos;t gone through a formal third-party audit.
                If you need one for a business use, tell us — that&apos;s exactly the
                kind of demand that decides when we pursue it.
              </li>
            </ul>
            <p>
              The honest version: strong isolation, no data selling, ephemeral
              statements, and open code you can inspect — and full control if you
              self-host.
            </p>
          </Section>

          <Section title="Reporting a vulnerability">
            <p>
              Found a security issue? Please email{" "}
              <a href={`mailto:${SECURITY_EMAIL}`} className="underline">
                {SECURITY_EMAIL}
              </a>{" "}
              with the details and how to reproduce it. We&apos;ll acknowledge it,
              keep you posted on the fix, and credit you if you&apos;d like. Please
              don&apos;t test against other people&apos;s accounts or data —
              self-host an instance to probe instead.
            </p>
          </Section>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Terms
          </Link>
        </div>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          pare
        </Link>
      </footer>
    </div>
  );
}
