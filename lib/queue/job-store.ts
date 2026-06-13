// ---------------------------------------------------------------------------
// JobStore — the per-job status record for the async parse pipeline. This is the
// P5 CONTRACT: the upload route creates a `queued` job and hands the jobId back to
// the client; the queue consumer (lib/queue/consumer.ts) advances it through
// `parsing` -> `done | failed`; and P5's status endpoint reads it back so the
// client can poll "is my upload done yet?".
//
// Backed by a Cloudflare KV namespace (PARSE_JOBS) — the simplest fit for a tiny,
// short-lived, write-rarely/read-often record. (A DO or a table would also work;
// KV chosen because the record is independent of the per-user SQLite DB and we
// want it readable from the request side without spinning the user's DO.) The
// real binding is wired in P6; until then getJobStore() throws a clear error.
//
// TENANCY — like PdfStore's R2 keys, the KV key is ALWAYS prefixed per user:
// `job/<userId>/<jobId>`. The `job/<userId>/` prefix is the isolation boundary:
// a record is only ever read back for the user it was minted for. The status
// endpoint MUST pass the authenticated userId to `get(userId, jobId)`, which only
// returns a record living under that user's prefix — so user A can never read
// user B's job (see `jobKey` / `jobBelongsToUser`).
//
// ---------------------------------------------------------------------------
// JOB RECORD SHAPE (the stable thing P5 reads — keep in sync with the endpoint):
//
//   {
//     jobId:    string,                 // the queue message + this record's id
//     userId:   string,                 // owner; matches the key prefix
//     filename: string,                 // original upload name (for display)
//     status:   "queued" | "parsing" | "retrying" | "done" | "failed",
//     inserted: number | null,          // rows newly written   (set on `done`)
//     skipped:  number | null,          // rows deduped/skipped  (set on `done`)
//     error:    string | null,          // failure detail        (set on `failed`)
//     createdAt: string,                // ISO timestamp, set at enqueue
//     updatedAt: string,                // ISO timestamp, set on every transition
//   }
//
//   Lifecycle: queued (P5 upload) -> parsing (consumer start)
//                -> done {inserted, skipped}            (consumer success)
//                -> retrying {error}                    (transient failure; the
//                     Queue will redeliver — NON-TERMINAL, the client keeps polling)
//                -> failed {error}                      (permanent / retries exhausted)
//
// TERMINAL vs NON-TERMINAL — the client poll contract: ONLY `done` and `failed`
// are terminal. `queued`/`parsing`/`retrying` mean "keep polling". `retrying`
// exists precisely so a transient error (container 502, R2 read lag) that the
// consumer rethrows for a Queue retry does NOT prematurely look like a permanent
// `failed` to a polling client.
// ---------------------------------------------------------------------------

export type ParseJobStatus = "queued" | "parsing" | "retrying" | "done" | "failed";

export interface ParseJobRecord {
  jobId: string;
  userId: string;
  filename: string;
  status: ParseJobStatus;
  inserted: number | null;
  skipped: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// Minimal structural slice of KVNamespace we use — declared structurally (like
// R2BucketLike in lib/storage/pdf-store.ts) so this file needs no
// @cloudflare/workers-types and tests can inject a stand-in (miniflare's KV).
export interface KvNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const JOB_PREFIX = "job";

// Parse-job records are ephemeral status, not data of record — expire them so the
// KV namespace doesn't accrete forever. One day is ample for a client to poll an
// upload to completion. (KV's minimum expirationTtl is 60s; one day is well clear.)
const JOB_TTL_SECONDS = 24 * 60 * 60;

/** Build the per-user KV key for a job: `job/<userId>/<jobId>`. */
export function jobKey(userId: string, jobId: string): string {
  return `${JOB_PREFIX}/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}`;
}

/**
 * Guard a key against a userId — true iff `key` lives under that user's prefix.
 * Mirrors keyBelongsToUser() in pdf-store.ts; the consumer uses it as a
 * belt-and-braces check that the message's jobId+userId agree before writing.
 */
export function jobBelongsToUser(key: string, userId: string): boolean {
  return key.startsWith(`${JOB_PREFIX}/${encodeURIComponent(userId)}/`);
}

/**
 * JobStore — create/read/advance a parse-job record, scoped per user.
 *
 *   create(input)                  -> queued record (P5 upload)
 *   get(userId, jobId)             -> the record, or null (P5 status endpoint)
 *   markParsing(userId, jobId)     -> status=parsing (consumer start)
 *   markDone(userId, jobId, {...}) -> status=done + counts (consumer success)
 *   markFailed(userId, jobId, err) -> status=failed + error (consumer failure)
 *
 * Every read/write takes userId so a caller can ONLY ever touch their own jobs:
 * the userId is baked into the key, so a mismatched userId simply addresses a
 * different (non-existent) key — cross-user reads return null, never another
 * user's record.
 */
export class KvJobStore {
  constructor(private readonly kv: KvNamespaceLike) {}

