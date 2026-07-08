import { getDb } from "../db";

// Product feedback store (migration 010). Write path is the signed-in dialog's
// POST /api/feedback; read path is the token-gated admin export on the same
// route — mirrors the waitlist's write-only-from-the-app shape.

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

// Shared chokepoint for every caller (route AND the hosted DO RPC path), so the
// caps hold even if a route forgets to validate.
export const FEEDBACK_MESSAGE_MAX = 2000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface FeedbackResult {
  ok: boolean;
  error?: string;
}

export interface FeedbackEntry {
  id: number;
  kind: FeedbackKind;
  message: string;
  email: string | null;
  created_at: string;
}

export function submitFeedback(
  rawKind: string,
  rawMessage: string,
  rawEmail?: string | null
): FeedbackResult {
  const kind = rawKind?.trim().toLowerCase();
  if (!FEEDBACK_KINDS.includes(kind as FeedbackKind)) {
    return { ok: false, error: "Pick a feedback type." };
  }

  const message = rawMessage?.trim() ?? "";
  if (!message) return { ok: false, error: "Write a message first." };
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, error: `Keep it under ${FEEDBACK_MESSAGE_MAX} characters.` };
  }

  let email: string | null = null;
  const trimmedEmail = rawEmail?.trim().toLowerCase() ?? "";
  if (trimmedEmail) {
    // RFC 5321 caps a valid address at 254 chars.
    if (trimmedEmail.length > 254 || !EMAIL_RE.test(trimmedEmail)) {
      return { ok: false, error: "Enter a valid email address (or leave it blank)." };
    }
    email = trimmedEmail;
  }

  const db = getDb();
  db.prepare("INSERT INTO feedback (kind, message, email) VALUES (?, ?, ?)").run(
    kind,
    message,
    email
  );
  return { ok: true };
}

// All submissions, oldest first — the admin export's read path (GET
// /api/feedback with the admin token); never exposed to the app UI.
export function listFeedback(): FeedbackEntry[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, kind, message, email, created_at FROM feedback ORDER BY created_at ASC, id ASC"
    )
    .all() as FeedbackEntry[];
}
