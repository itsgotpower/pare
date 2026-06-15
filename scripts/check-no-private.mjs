#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Private-content guard for the PUBLIC open-core repo.
//
// This repository is published. The proprietary commercial layer lives in
// `cloud/` under its OWN license (that's fine — visible, not freely licensed),
// but private business docs (`internal/`), the internal dev-workflow doc
// (`SETUP.md`), any financial data, and any LITERAL secret must NEVER be tracked
// here. This script fails if any of them are — the mechanical guardrail that
// replaces the old "remember which repo to push to" discipline of the two-repo
// split.
//
//   Run locally:  npm run guard
//   CI:           .github/workflows/guard-private.yml (every push + PR)
// ---------------------------------------------------------------------------
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Paths that must never be tracked in the public repo.
const FORBIDDEN_PATHS = [
  { re: /^internal\//, why: "private business docs" },
  { re: /^SETUP\.md$/, why: "internal dev-workflow doc" },
  { re: /^docs\/encryption-design\.md$/, why: "internal design draft" },
  { re: /^data\//, why: "financial data" },
  { re: /\.db$/, why: "database file" },
  { re: /\.pdf$/, why: "statement PDF" },
  { re: /(^|\/)\.env(\.|$)/, why: "env file" },
  { re: /\.pem$/, why: "key/cert file" },
];

// Literal secrets — deliberately NOT matching env-var NAMES or "set this secret"
// instructions (which legitimately appear in DEPLOY/SETUP/wrangler docs).
const SECRET_PATTERNS = [
  { re: /sk_live_[0-9a-zA-Z]{16,}/, name: "Stripe live secret key" },
  { re: /rk_live_[0-9a-zA-Z]{16,}/, name: "Stripe restricted key" },
  { re: /whsec_[0-9a-zA-Z]{24,}/, name: "Stripe webhook signing secret" },
  { re: /AKIA[0-9A-Z]{16}/, name: "AWS access key id" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, name: "private key" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, name: "JWT / signed token" },
];

const SKIP_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "otf", "wasm", "pdf", "db",
]);

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const errors = [];

for (const f of tracked) {
  for (const { re, why } of FORBIDDEN_PATHS) {
    if (re.test(f)) errors.push(`forbidden (${why}) tracked in public repo: ${f}`);
  }
}

for (const f of tracked) {
  const ext = f.split(".").pop()?.toLowerCase();
  if (ext && SKIP_EXT.has(ext)) continue;
  let content;
  try {
    content = readFileSync(f, "utf8");
  } catch {
    continue; // unreadable / binary
  }
  for (const { re, name } of SECRET_PATTERNS) {
    if (re.test(content)) errors.push(`possible ${name} in ${f}`);
  }
}

if (errors.length) {
  console.error(`\n✗ private-content guard FAILED (${errors.length}):`);
  for (const e of errors) console.error("  • " + e);
  console.error("\nThis repository is PUBLIC. Remove or relocate the above before committing/pushing.\n");
  process.exit(1);
}
console.log(`✓ private-content guard passed — ${tracked.length} tracked files clean.`);
