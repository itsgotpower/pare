# Phase 4 — Production hardening

The hardening layer that takes hosted Parse from "serves data" (Phase 3) to
"safe to put strangers' bank data in" (closed beta). Five workstreams, all
**fail-open / inert until provisioned** — an un-provisioned deploy behaves exactly
like Phase 3, so this can land before the first `cf:deploy`.

See `DEPLOY.md → Phase 4` for the provisioning commands and the dashboard steps.

## 1. Custom domain

Deferred to `workers.dev` for the beta (Scott's call). `wrangler.toml` carries a
commented `[[routes]]` block for `app.pare.money`; flip it on + redeploy when the
zone is live (Wrangler auto-provisions DNS + cert). Remember to update the
`BETTER_AUTH_URL` secret to the new origin.

## 2. Rate limiting + Turnstile

- **Rate limiting** — per-IP, via the native Cloudflare Rate Limiting binding
  (`[[unsafe.bindings]]` type `ratelimit`): `RL_WAITLIST` (10/60s) on the waitlist,
  `RL_AUTH` (20/60s) on the better-auth POST endpoints. `lib/ratelimit.ts`; fails
  open when the binding is absent (dev/self-host).
- **Turnstile** — `lib/turnstile.ts` (server siteverify) + `components/turnstile.tsx`
  (client widget). Wired into the **waitlist** form (the one live public form).
  The better-auth endpoints are covered server-side by better-auth's `captcha`
  plugin (`lib/auth/hosted.ts`), gated on `TURNSTILE_SECRET_KEY`. Both layers are
  inert until the secret + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set.
- **Not yet wired:** the hosted sign-in/sign-up UI (doesn't exist yet — the login
  page is still the self-host flow). When that UI is built, render `<Turnstile>` and
  send the token as the `x-captcha-response` header; the server side is already
  ready.

## 3. Account deletion (hard delete)

`DELETE /api/account` (hosted only) → `lib/account/delete.ts` erases everything for
the caller, idempotently, across all four stores:

| Store | What's purged | How |
|-------|---------------|-----|
| DO (`USER_DATA`) | the user's entire SQLite DB | `destroyUserData` → `UserDataObject.destroy()` → drop all tables/views |
| R2 (`PDF_BUCKET`) | every PDF under `u/<userId>/` | `purgeUserPdfs` (cursor-paginated bulk delete) |
| KV (`PARSE_JOBS`) | every job record under `job/<userId>/` | `purgeUserJobs` |
| D1 (`DB`) | session / account / verification / user rows | direct deletes by userId/email |

Auditable: one PII-free log line (`event: "account_deletion"`, **hashed** userId,
per-step counts). Surfaced in the profile **Danger zone** (hosted only, via a GET
`/api/account` `{hosted}` probe). Self-host is unaffected (one local account → use
the data wipe). Covered by tests against real workerd SQLite + miniflare R2/KV.

## 4. Error tracking (Sentry)

`@sentry/cloudflare` wraps the Worker handler (`worker.ts` → `Sentry.withSentry`),
capturing unhandled fetch + queue errors with request context. Handled errors are
captured explicitly: the queue consumer (`captureError` on transient + cross-user
failures) and client errors (error boundaries → `/api/monitoring` beacon →
server-side capture). **Strict PII redaction** (`lib/sentry.ts beforeSend`): strips
Authorization/Cookie/captcha headers, request bodies, query strings, and masks any
email addresses. Gated on `SENTRY_DSN` — a no-op when unset.

## 5. Privacy policy

`/privacy` — public, static, brutalist. Covers what's collected (identity,
financial data, redacted error logs), where it lives (the actual D1/DO/R2/KV
bindings), retention (PDFs deleted post-parse), deletion (→ the in-app Delete
account flow), and the Cloudflare/Turnstile/Resend processor relationships.
Contact: `privacy@pare.money`. Linked from the landing footer.

---

## What Scott needs to click (Cloudflare dashboard / CLI)

None of this is required to merge or to keep the current deploy working — it
activates the hardening when you're ready.

- [ ] **Turnstile** — create a widget (dashboard → Turnstile). Then:
      `export NEXT_PUBLIC_TURNSTILE_SITE_KEY=...` in the build env, and
      `wrangler secret put TURNSTILE_SECRET_KEY`.
- [ ] **Sentry** — create a project (sentry.io, "Cloudflare Workers" platform),
      then `wrangler secret put SENTRY_DSN`.
- [ ] **Custom domain** — when ready: add the `pare.money` zone to the account,
      uncomment the `[[routes]]` block in `wrangler.toml`, redeploy, then
      `wrangler secret put BETTER_AUTH_URL` = `https://app.pare.money`.
- [ ] **Email alias** — set up forwarding for `privacy@pare.money`.
- [ ] Rate-limit bindings and account deletion need **no** dashboard step — they
      deploy with the Worker.
```
