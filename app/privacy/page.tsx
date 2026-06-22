import Link from "next/link";
import type { Metadata } from "next";

// Public privacy policy. Reachable signed-out: hosted mode retires the auth gate,
// and self-host adds "/privacy" to the gate's PUBLIC_PATHS. The Sidebar hides
// itself here (components/layout/navbar.tsx), so this page renders its own chrome.
//
// Plain-language by design (this is a personal project, not a law firm). Covers
// what's collected, where it lives (the actual Cloudflare bindings), retention,
// deletion (-> the in-app Delete account flow), and the Cloudflare/Turnstile
// processor relationship.

export const metadata: Metadata = {
  title: "Privacy — PARE",
  description: "What Pare collects, where it's stored, how long it's kept, and how to delete it.",
};

const CONTACT_EMAIL = "privacy@pare.money";
const LAST_UPDATED = "June 13, 2026";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Top bar — this page has no app sidebar. */}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-14 border-b border-border">
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
        <p className={labelClass}>Privacy policy</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Your money data, handled plainly.
        </h1>
        <p className="text-sm text-muted-foreground mt-3">
          Last updated: {LAST_UPDATED}
        </p>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare turns your bank and credit-card PDF statements into spending
          insights. It handles financial data, so this page spells out exactly
          what we collect, where it lives, how long we keep it, and how to delete
          it. No dark patterns, no data selling — that&apos;s the whole pitch.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="The short version">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Every account gets its own isolated database. We don&apos;t pool
                your transactions with anyone else&apos;s.
              </li>
              <li>
                We never ask for bank logins or use account aggregators. You upload
                statement PDFs yourself.
              </li>
              <li>Uploaded PDFs are deleted right after they&apos;re parsed.</li>
              <li>We don&apos;t sell your data or run ad tracking.</li>
              <li>
                You can delete your account — and everything in it — at any time,
                yourself, from your profile.
              </li>
              <li>
                Prefer to trust no one? Pare is open source and{" "}
                <span className="font-medium">self-hostable</span>; run it on your
                own machine and none of this applies.
              </li>
            </ul>
          </Section>

          <Section title="What we collect">
            <p>
              <span className="font-medium">Account identity.</span> Your email
              address and a display name, used to sign you in and to send
              account-related email (like password resets). Your password is stored
              only as a salted hash — we can&apos;t read it.
            </p>
            <p>
              <span className="font-medium">Financial data you give us.</span> The
              statement PDFs you upload, and everything parsed from them:
              transactions (date, description, amount), account balances, and the
              categories, rules, goals, and notes you create. This is your data; we
              process it only to show you your own dashboards.
            </p>
            <p>
              <span className="font-medium">Operational logs.</span> Basic request
              and error logs needed to keep the service running and to fix bugs.
              Error reports are scrubbed of personal data — email addresses, auth
              tokens, cookies, and request bodies are stripped before anything is
              recorded.
            </p>
            <p>
              We do <span className="font-medium">not</span> collect analytics or
              advertising identifiers, and there are no third-party trackers.
            </p>
          </Section>

          <Section title="Where it&apos;s stored">
            <p>
              Pare runs entirely on{" "}
              <span className="font-medium">Cloudflare</span>. Within that:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Your financial data</span> lives in a
                per-account database (a Cloudflare Durable Object with its own
                SQLite store). One account, one database — there is no query that
                can reach another account&apos;s data.
              </li>
              <li>
                <span className="font-medium">Account identity</span> (email, name,
                password hash, sessions) lives in a separate authentication database
                (Cloudflare D1), kept apart from your financial data.
              </li>
              <li>
                <span className="font-medium">Uploaded PDFs</span> are held briefly
                in object storage (Cloudflare R2) only while they&apos;re being
                parsed, then deleted.
              </li>
              <li>
                <span className="font-medium">Upload job status</span> (a
                &ldquo;parsing… done&rdquo; record) sits in a short-lived key-value
                store (Cloudflare KV) and expires within a day.
              </li>
            </ul>
            <p>Everything is encrypted in transit (TLS) and at rest by Cloudflare.</p>
          </Section>

          <Section title="How long we keep it">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Uploaded PDFs:</span> deleted
                immediately after parsing — they aren&apos;t meant to outlive the
                upload.
              </li>
              <li>
                <span className="font-medium">Parsed financial data &amp; account:</span>{" "}
                kept until you delete it or close your account.
              </li>
              <li>
                <span className="font-medium">Upload job records:</span> auto-expire
                within 24 hours.
              </li>
              <li>
                <span className="font-medium">Error logs:</span> retained briefly
                for debugging and already stripped of personal data.
              </li>
            </ul>
          </Section>

          <Section title="Deleting your data">
            <p>
              You can permanently delete your account from your{" "}
              <Link href="/profile" className="underline">
                profile page
              </Link>{" "}
              (Danger zone → Delete account). It&apos;s a real, hard delete: we drop
              your entire per-account database, remove any stored PDFs, and delete
              your sign-in identity. There is no soft-delete and no recovery — once
              it&apos;s gone, it&apos;s gone.
            </p>
            <p>
              Want to keep your data but clear it out? The same page lets you wipe
              your transactions while keeping your account and rules, or export
              everything (CSV/JSON) first.
            </p>
            <p>
              If you&apos;d rather we handle a deletion or have a question about your
              data, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section title="Who else is involved">
            <p>
              <span className="font-medium">Cloudflare</span> is our infrastructure
              provider (a data processor): the app, databases, storage, and the
              bot-protection step all run on Cloudflare. We use{" "}
              <span className="font-medium">Cloudflare Turnstile</span> on the
              waitlist and sign-in forms to block bots; it may set a token in your
              browser solely to confirm you&apos;re human, and is not used to track
              you.
            </p>
            <p>
              <span className="font-medium">Resend</span> sends transactional email
              (such as password resets) when that feature is enabled. We don&apos;t
              use any other third parties to process your data, and we never sell or
              share it for advertising.
            </p>
          </Section>

          <Section title="Where we operate">
            <p>
              Pare is offered to users in Canada and the United States. Cloudflare
              processes data across its global network; your account&apos;s database
              is a single logical store within that network.
            </p>
          </Section>

          <Section title="Changes &amp; contact">
            <p>
              If this policy changes in a meaningful way, we&apos;ll update the date
              at the top and, for material changes, let account holders know.
              Questions, requests, or concerns:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/terms"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Terms
          </Link>
          <Link
            href="/security"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Security
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
