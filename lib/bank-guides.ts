// Where to find the statement download in each bank's portal.
//
// The friction in "no bank login" onboarding isn't the upload — it's knowing
// where banks hide the PDF/OFX export. This module is the ONE source of truth
// for that knowledge, consumed by two surfaces:
//
//   1. components/upload/bank-guides.tsx — the accordion on /upload, for someone
//      who is already mid-onboarding and just needs the steps.
//   2. app/guides/* — public, indexable pages, for someone who searched
//      "how to download my CIBC statement" and has never heard of Pare.
//
// Surface 2 is why the entries carry more than `steps`: `intro`, `formats` and
// `note` exist so a standalone page has something to say beyond a bare list.
// The upload accordion ignores those fields.
//
// Generic, universal content only — same privacy rule as the starter taxonomy.
// No personal account details, no merchant names.
//
// `status` mirrors the parser registry (CLAUDE.md "Coverage status"): CIBC +
// Amex (CA + US) are tuned against real PDFs; the rest are scaffolds, so OFX/QFX is the
// safer first import. Keep this in sync with lib/parser/_SCAFFOLD_BANKS — a
// bank whose parser graduates from scaffold to tuned should move to "pdf".

export type GuideStatus = "pdf" | "beta" | "ofx";
export type Region = "CA" | "US" | "any";

export const REGION_LABEL: Record<Region, string> = {
  CA: "Canada",
  US: "United States",
  any: "Any bank",
};

export interface BankGuide {
  /** URL segment for /guides/<slug>. Stable — changing one breaks a live URL. */
  slug: string;
  /** Display name, as the bank brands itself. */
  bank: string;
  status: GuideStatus;
  /** One-sentence orientation for the standalone page. Not shown on /upload. */
  intro: string;
  /** The actual click path. Shown on both surfaces. */
  steps: string[];
  /** Which file formats this bank offers. Not shown on /upload. */
  formats: string;
  /** Honest caveat or tip specific to this bank. Not shown on /upload. */
  note: string;
  /**
   * Public sign-in URL for the institution's online banking (generic, no
   * personal info) — the guides send you straight to the download page.
   * Omitted for the catch-all entry, which has no single bank to link to.
   */
  login?: string;
  /**
   * Which country's institution this is. Drives grouping on /guides and in the
   * /upload accordion — a flat list of every bank is unscannable. "any" is for
   * entries that aren't country-specific (Amex, the catch-all).
   */
  region: Region;
}