  async create(input: {
    jobId: string;
    userId: string;
    filename: string;
  }): Promise<ParseJobRecord> {
    const now = new Date().toISOString();
    const record: ParseJobRecord = {
      jobId: input.jobId,
      userId: input.userId,
      filename: input.filename,
      status: "queued",
      inserted: null,
      skipped: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async get(userId: string, jobId: string): Promise<ParseJobRecord | null> {
    const raw = await this.kv.get(jobKey(userId, jobId));
    if (raw === null) return null;
    const record = JSON.parse(raw) as ParseJobRecord;
    // Defence in depth: the key prefix already isolates, but never hand back a
    // record whose stored userId disagrees with the caller's.
    if (record.userId !== userId) return null;
    return record;
  }

  async markParsing(userId: string, jobId: string): Promise<void> {
    await this.transition(userId, jobId, (r) => ({ ...r, status: "parsing" }));
  }

  // Idempotent-aware: if the job is ALREADY `done`, this is a NO-OP — a Queue
  // redelivery of a message whose insert already committed must not clobber the
  // first run's real counts with the re-run's {inserted: 0} (the second insert
  // dedups to all-skipped). `done` is terminal, so the first non-zero record wins.
  async markDone(
    userId: string,
    jobId: string,
    counts: { inserted: number; skipped: number }
  ): Promise<void> {
    await this.transition(userId, jobId, (r) =>
      r.status === "done"
        ? r
        : {
            ...r,
            status: "done",
            inserted: counts.inserted,
            skipped: counts.skipped,
            error: null,
          }
    );
  }

  // NON-TERMINAL: a transient failure the consumer will rethrow for a Queue retry.
  // The client keeps polling (only done/failed are terminal). Never overwrites a
  // job already `done` (a late retry of an already-succeeded message).
  async markRetrying(userId: string, jobId: string, error: string): Promise<void> {
    await this.transition(userId, jobId, (r) =>
      r.status === "done" ? r : { ...r, status: "retrying", error: error.slice(0, 500) }
    );
  }

  // TERMINAL failure: a permanent outcome (unsupported PDF / retries exhausted).
  // Never overwrites a job already `done`.
  async markFailed(userId: string, jobId: string, error: string): Promise<void> {
    await this.transition(userId, jobId, (r) =>
      r.status === "done" ? r : { ...r, status: "failed", error: error.slice(0, 500) }
    );
  }

  // Read-modify-write a record. If the record is gone (TTL-expired, or never
  // created), the transition is a no-op — the consumer must never resurrect a
  // record under a different shape, and a missing job simply can't be advanced.
  private async transition(
    userId: string,
    jobId: string,
    fn: (record: ParseJobRecord) => ParseJobRecord
  ): Promise<void> {
    const existing = await this.get(userId, jobId);
    if (!existing) return;
    const next = { ...fn(existing), updatedAt: new Date().toISOString() };
    await this.write(next);
  }

  private async write(record: ParseJobRecord): Promise<void> {
    await this.kv.put(jobKey(record.userId, record.jobId), JSON.stringify(record), {
      expirationTtl: JOB_TTL_SECONDS,
    });
  }
}

// Resolve the PARSE_JOBS KV binding for the current request (Workers only) via the
// shared getBinding helper — imported lazily so the @opennextjs/cloudflare package
// is absent in plain Node/dev (exactly how lib/storage/pdf-store.ts resolves PDF_BUCKET).
async function getJobKv(): Promise<KvNamespaceLike | null> {
  const { getBinding } = await import("../cf-bindings");
  return getBinding<KvNamespaceLike>("PARSE_JOBS");
}

/**
 * getJobStore — the factory the upload endpoint (P5) and status endpoint (P5)
 * call to obtain a KV-backed JobStore for the current request. Fail-closed in the
 * same shape as getPdfStore() / getParseQueue(): the async job pipeline is
 * hosted-only, so this throws when the binding is unavailable.
 */
export async function getJobStore(): Promise<KvJobStore> {
  const kv = await getJobKv();
  if (!kv) {
    throw new Error(
      "getJobStore: PARSE_JOBS KV binding unavailable (hosted mode requires the Workers runtime + a wired namespace)"
    );
  }
  return new KvJobStore(kv);
}

/**
 * jobStoreOverKv — build a JobStore over an explicit KV binding. Used by tests
 * (miniflare KV) and the queue consumer (which already holds env.PARSE_JOBS),
 * mirroring pdfStoreOverBucket() in lib/storage/pdf-store.ts.
 */
export function jobStoreOverKv(kv: KvNamespaceLike): KvJobStore {
  return new KvJobStore(kv);
}
