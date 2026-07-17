import Link from "next/link";
import type { Metadata } from "next";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

// Public privacy policy — the "proof, not promises" trust artifact from the
// offer-engineering doc (§4.2). Reachable signed-out: hosted mode retires the
// auth gate, and self-host adds "/privacy" to the gate's PUBLIC_PATHS. The
// Sidebar hides itself here (components/layout/navbar.tsx), so this page renders
// its own chrome.
//
// The rule for this page: back every privacy claim with a code path you can open
// on GitHub, not an adjective. The snippets below are lifted from the real files
// (lib/repo/index.ts DO routing, lib/queue/consumer.ts PDF deletion, lib/sentry.ts
// log scrubbing) and linked to their source. The legal declarations required for
// compliance (what's collected, retention, processors, deletion) stay intact —
// the narrative sits on top of them, it doesn't replace them.
//
// HONESTY: data at rest uses Cloudflare's platform-managed keys, NOT a per-user
// key only you hold — so there is no "we can never read your data" claim here.
// See /security's "Straight talk" section; keep the two pages consistent. Do not
// add a per-user-envelope-encryption claim until that ships.

export const metadata: Metadata = {
  title: "Privacy — PARE",
  description:
    "What Pare collects, where it's stored, how long it's kept, and how to delete it — each claim backed by the code path you can read on GitHub.",
};

const CONTACT_EMAIL = "privacy@pare.money";
// Security-disclosure contact per the launch brief. (General security posture
// lives on /security, which routes vuln reports to the same address.)
const SECURITY_CONTACT = "security@pare.money";
const REPO_URL = "https://github.com/itsgotpower/pare";
const LAST_UPDATED = "July 17, 2026";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