export const BANK_GUIDES: BankGuide[] = [
  {
    slug: "cibc",
    region: "CA",
    login: "https://www.cibconline.cibc.com/",
    bank: "CIBC",
    status: "pdf",
    intro:
      "CIBC publishes monthly eStatements as PDFs for both Visa and chequing accounts. Pare's parser is tuned against real CIBC statements, so the PDF path is the best one here.",
    steps: [
      "Sign in to CIBC Online Banking and open the account.",
      "Statements (under Documents / eStatements) → pick a month → Download PDF.",
      "Drop the PDF into Pare — Visa and chequing statements are both fully supported.",
    ],
    formats: "PDF (recommended). CIBC also offers OFX/QFX export from account activity.",
    note:
      "CIBC chequing statements reconcile against the printed closing balance, so if a row fails to parse Pare skips it rather than guessing — you'll never get corrupt totals.",
  },
  {
    slug: "american-express",
    region: "any",
    login: "https://www.americanexpress.com/en-ca/account/login/",
    bank: "American Express",
    status: "pdf",
    intro:
      "Amex billing statements are PDFs organised by closing date. Pare's Amex parsers are tuned against real statements for both the Canadian (americanexpress.ca) and US (americanexpress.com) layouts, and handle the year-rollover case (December charges on a January-closing statement).",
    steps: [
      "Sign in at americanexpress.ca (Canada) or americanexpress.com (US) → Statements & Activity.",
      "Billing statements → View PDF → download.",
      "Drop the PDF into Pare — Amex statements are fully supported.",
    ],
    formats: "PDF (recommended).",
    note:
      "Amex statements are dated by the closing date, not the calendar month, so a statement closing January 5 mostly contains December spending. Pare handles that automatically.",
  },
  {
    slug: "rbc",
    region: "CA",
    login: "https://www.rbcroyalbank.com/sign-in.html",
    bank: "RBC",
    status: "beta",
    intro:
      "RBC offers both PDF statements and a Quicken (OFX) export. Pare's RBC PDF parser is a scaffold — built from documented layouts, not yet tuned against real statements — so OFX is the safer first import.",
    steps: [
      "Online Banking → your account → Statements (or Documents) for the PDF.",
      "Safer first import: Download Transactions → format “Quicken (OFX)” → .qfx file.",
      "Drop either file into Pare. If the PDF mis-parses, the OFX will always work.",
    ],
    formats: "PDF (beta) and OFX/QFX (recommended).",
    note:
      "If the PDF mis-parses, a redacted sample genuinely helps — the RBC parser needs a regex pass against a real statement, and that's the only way it gets one.",
  },
  {
    slug: "td",
    region: "CA",
    login: "https://easyweb.td.com/",
    bank: "TD",
    status: "beta",
    intro:
      "TD EasyWeb provides monthly PDF statements and a Quicken export. The TD PDF parser is a scaffold, so start with OFX/QFX if you want a guaranteed-clean first import.",
    steps: [
      "EasyWeb → Accounts → Statements & Documents for the monthly PDF.",
      "Safer first import: on the account activity page choose Export → “Quicken” (.qfx).",
      "Drop either file into Pare — OFX/QFX is dedup-safe on re-import.",
    ],
    formats: "PDF (beta) and OFX/QFX (recommended).",
    note:
      "TD's export window is limited to a rolling period, so pull OFX regularly or use PDFs for older history.",
  },
  {
    slug: "scotiabank",
    region: "CA",
    login: "https://www.scotiaonline.scotiabank.com/online/authentication/authentication.bns",
    bank: "Scotiabank",
    status: "beta",
    intro:
      "Scotia OnLine keeps eStatements under Documents. The Scotiabank PDF parser is a scaffold, so the OFX/QFX export is the more reliable first import.",
    steps: [
      "Scotia OnLine → your account → Documents → eStatements for the PDF.",
      "Or export the account activity as OFX/QFX (Money/Quicken format).",
      "Drop either file into Pare.",
    ],
    formats: "PDF (beta) and OFX/QFX (recommended).",
    note:
      "Scotiabank labels the export format “Money” or “Quicken” depending on the account type — both are OFX under the hood and both work.",
  },
  {
    slug: "bmo",
    region: "CA",
    login: "https://www1.bmo.com/banking/digital/sign-in",
    bank: "BMO",
    status: "beta",
    intro:
      "BMO files eStatements under My Documents and offers a Quicken export from the account activity view. The BMO PDF parser is a scaffold.",
    steps: [
      "Online Banking → My Documents → eStatements for the monthly PDF.",
      "Or Download Transactions → “Quicken” (.qfx) from the account activity view.",
      "Drop either file into Pare.",
    ],
    formats: "PDF (beta) and OFX/QFX (recommended).",
    note:
      "BMO card and chequing statements use different layouts; both are scaffolded, so check the parsed totals against the statement summary on your first upload.",
  },
  {
    slug: "tangerine",
    region: "CA",
    login: "https://www.tangerine.ca/login/",
    bank: "Tangerine",
    status: "beta",
    intro:
      "Tangerine offers monthly PDF statements and an OFX download. Chequing and savings are separate accounts and each needs its own import.",
    steps: [
      "Web login → Documents → Statements for the monthly PDF.",
      "Or Transactions → Download → OFX format.",
      "Drop either file into Pare.",
    ],
    formats: "PDF (beta) and OFX (recommended).",
    note:
      "Tangerine savings and chequing parse through different handlers. If you hold both, import them separately so each account gets its own balance anchor.",
  },
  {
    slug: "wealthsimple",
    region: "CA",
    login: "https://my.wealthsimple.com/",
    bank: "Wealthsimple",
    status: "beta",
    intro:
      "Wealthsimple issues monthly PDF statements for Cash and Save accounts. The parser is a scaffold built from documented layouts.",
    steps: [
      "Web login → your account → Documents → Monthly statements (PDF).",
      "Cash and Save accounts both work; drop the PDF into Pare.",
    ],
    formats: "PDF (beta).",
    note:
      "Wealthsimple doesn't offer an OFX export, so PDF is the only path. Check your first import's totals against the statement summary.",
  },
  {
    slug: "chase",
    region: "US",
    bank: "Chase",
    status: "ofx",
    intro:
      "Chase offers a Quicken (.qfx) download alongside CSV, which is the format to use — Pare has no Chase PDF parser, so the statement PDF is not the path here.",
    steps: [
      "Sign in at chase.com and open the account.",
      "Account activity → the download icon (or “Download account activity”).",
      "Choose a date range and pick the Quicken (.QFX) file type — not CSV, not the PDF.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "Chase also offers CSV, but Pare's upload drop zone doesn't accept CSV — its dates are too lossy to dedup safely. QFX carries a bank-assigned transaction id, which is what makes re-importing an overlapping range harmless.",
    login: "https://www.chase.com/",
  },
  {
    slug: "bank-of-america",
    region: "US",
    bank: "Bank of America",
    status: "ofx",
    intro:
      "Bank of America exports Quicken-format files from the account activity view. Use that rather than the PDF statement — Pare has no BofA PDF parser.",
    steps: [
      "Sign in at bankofamerica.com and open the account.",
      "Statements & Documents holds the PDFs; for Pare you want the export instead.",
      "From account activity choose Download, then the Quicken (.qfx) format.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "BofA limits how far back the export reaches on some accounts. If you want more history than it offers, pull several shorter ranges — re-importing overlapping files is safe, because dedup keys on the bank's own transaction id.",
    login: "https://www.bankofamerica.com/",
  },
  {
    slug: "wells-fargo",
    region: "US",
    bank: "Wells Fargo",
    status: "ofx",
    intro:
      "Wells Fargo's “Download Account Activity” produces a Quicken (.qfx) file, which is the reliable path into Pare. The PDF statement has no parser here.",
    steps: [
      "Sign in at wellsfargo.com and open the account.",
      "Find Download Account Activity (near the transaction list).",
      "Pick a date range and the Quicken (.qfx) format.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "Wells Fargo's export window is limited, so pull it regularly rather than trying to backfill years at once.",
    login: "https://www.wellsfargo.com/",
  },
  {
    slug: "citi",
    region: "US",
    bank: "Citi",
    status: "ofx",
    intro:
      "Citi keeps statements under the account's Statements section and offers a transaction download. Formats vary by product, so check what your account exposes.",
    steps: [
      "Sign in at citi.com and open the account.",
      "Look for Download / Export near the transaction list.",
      "Choose a Quicken or OFX/QFX format if it's offered.",
      "Drop the file into Pare.",
    ],
    formats: "OFX/QFX where offered. PDF statements exist but Pare can't parse them.",
    note:
      "Citi's export formats differ between card and deposit accounts, and CSV is sometimes the only option — which Pare's drop zone doesn't accept. If you can't get OFX/QFX from Citi, the honest answer is that Pare isn't a good fit for that account yet.",
    login: "https://www.citi.com/",
  },
  {
    slug: "capital-one",
    region: "US",
    bank: "Capital One",
    status: "ofx",
    intro:
      "Capital One offers a transaction export from the account activity view. Availability of the Quicken format varies by product.",
    steps: [
      "Sign in at capitalone.com and open the account.",
      "Open account activity and look for Download / Export transactions.",
      "Pick Quicken (.qfx) if offered.",
      "Drop the file into Pare.",
    ],
    formats: "OFX/QFX where offered. PDF statements exist but Pare can't parse them.",
    note:
      "Some Capital One products only export CSV, which Pare's drop zone doesn't accept. Check the format list before planning around it.",
    login: "https://www.capitalone.com/",
  },
  {
    slug: "us-bank",
    region: "US",
    bank: "U.S. Bank",
    status: "ofx",
    intro:
      "U.S. Bank exports Quicken-format transaction files, which is the path into Pare — there's no U.S. Bank PDF parser.",
    steps: [
      "Sign in at usbank.com and open the account.",
      "From transactions, choose Download / Export.",
      "Pick the Quicken (.qfx) format.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "If the download page offers both “Quicken” and “Quicken Web Connect”, either produces an OFX-family file Pare reads.",
    login: "https://www.usbank.com/",
  },
  {
    slug: "pnc",
    region: "US",
    bank: "PNC",
    status: "ofx",
    intro:
      "PNC offers a Quicken/QFX export from online banking. Use it rather than the PDF — Pare has no PNC PDF parser.",
    steps: [
      "Sign in at pnc.com and open the account.",
      "From the activity view choose Download transactions.",
      "Pick the Quicken (.qfx) format.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "PNC's export range is capped per download; several shorter pulls are fine because overlapping re-imports dedup on the bank's transaction id.",
    login: "https://www.pnc.com/",
  },
  {
    slug: "discover",
    region: "US",
    bank: "Discover",
    status: "ofx",
    intro:
      "Discover offers transaction downloads including a Quicken format. Use that rather than the statement PDF.",
    steps: [
      "Sign in at discover.com and open the account.",
      "Go to Statements / Activity and choose Download transactions.",
      "Pick Quicken (.qfx) rather than CSV or Excel.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "Discover's downloads are organised per statement period, so grabbing a year means several files. Import them all — duplicates across overlapping files are handled.",
    login: "https://www.discover.com/",
  },
  {
    slug: "ally",
    region: "US",
    bank: "Ally",
    status: "ofx",
    intro:
      "Ally Bank exports transactions in Quicken format from the account activity view. That's the path into Pare.",
    steps: [
      "Sign in at ally.com and open the account.",
      "Open account activity and choose Download.",
      "Pick the Quicken (.qfx) format.",
      "Drop the .qfx into Pare.",
    ],
    formats: "OFX/QFX (recommended). PDF statements exist but Pare can't parse them.",
    note:
      "Ally's savings buckets appear inside one account rather than as separate accounts, so a single export can mix them. Pare treats the file as one account — which is usually what you want.",
    login: "https://www.ally.com/",
  },
  {
    slug: "charles-schwab",
    region: "US",
    bank: "Charles Schwab",
    status: "ofx",
    intro:
      "Schwab's bank and brokerage accounts both offer transaction exports. Pare reads the cash-side transactions; it does not do holdings-level investment analysis.",
    steps: [
      "Sign in at schwab.com and open the account.",
      "History / Transactions → Export.",
      "Pick a Quicken or OFX/QFX format if offered.",
      "Drop the file into Pare.",
    ],
    formats: "OFX/QFX where offered. PDF statements exist but Pare can't parse them.",
    note:
      "Pare has no portfolio tracking — it will read Schwab cash transactions as an account, but positions, cost basis and performance are outside what it does. Net worth supports manual entries for investments instead.",
    login: "https://www.schwab.com/",
  },
  {
    slug: "truist",
    region: "US",
    bank: "Truist",
    status: "ofx",
    intro:
      "Truist offers transaction downloads from online banking. Formats vary by account following the BB&T/SunTrust merger, so check what yours exposes.",
    steps: [
      "Sign in at truist.com and open the account.",
      "From account activity choose Download / Export.",
      "Pick a Quicken or OFX/QFX format if offered.",
      "Drop the file into Pare.",
    ],
    formats: "OFX/QFX where offered. PDF statements exist but Pare can't parse them.",
    note:
      "Legacy BB&T and SunTrust accounts still behave differently in places. If the export only offers CSV, Pare's drop zone won't take it.",
    login: "https://www.truist.com/",
  },
  {
    slug: "navy-federal",
    region: "US",
    bank: "Navy Federal",
    status: "ofx",
    intro:
      "Navy Federal offers transaction exports from account history, including Quicken-compatible formats on most accounts.",
    steps: [
      "Sign in at navyfederal.org and open the account.",
      "Account history → Export / Download.",
      "Pick a Quicken or OFX/QFX format if offered.",
      "Drop the file into Pare.",
    ],
    formats: "OFX/QFX where offered. PDF statements exist but Pare can't parse them.",
    note:
      "Export options are narrower than at the large national banks. If OFX/QFX isn't offered for your account type, Pare can't ingest it today.",
    login: "https://www.navyfederal.org/",
  },
  {
    slug: "any-other-bank",
    region: "any",
    bank: "Any other bank",
    status: "ofx",
    intro:
      "Pare doesn't need a parser for your specific bank if you can export OFX or QFX. Nearly every bank offers it — it's the format Quicken and Microsoft Money used, so it long predates the modern aggregators.",
    steps: [
      "Look for “Export”, “Download transactions”, or “Download for Quicken/Money” in the account activity view.",
      "Pick OFX / QFX (sometimes labelled Quicken or Money) — it's a universal format, and Pare's import is dedup-safe: re-importing an overlapping file never doubles anything.",
      "CSV isn't accepted from the upload drop zone (its dates are too lossy to dedup safely) — OFX/QFX is the reliable path.",
    ],
    formats: "OFX / QFX.",
    note:
      "OFX carries a bank-assigned transaction id, which is what makes re-imports safe: Pare keys dedup on that id, so overlapping exports merge instead of duplicating.",
  },
];

export const BADGE: Record<GuideStatus, { label: string; short: string }> = {
  pdf: { label: "PDF TUNED", short: "Tuned" },
  beta: { label: "PDF BETA · OFX SAFER", short: "Beta" },
  ofx: { label: "OFX / QFX", short: "Universal" },
};

export function getBankGuide(slug: string): BankGuide | undefined {
  return BANK_GUIDES.find((g) => g.slug === slug);
}

/** Guides grouped for display, in a stable order: Canada, US, then the
 *  country-agnostic entries (Amex, the catch-all). A flat list of every
 *  supported institution is unscannable once the US banks are included. */
export function groupedGuides(): { region: Region; label: string; guides: BankGuide[] }[] {
  const order: Region[] = ["CA", "US", "any"];
  return order
    .map((region) => ({
      region,
      label: REGION_LABEL[region],
      guides: BANK_GUIDES.filter((g) => g.region === region),
    }))
    .filter((group) => group.guides.length > 0);
}
