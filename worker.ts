// Cloudflare Worker entrypoint (hosted target).
//
// @opennextjs/cloudflare compiles the Next.js app to `.open-next/worker.js`,
// whose DEFAULT export is the fetch handler. Cloudflare also requires every
// Durable Object class the Worker uses to be EXPORTED from the same entry module
// (this is the documented OpenNext convention — its own cache DOs, DOQueueHandler
// etc., are re-exported from the generated worker exactly this way). So this
// wrapper:
//   1. re-exports OpenNext's fetch handler as the default export, and
//   2. exports `UserDataObject`, the per-user data Durable Object that
//      wrangler.toml's `[[durable_objects.bindings]] class_name` reserves.
//
// wrangler.toml's `main` points here instead of straight at the generated
// worker, so both the app handler and the DO class are registered.
//
// The DO class binds the real `cloudflare:workers` DurableObject base (only
// available in the Workers runtime / build) around the runtime-agnostic
// UserDataObject implementation in lib/repo/user-data-object.ts. Keeping the base
// import out of that lib file means the rest of the app (and Node tests) never
// try to resolve the `cloudflare:workers` virtual module.

// @ts-expect-error — resolved by the wrangler/OpenNext build, not by tsc/Node.
import { DurableObject } from "cloudflare:workers";
import { UserDataObject as UserDataImpl } from "./lib/repo/user-data-object";
import type { AnyRepoCall } from "./lib/repo/repo-rpc";

// OpenNext's generated default export is `{ fetch }`. To run a Cloudflare Queue
// consumer on the SAME Worker, the `queue` handler must be a property of the
// default export object alongside `fetch` (the documented OpenNext custom-worker
// pattern — a `queue`/`scheduled` handler can't be a separate top-level export;
// the runtime only looks at the default export's methods). So we import OpenNext's
// handler, re-export its `fetch`, and add our P4 queue consumer.
// @ts-expect-error — `.open-next/worker.js` exists only after `opennextjs-cloudflare build`.
import openNextHandler from "./.open-next/worker.js";
import * as Sentry from "@sentry/cloudflare";
import { sentryOptions } from "./lib/sentry";

// WAITLIST LAUNCH: this branch ships the marketing/waitlist landing only, so the
// async parse pipeline (the `queue` handler) and the parser Container are dropped
// from the entry module to match the trimmed wrangler.toml (no queues/containers
// configured). The full handler — `queue` + the `ParserContainer` export — lives
// on `main`; restore both here when re-enabling the upload pipeline. ALSO restore
// an `email` handler wired to cloud/ingest/email-worker.ts's handleEmailMessage —
// the email-ingest adapter exists but has never been wired to a Worker entry
// (it needs an Email Routing binding in wrangler too).
const handler = {
  // The Next.js app's fetch handler, untouched.
  fetch: (openNextHandler as { fetch: (...args: unknown[]) => Promise<Response> }).fetch,
};

// PHASE 4 — error tracking. withSentry wraps BOTH the fetch and queue handlers,
// capturing unhandled errors with request context. The options come from the
// per-Worker env (SENTRY_DSN secret); when it's unset, Sentry is a no-op (nothing
// sent), so dev/self-host/un-provisioned deploys behave exactly as before. PII is
// stripped in lib/sentry.ts's beforeSend. The Durable Object classes are exported
// separately below and are unaffected by the wrap.
export default Sentry.withSentry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env: any) => sentryOptions(env),
  handler
);

// (WAITLIST LAUNCH: the `ParserContainer` export is omitted here — no [[containers]]
// in the trimmed wrangler.toml. Restore it with the queue handler for the full app.)

// The registered Durable Object. Extends the Workers DurableObject base (so the
// platform recognises it as a DO with storage + an input gate) and delegates all
// data work to UserDataImpl, which owns the SqliteRepo/DoBackend over ctx.storage.
// One instance per user (the Worker addresses it by id derived from userId), so
// tenant isolation is by construction.
export class UserDataObject extends DurableObject {
  private impl: UserDataImpl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.impl = new UserDataImpl(ctx, env);
  }

  // RPC method called on the DO stub by the request-side DoRepoClient transport
  // (lib/repo/index.ts: `stub.call(call)`). The envelope is structured-clone-safe.
  async call(req: AnyRepoCall): Promise<unknown> {
    return this.impl.call(req);
  }

  // Account-deletion RPC: hard-delete this user's entire database (drop all SQL
  // tables/views + clear KV storage). Called by destroyUserData() via the stub.
  // Idempotent.
  async destroy(): Promise<void> {
    return this.impl.destroy();
  }
}
