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

// @ts-expect-error — `.open-next/worker.js` exists only after `opennextjs-cloudflare build`.
export { default } from "./.open-next/worker.js";

// The PDF parser runs in a Cloudflare Container (Python + poppler — unavailable in
// the Workers runtime). Like UserDataObject, the Container-backed Durable Object
// class must be exported from the entry module so wrangler can register it
// (wrangler.toml [[containers]] + [[durable_objects.bindings]] class_name = "ParserContainer").
export { ParserContainer } from "./lib/parser/parser-container";

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
}
