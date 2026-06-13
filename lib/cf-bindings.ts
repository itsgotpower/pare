// ---------------------------------------------------------------------------
// getBinding — one generic resolver for a Cloudflare runtime binding off the
// per-request env, via @opennextjs/cloudflare's getCloudflareContext.
//
// Five modules (pdf-store PDF_BUCKET, job-store PARSE_JOBS, producer PARSE_QUEUE,
// repo USER_DATA, auth d1 DB) each had a byte-identical copy of this lazy lookup:
// dynamic-import the package (absent in plain Node/dev), read the named binding
// off ctx.env, coalesce to null, swallow any error. This collapses all five into
// one helper so the resolution path lives in exactly one place.
//
// Imported lazily by callers (each keeps its own thin wrapper) so plain Node/dev
// and the test harnesses never hard-depend on the Workers runtime.
// ---------------------------------------------------------------------------

/**
 * Resolve the Cloudflare binding named `name` off the current request's env, or
 * null when unavailable (not on Workers, package absent, or the binding isn't
 * wired). Never throws — callers decide whether a missing binding is fatal.
 */
export async function getBinding<T>(name: string): Promise<T | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = await mod.getCloudflareContext({ async: true });
    const binding = (ctx?.env as Record<string, unknown> | undefined)?.[name];
    return (binding as T | undefined) ?? null;
  } catch {
    return null;
  }
}
