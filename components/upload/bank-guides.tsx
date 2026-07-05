"use client";

import { PALETTE } from "@/lib/colors";

// Where to find the statement download in each bank's portal — the friction in
// "no bank login" onboarding isn't the upload, it's knowing where banks hide
// the PDF/OFX export. Generic, universal content only (same privacy rule as
// the starter taxonomy). Native <details> — no JS state to manage.
//
// Status mirrors the parser registry (CLAUDE.md "Coverage status"): CIBC +
// Amex are tuned against real PDFs; the rest are scaffolds, so OFX/QFX is the
// safer first import for them.

type Status = "pdf" | "beta" | "ofx";

interface Guide {
  bank: string;
  status: Status;
  // Public sign-in URL for the institution's online banking (generic, no
  // personal info) — the guides send you straight to the download page.
  login?: string;
  steps: string[];
}

const GUIDES: Guide[] = [
  {
    bank: "CIBC",
    status: "pdf",
    login: "https://www.cibconline.cibc.com/",
    steps: [
      "Sign in to CIBC Online Banking and open the account.",
      "Statements (under Documents / eStatements) → pick a month → Download PDF.",
      "Drop the PDF here — Visa and chequing statements are both fully supported.",
    ],
  },
  {
    bank: "American Express",
    status: "pdf",
    login: "https://www.americanexpress.com/en-ca/account/login/",
    steps: [
      "Sign in at americanexpress.ca → Statements & Activity.",
      "Billing statements → View PDF → download.",
      "Drop the PDF here — Amex statements are fully supported.",
    ],
  },
  {
    bank: "RBC",
    status: "beta",
    login: "https://www.rbcroyalbank.com/sign-in.html",
    steps: [
      "Online Banking → your account → Statements (or Documents) for the PDF.",
      "Safer first import: Download Transactions → format “Quicken (OFX)” → .qfx file.",
      "Drop either file here. If the PDF mis-parses, the OFX will always work — and a redacted sample helps us tune the parser.",
    ],
  },
  {
    bank: "TD",
    status: "beta",
    login: "https://easyweb.td.com/",
    steps: [
      "EasyWeb → Accounts → Statements & Documents for the monthly PDF.",
      "Safer first import: on the account activity page choose Export → “Quicken” (.qfx).",
      "Drop either file here — OFX/QFX is dedup-safe on re-import.",
    ],
  },
  {
    bank: "Scotiabank",
    status: "beta",
    login: "https://www.scotiaonline.scotiabank.com/online/authentication/authentication.bns",
    steps: [
      "Scotia OnLine → your account → Documents → eStatements for the PDF.",
      "Or export the account activity as OFX/QFX (Money/Quicken format).",
      "Drop either file here.",
    ],
  },
  {
    bank: "BMO",
    status: "beta",
    login: "https://www1.bmo.com/banking/digital/sign-in",
    steps: [
      "Online Banking → My Documents → eStatements for the monthly PDF.",
      "Or Download Transactions → “Quicken” (.qfx) from the account activity view.",
      "Drop either file here.",
    ],
  },
  {
    bank: "Tangerine",
    status: "beta",
    login: "https://www.tangerine.ca/login/",
    steps: [
      "Web login → Documents → Statements for the monthly PDF.",
      "Or Transactions → Download → OFX format.",
      "Drop either file here.",
    ],
  },
  {
    bank: "Wealthsimple",
    status: "beta",
    login: "https://my.wealthsimple.com/",
    steps: [
      "Web login → your account → Documents → Monthly statements (PDF).",
      "Cash and Save accounts both work; drop the PDF here.",
    ],
  },
  {
    bank: "Any other bank",
    status: "ofx",
    steps: [
      "Look for “Export”, “Download transactions”, or “Download for Quicken/Money” in the account activity view.",
      "Pick OFX / QFX (sometimes labelled Quicken or Money) — it's a universal format, and Pare's import is dedup-safe: re-importing an overlapping file never doubles anything.",
      "CSV isn't accepted (its dates are too lossy to dedup safely) — OFX/QFX is the reliable path.",
    ],
  },
];

const BADGE: Record<Status, { label: string; color: string }> = {
  pdf: { label: "PDF TUNED", color: PALETTE.sage },
  beta: { label: "PDF BETA · OFX SAFER", color: PALETTE.mustard },
  ofx: { label: "OFX / QFX", color: PALETTE.dustyblue },
};

export function BankGuides() {
  return (
    <div className="mt-6">
      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-3">
        WHERE TO GET YOUR STATEMENT
      </h2>
      <div className="border border-border divide-y divide-border">
        {GUIDES.map((g) => {
          const badge = BADGE[g.status];
          return (
            <details key={g.bank} className="group">
              <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden">
                <span className="font-mono text-sm">{g.bank}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span
                    className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 border"
                    style={{ borderColor: badge.color, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground group-open:hidden">+</span>
                  <span className="font-mono text-xs text-muted-foreground hidden group-open:inline">−</span>
                </span>
              </summary>
              <div className="px-4 pb-4 pt-1">
                <ol className="space-y-1.5 list-decimal list-inside">
                  {g.steps.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {s}
                    </li>
                  ))}
                </ol>
                {g.login && (
                  <a
                    href={g.login}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Go to {g.bank} login ↗
                  </a>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