// A verifiable code snippet: the actual lines, plus a link to the file on GitHub
// so the reader can confirm the claim isn't marketing.
function Proof({ code, href, file }: { code: string; href: string; file: string }) {
  return (
    <div className="border border-border bg-secondary/40 mt-1">
      <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="block border-t border-border px-3.5 py-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        {file} — read it on GitHub →
      </a>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Top bar — this page has no app sidebar. */}
      <MarketingHeader />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>Privacy policy</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Proof, not promises.
        </h1>
        <p className="text-sm text-muted-foreground mt-3">Last updated: {LAST_UPDATED}</p>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare turns your bank and credit-card PDF statements into spending insights.
          That&apos;s about as sensitive as data gets, so this page doesn&apos;t ask
          you to take our word for anything. Where a privacy claim maps to code, the
          code is right here and linked to GitHub. The legal specifics — what&apos;s
          collected, how long it&apos;s kept, who processes it — are spelled out
          further down.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="The short version">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Every account gets its own isolated database. We don&apos;t pool your
                transactions with anyone else&apos;s.
              </li>
              <li>
                We never ask for bank logins. By default nothing connects to your
                bank — you upload statement PDFs yourself. The only exception is
                opt-in: self-hosted Pare can sync through SimpleFIN, a read-only
                bridge you pay and control directly.
              </li>
              <li>Uploaded PDFs are deleted right after they&apos;re parsed.</li>
              <li>We don&apos;t sell your data or run ad tracking.</li>
              <li>
                You can delete your account — and everything in it — at any time,
                yourself, from your profile.
              </li>
              <li>
                Prefer to trust no one? Pare is open source and{" "}
                <span className="font-medium">self-hostable</span>; run it on your own
                machine and none of this applies.
              </li>
            </ul>
          </Section>

          <Section title="Isolated per account — by construction">
            <p>
              Your financial data doesn&apos;t live in a shared table behind an{" "}
              <code className="font-mono text-xs">account_id</code> filter — the usual
              place multi-tenant apps spring a leak. Each account gets its own
              database (a Cloudflare Durable Object with a private SQLite store),
              addressed by your account ID. Different user, different database. There
              is no query in the app that can cross between them:
            </p>
            <Proof
              file="lib/repo/index.ts"
              href={`${REPO_URL}/blob/main/lib/repo/index.ts#L74-L86`}
              code={`// getRepoForUser — one Durable Object (one SQLite DB) per user
const id = namespace.idFromName(userId);
return repoOverDoStub(namespace.get(id));
// distinct userId -> distinct DO -> distinct DB,
// with no query that can cross between them.`}
            />
          </Section>

          <Section title="PDFs are deleted after parsing">
            <p>
              An uploaded PDF sits in object storage (Cloudflare R2) only long enough
              to be read into transactions, then it&apos;s dropped. We don&apos;t keep
              your original statements. The parse pipeline deletes the file as soon as
              it records a success — here&apos;s the exact line:
            </p>
            <Proof
              file="lib/queue/consumer.ts"
              href={`${REPO_URL}/blob/main/lib/queue/consumer.ts#L149-L186`}
              code={`// after a successful parse, the PDF is dropped
await jobStore.markDone(userId, jobId, { inserted, skipped });
await deletePdfBestEffort(pdfStore, r2Key, jobId); // -> pdfStore.delete(r2Key)

// and on account deletion, every stored object under
// the user's prefix is purged — see purgeUserPdfs()
// in lib/storage/pdf-store.ts.`}
            />
            <p>
              Deletion is the default, not an option you have to find. What stays is
              the parsed data — transactions, balances, the categories and goals you
              create — in your isolated database, until you remove it.
            </p>
          </Section>

          <Section title="No bank login, no aggregator by default, nothing sold">
            <p>
              The hosted service has no link to your financial institution.
              There&apos;s no &ldquo;connect your bank&rdquo; step, no stored bank
              credentials, and no third-party aggregator (Plaid and the like) sitting
              between you and your accounts. You export a statement PDF and hand it
              over — that&apos;s the entire ingest path, which means there&apos;s no
              standing connection for anyone to abuse or resell.
            </p>
            <p>
              The one exception is explicitly yours to choose: self-hosted Pare can
              optionally sync through{" "}
              <a
                href="https://www.simplefin.org/"
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                SimpleFIN Bridge
              </a>{" "}
              — a read-only service you sign up for and pay directly, and can revoke
              at any time. Even then, your bank credentials live at the bridge, never
              in Pare; Pare only holds an access token that can read transactions,
              nothing more. It is off until you turn it on.
            </p>
            <p>
              We do <span className="font-medium">not</span> sell your data, share it
              for advertising, or run analytics SDKs and ad trackers. There are none
              in the app; you can confirm that in the source.
            </p>
          </Section>

          <Section title="Open source — the app can outlive us">
            <p>
              Mint shut down and took its users&apos; workflow with it. Pare
              can&apos;t do that to you: the whole app is{" "}
              <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
                public on GitHub
              </a>{" "}
              and self-hostable. If the hosted service ever goes away, you run the
              same code on your own machine, where your data never leaves your
              computer. Open source is also why the claims on this page are
              checkable — you can read exactly what handles your data.
            </p>
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
              statement PDFs you upload, and everything parsed from them: transactions
              (date, description, amount), account balances, and the categories,
              rules, goals, and notes you create. This is your data; we process it
              only to show you your own dashboards.
            </p>
            <p>
              <span className="font-medium">Operational logs.</span> Basic request and
              error logs needed to keep the service running and to fix bugs — see{" "}
              <span className="font-medium">What we log</span> below for exactly how
              those are scrubbed.
            </p>
            <p>
              We do <span className="font-medium">not</span> collect analytics or
              advertising identifiers, and there are no third-party trackers.
            </p>
          </Section>

          <Section title="Where it&apos;s stored">
            <p>
              Pare runs entirely on <span className="font-medium">Cloudflare</span>.
              Within that:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Your financial data</span> lives in a
                per-account database (a Cloudflare Durable Object with its own SQLite
                store). One account, one database — there is no query that can reach
                another account&apos;s data.
              </li>
              <li>
                <span className="font-medium">Account identity</span> (email, name,
                password hash, sessions) lives in a separate authentication database
                (Cloudflare D1), kept apart from your financial data.
              </li>
              <li>
                <span className="font-medium">Uploaded PDFs</span> are held briefly in
                object storage (Cloudflare R2) only while they&apos;re being parsed,
                then deleted.
              </li>
              <li>
                <span className="font-medium">Upload job status</span> (a
                &ldquo;parsing… done&rdquo; record) sits in a short-lived key-value
                store (Cloudflare KV) and expires within a day.
              </li>
            </ul>
          </Section>

          <Section title="Encryption &amp; what it does — and doesn&apos;t — mean">
            <p>
              <span className="font-medium">In transit:</span> every connection is
              TLS-encrypted, end to end.
            </p>
            <p>
              <span className="font-medium">At rest:</span> your data is encrypted on
              disk by Cloudflare. To be precise — and this is where a lot of finance
              apps overstate things — those keys are managed by the platform, not
              derived from your password. That protects against a stolen disk or a
              storage dump; it is <span className="font-medium">not</span>{" "}
              zero-knowledge, and we don&apos;t claim &ldquo;only you can read your
              data.&rdquo; To parse statements and build your dashboards, the server
              works with your data in the clear, in memory, during that processing.
              The real isolation guarantee is the per-account database above, not a
              key only you hold. We spell this trade-off out on the{" "}
              <Link href="/security" className="underline">
                security page
              </Link>{" "}
              rather than paper over it.
            </p>
          </Section>

          <Section title="What we log">
            <p>
              There are no analytics or advertising trackers. We keep basic
              operational and error logs to run the service and fix bugs, and error
              reports are scrubbed of personal data before anything is recorded —
              email addresses are masked, and auth tokens, cookies, request bodies,
              and query strings are stripped out:
            </p>
            <Proof
              file="lib/sentry.ts"
              href={`${REPO_URL}/blob/main/lib/sentry.ts`}
              code={`sendDefaultPii: false, // no IPs, cookies, or user records attached
// beforeSend redacts before the event leaves the process:
const REDACT_HEADERS = ["authorization", "cookie", "set-cookie", "x-captcha-response"];
delete request.cookies;          // drop cookies + bodies + query strings whole
value.replace(EMAIL_RE, "[email]"); // mask any email that slips into a message`}
            />
          </Section>

          <Section title="How long we keep it">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">Uploaded PDFs:</span> deleted immediately
                after parsing — they aren&apos;t meant to outlive the upload.
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
                <span className="font-medium">Error logs:</span> retained briefly for
                debugging and already stripped of personal data.
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
              your entire per-account database, purge any stored PDFs, and delete your
              sign-in identity. There is no soft-delete and no recovery — once
              it&apos;s gone, it&apos;s gone.
            </p>
            <p>
              Want to keep your data but clear it out? The same page lets you wipe your
              transactions while keeping your account and rules, or export everything
              (CSV/JSON) first.
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
              <span className="font-medium">Cloudflare Turnstile</span> on the sign-up
              and sign-in forms to block bots; it may set a token in your browser
              solely to confirm you&apos;re human, and is not used to track you.
            </p>
            <p>
              <span className="font-medium">Resend</span> sends transactional email
              (such as password resets) when that feature is enabled. We don&apos;t use
              any other third parties to process your data, and we never sell or share
              it for advertising.
            </p>
          </Section>

          <Section title="Where we operate">
            <p>
              Pare is offered to users in Canada and the United States. Cloudflare
              processes data across its global network; your account&apos;s database is
              a single logical store within that network.
            </p>
          </Section>

          <Section title="Reporting a security issue">
            <p>
              Found something that looks like a data-exposure or security bug? Email{" "}
              <a href={`mailto:${SECURITY_CONTACT}`} className="underline">
                {SECURITY_CONTACT}
              </a>{" "}
              with the details and how to reproduce it, and please don&apos;t test
              against other people&apos;s accounts — self-host an instance to probe
              instead. More on the security posture, and the limits we&apos;re honest
              about, on the{" "}
              <Link href="/security" className="underline">
                security page
              </Link>
              .
            </p>
          </Section>

          <Section title="Changes &amp; contact">
            <p>
              If this policy changes in a meaningful way, we&apos;ll update the date at
              the top and, for material changes, let account holders know. Questions,
              requests, or concerns:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>

      <MarketingFooter current="/privacy" />
    </div>
  );
}
