import { getDb } from "../db";

// Minimal email shape check — the real validation is "did it insert".
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface WaitlistResult {
  ok: boolean;
  alreadyJoined?: boolean;
  error?: string;
}

export interface WaitlistEntry {
  email: string;
  source: string;
  created_at: string;
}

export function joinWaitlist(rawEmail: string, source = "homepage"): WaitlistResult {
  const email = rawEmail.trim().toLowerCase();
  // Cap length (RFC 5321 max is 254) before the regex — this is the shared
  // chokepoint for every caller, including the hosted DO RPC path, so it bounds
  // unbounded writes even if a route forgets to validate.
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const db = getDb();
  const info = db
    .prepare("INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)")
    .run(email, source);

  // changes === 0 means the UNIQUE email already existed — treat as success
  // so we never reveal whether an address is already on the list.
  return { ok: true, alreadyJoined: info.changes === 0 };
}

export function waitlistCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM waitlist").get() as { n: number };
  return row.n;
}

// All captured signups, oldest first. Read path for the admin export
// (GET /api/waitlist); never exposed to the public POST flow.
export function listWaitlist(): WaitlistEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT email, source, created_at FROM waitlist ORDER BY created_at ASC, id ASC")
    .all() as WaitlistEntry[];
}
