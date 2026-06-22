import { Resend } from "resend";

// Transactional email for hosted-mode auth (password reset + email verification).
// Resend's SDK is fetch-based, so it runs on the Cloudflare Workers runtime.
//
// Configuration (Worker env / .env):
//   RESEND_API_KEY  — required to actually send; when unset we log instead so
//                     local dev and tests don't need a live key.
//   AUTH_EMAIL_FROM — verified sender, e.g. "Pare <auth@pare.money>".

const FROM = process.env.AUTH_EMAIL_FROM || "Pare <auth@pare.money>";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<void> {
  const subject = "Reset your Pare password";
  const text =
    `Someone requested a password reset for your Pare account.\n\n` +
    `Reset it here (link expires shortly):\n${resetUrl}\n\n` +
    `If this wasn't you, you can safely ignore this email.`;

  const resend = client();
  if (!resend) {
    // No API key configured (dev/test): don't throw — surface the link so the
    // flow is still exercisable locally.
    console.warn(
      `[auth/email] RESEND_API_KEY unset; would send password reset to ${to}: ${resetUrl}`
    );
    return;
  }

  await resend.emails.send({ from: FROM, to, subject, text });
}

export async function sendVerificationEmail(
  to: string,
  verifyUrl: string
): Promise<void> {
  const subject = "Verify your Pare email";
  const text =
    `Welcome to Pare. Confirm this is your email address to finish setting ` +
    `up your account.\n\n` +
    `Verify here (link expires shortly):\n${verifyUrl}\n\n` +
    `If you didn't create a Pare account, you can safely ignore this email.`;

  const resend = client();
  if (!resend) {
    // No API key configured (dev/test): don't throw — surface the link so the
    // flow is still exercisable locally.
    console.warn(
      `[auth/email] RESEND_API_KEY unset; would send verification to ${to}: ${verifyUrl}`
    );
    return;
  }

  await resend.emails.send({ from: FROM, to, subject, text });
}
