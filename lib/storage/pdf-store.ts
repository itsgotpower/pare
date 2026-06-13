// ---------------------------------------------------------------------------
// PdfStore — object storage for uploaded PDF bytes, over an R2 bucket binding.
//
// It mirrors the Repo seam (lib/repo/index.ts): the R2 binding is resolved the
// SAME lazy way `getUserDataNamespace()` resolves USER_DATA — via
// @opennextjs/cloudflare's getCloudflareContext, imported lazily so plain
// Node/dev (and tests) don't hard-depend on the Workers runtime. A real bucket
// is wired in P6; until then getPdfStore() throws a clear error in hosted mode.
//
// CONTRACT (the thing P5/P4 consume — keep stable):
//
//   put(userId, filename, bytes) -> Promise<key>   // R2 key, persist for parse
//   get(key)                     -> Promise<bytes | null>
//   delete(key)                  -> Promise<void>
//
// KEY LAYOUT — keys are ALWAYS prefixed per user: `u/<userId>/<uuid>-<filename>`.
// The `u/<userId>/` prefix is the tenant boundary for object storage (the same
// role the per-user Durable Object plays for the SQLite data): a key is only
// ever handed back to the user it was minted for. Callers MUST verify a key
// belongs to the caller before get/delete (see `keyBelongsToUser`).
//
// RETENTION — default is DELETE-AFTER-PARSE. The upload flow (P5) / queue
// consumer (P4) is expected to `delete(key)` once parsing succeeds; the PDF is
// not meant to outlive the parse. See `shouldPersistAfterParse` below for the
// opt-in hook a future "keep my statements" user setting would flip — NOT built
// here, just reserved so the call sites have an obvious seam.
// ---------------------------------------------------------------------------

// Minimal structural slice of R2Bucket we use — declared structurally (like
// DoNamespaceLike in lib/repo/index.ts) so this file needs no
// @cloudflare/workers-types and tests can inject a stand-in (miniflare's R2,
// which implements this surface).
export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(key: string): Promise<void>;
}

/**
 * PdfStore — put/get/delete uploaded PDF bytes in R2, keyed per user.
 */
export interface PdfStore {
  /**
   * Store `bytes` for `userId` under a fresh per-user key and return that key.
   * The key embeds the userId prefix and a random uuid so two uploads of the
   * same filename never collide. Callers persist the returned key (e.g. on a
   * queue message) and pass it to get/delete.
   */
  put(userId: string, filename: string, bytes: Uint8Array): Promise<string>;
  /** Fetch the bytes for `key`, or null if the object is gone. */
  get(key: string): Promise<Uint8Array | null>;
  /** Remove the object at `key` (idempotent; the default post-parse action). */
  delete(key: string): Promise<void>;
}

const USER_PREFIX = "u";

/** Build the per-user key for a fresh upload: `u/<userId>/<uuid>-<filename>`. */
export function buildPdfKey(userId: string, filename: string): string {
  // Strip any path components from the filename so it can't escape the prefix.
  const safeName = filename.replace(/^.*[\\/]/, "").replace(/[^\w.\-]+/g, "_");
  return `${USER_PREFIX}/${encodeURIComponent(userId)}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * Guard a key against a userId — true iff `key` lives under that user's prefix.
 * Call sites MUST check this before get/delete on a key that came from an
 * untrusted source, so one user can never read/delete another's object.
 */
export function keyBelongsToUser(key: string, userId: string): boolean {
  return key.startsWith(`${USER_PREFIX}/${encodeURIComponent(userId)}/`);
}

/**
 * Retention hook — default false: the PDF is deleted after a successful parse
 * (ephemeral, per the compliance posture). A future per-user "keep my
 * statements" setting would resolve here to true and the parse pipeline would
 * skip the post-parse delete. The SETTING is intentionally NOT built yet; this
 * is just the seam so P4/P5 have one obvious place to branch.
 */
export function shouldPersistAfterParse(/* userSettings?: ... */): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// R2PdfStore — the production impl over an R2 bucket binding.
// ---------------------------------------------------------------------------
export class R2PdfStore implements PdfStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(userId: string, filename: string, bytes: Uint8Array): Promise<string> {
    const key = buildPdfKey(userId, filename);
    // Copy into a plain ArrayBuffer view so the body is a concrete byte payload
    // R2 accepts on both the Workers runtime and miniflare.
    await this.bucket.put(key, new Uint8Array(bytes));
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return new Uint8Array(await obj.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

// Resolve the PDF_BUCKET R2 binding for the current request (Workers only),
// imported lazily so the @opennextjs/cloudflare package is absent in plain
// Node/dev — exactly how lib/repo/index.ts resolves USER_DATA.
async function getPdfBucket(): Promise<R2BucketLike | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = await mod.getCloudflareContext({ async: true });
    const bucket = (ctx?.env as Record<string, unknown> | undefined)?.PDF_BUCKET;
    return (bucket as R2BucketLike | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * getPdfStore — the factory the upload endpoint (P5) and queue consumer (P4)
 * call to obtain an R2-backed PdfStore for the current request.
 *
 * Object storage is a HOSTED-only concern: in self-host mode the upload route
 * still streams to a temp file and parses in-process (no R2), so there is no
 * PdfStore to hand back and this throws. The real PDF_BUCKET binding is wired
 * in P6; until then hosted mode also throws a clear "binding unavailable"
 * error rather than failing obscurely later.
 */
export async function getPdfStore(): Promise<PdfStore> {
  const bucket = await getPdfBucket();
  if (!bucket) {
    throw new Error(
      "getPdfStore: PDF_BUCKET R2 binding unavailable (hosted mode requires the Workers runtime + a wired bucket)"
    );
  }
  return new R2PdfStore(bucket);
}

/**
 * pdfStoreOverBucket — build a PdfStore over an explicit bucket binding.
 * Used by tests (miniflare R2) and any harness that already holds the binding,
 * mirroring repoOverDoStub() in lib/repo/index.ts.
 */
export function pdfStoreOverBucket(bucket: R2BucketLike): PdfStore {
  return new R2PdfStore(bucket);
}
