import Link from "next/link";
import type { Metadata } from "next";

// Public terms of service. Reachable signed-out, exactly like /privacy: hosted
// mode retires the auth gate, and self-host adds "/terms" to the gate's
// PUBLIC_PATHS (middleware.ts). The Sidebar hides itself here
// (components/layout/navbar.tsx), so this page renders its own chrome.
//
// Plain-language by design (this is a personal, open-source project, not a law
// firm). Covers eligibility, accounts, acceptable use, who owns the data, the
// not-financial-advice disclaimer (the app shows forecasts/insights), the
// as-is/liability terms, and the open-source/self-host carve-out.

export const metadata: Metadata = {
  title: "Terms — PARE",
  description: "The terms for using Pare's hosted service: accounts, acceptable use, your data, and disclaimers.",
};

const CONTACT_EMAIL = "terms@pare.money";
const LAST_UPDATED = "June 21, 2026";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function TermsPage() {
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
        <p className={labelClass}>Terms of service</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          The deal, in plain words.
        </h1>
        <p className="text-sm text-muted-foreground mt-3">Last updated: {LAST_UPDATED}</p>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          These terms are the agreement between you and Pare for using the hosted
          service at this site. By joining the waitlist, creating an account, or
          using Pare, you agree to them. If you don&apos;t agree, please don&apos;t
          use the service. Pare is a personal, open-source project — these terms
          are written in plain language, not legalese, but they still apply.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="The short version">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Use Pare for your own personal finances, lawfully, and don&apos;t abuse it.</li>
              <li>Your data is yours. We only process it to show you your own dashboards.</li>
              <li>
                Pare&apos;s insights and forecasts are estimates, not financial
                advice — don&apos;t treat them as a guarantee.
              </li>
              <li>
                The service is provided &ldquo;as is.&rdquo; It&apos;s early, and
                things may change, break, or pause.
              </li>
              <li>
                You can stop and delete everything at any time. We can suspend
                accounts that break these terms.
              </li>
              <li>
                Don&apos;t want to rely on us at all? Pare is open source and{" "}
                <span className="font-medium">self-hostable</span> — run your own
                copy and only the MIT license applies.
              </li>
            </ul>
          </Section>

          <Section title="Who can use Pare">
            <p>
              You must be at least 18 years old and able to form a binding
              agreement. Pare is offered to users in Canada and the United States;
              you&apos;re responsible for complying with the laws that apply where
              you are. The information you give us (such as your email) must be
              accurate and your own.
            </p>
          </Section>

          <Section title="Your account">
            <p>
              An account is for a single person — yours. You&apos;re responsible for
              keeping your password safe and for activity that happens under your
              account. We store your password only as a salted hash and can&apos;t
              read it, so keep it somewhere safe; we can&apos;t recover it for you.
              Tell us promptly if you believe your account has been accessed without
              your permission.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>When using Pare, you agree not to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Use it for anything unlawful, or to upload data you don&apos;t have the right to use.</li>
              <li>
                Upload statements or financial data belonging to someone else
                without their permission.
              </li>
              <li>
                Try to break, overload, probe, or circumvent the service, its
                security, its bot-protection, or its rate limits.
              </li>
              <li>
                Access other users&apos; data, or attempt to reach any account
                that isn&apos;t yours.
              </li>
              <li>
                Resell, sublicense, or pass off the hosted service as your own. (You
                are free to self-host the open-source code under its license.)
              </li>
            </ul>
            <p>
              We may suspend or close accounts that abuse the service or put others
              at risk.
            </p>
          </Section>

          <Section title="Your data and content">
            <p>
              The statements you upload and everything parsed from them stay{" "}
              <span className="font-medium">yours</span>. You grant Pare only the
              limited permission needed to host, process, and display that data back
              to you — for example, parsing a PDF, categorizing transactions, and
              drawing your charts. We don&apos;t sell it, share it for advertising,
              or use it to train anything. How we collect, store, and delete data is
              described in the{" "}
              <Link href="/privacy" className="underline">
                Privacy Policy
              </Link>
              , which is part of these terms.
            </p>
            <p>
              You&apos;re responsible for the accuracy of what you upload. Pare reads
              what your statements say; if a statement is wrong or a category is
              miscategorized, the numbers it shows will reflect that.
            </p>
          </Section>

          <Section title="Not financial advice">
            <p>
              Pare is a tool for organizing and visualizing your own spending, for{" "}
              <span className="font-medium">informational and educational
              purposes only</span>. Its summaries, trends, budgets, net-worth
              figures, and forecasts are estimates and illustrations — generated
              from the data you provide, not from a licensed professional. They are
              not financial, investment, tax, accounting, or legal advice, and they
              are not a promise of any future outcome.
            </p>
            <p>
              Because Pare works from the statements you give it, we don&apos;t
              guarantee its figures are accurate, complete, or applicable to your
              particular circumstances — and they may not match what your bank or
              card issuer shows, since parsing and categorization can differ.
              Forecasts in particular are projections that can be wrong, and
              statements lag the calendar, so figures may be incomplete.
            </p>
            <p>
              Don&apos;t rely on Pare alone to build a financial plan or to make a
              significant financial decision. Those decisions are your own — for
              advice about your specific situation, talk to a qualified
              professional.
            </p>
          </Section>

          <Section title="The service, as it is">
            <p>
              Pare is offered on an &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo; basis, and is still early — currently a waitlist and
              an evolving product. We may add, change, pause, or discontinue
              features, and we don&apos;t promise the service will always be
              available, uninterrupted, or error-free. We aren&apos;t a backup
              service: keep your own copies of important statements, and use the
              in-app export if you want your data offline.
            </p>
          </Section>

          <Section title="Open source and self-hosting">
            <p>
              Pare&apos;s source code is open and released under the{" "}
              <span className="font-medium">MIT License</span>. These terms govern
              the <span className="font-medium">hosted service</span> we run at this
              site; the MIT License governs the code itself. If you self-host your
              own copy, you do so under that license and at your own
              responsibility — these hosted terms, and our handling of your data,
              don&apos;t apply to an instance you run yourself.
            </p>
          </Section>

          <Section title="Disclaimers and liability">
            <p>
              To the fullest extent allowed by law, Pare is provided without
              warranties of any kind, express or implied, including merchantability,
              fitness for a particular purpose, and non-infringement.
            </p>
            <p>
              To the fullest extent allowed by law, Pare and its maintainer
              won&apos;t be liable for any indirect, incidental, special, or
              consequential damages, or for any lost data, lost profits, or
              decisions made in reliance on the service. Because Pare is currently
              offered free of charge, our total liability to you for any claim is
              limited accordingly. Some jurisdictions don&apos;t allow certain
              limitations, so parts of this may not apply to you.
            </p>
          </Section>

          <Section title="Ending things">
            <p>
              You can stop using Pare and{" "}
              <Link href="/profile" className="underline">
                permanently delete your account
              </Link>{" "}
              at any time — it&apos;s a real, hard delete with no recovery. We may
              suspend or terminate access if you break these terms or to protect the
              service and other users. Sections that should survive — your data
              ownership, disclaimers, and liability limits — continue to apply after
              your account ends.
            </p>
          </Section>

          <Section title="Governing law">
            <p>
              These terms are governed by the laws of the Province of British
              Columbia and the federal laws of Canada that apply there, without
              regard to conflict-of-laws rules. Courts located in British Columbia
              have jurisdiction, except where the law where you live gives you the
              right to bring a claim elsewhere.
            </p>
          </Section>

          <Section title="Changes and contact">
            <p>
              If these terms change in a meaningful way, we&apos;ll update the date
              at the top and, for material changes, let account holders know.
              Continuing to use Pare after a change means you accept the updated
              terms. Questions or concerns:{" "}
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
            href="/privacy"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Privacy
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
