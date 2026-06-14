# Phase 3 — Async Session Kickoff Prompts (hosted upload pipeline)

Phase 3 = the hosted PDF upload pipeline (exit: upload → parsed → categorized
round-trip in hosted mode, PDFs deleted post-parse) + the DO-SQLite-on-workerd
blocker. Decision locked: **P1 uses native `ctx.storage.sql` (synchronous) via a
better-sqlite3-shaped adapter — NOT WASM.** See `project_repo_phase3` memory.

Start **P1, P2, P3** in parallel now (own worktree/branch each, off `main`). Then
P4 (after P3 + P2), P5 (after P3/P4), P6 convergence. Reality check: Cloudflare
Containers don't emulate locally — test P2 with Docker, P4/P6 with miniflare
(R2 + Queues emulate) and a mocked parser endpoint.

---

## P1 — DoSqlBackend over native ctx.storage.sql (the #5 blocker)

```
Project: parse/ (Next.js 16, hosted pivot). Phase 2 shipped per-user Durable
Objects, but the live DO path uses a whole-DB blob over the native better-sqlite3
module, which CANNOT load on workerd. Read lib/repo/do-backend.ts, lib/repo/
do-store.ts, lib/repo/user-data-object.ts, lib/repo/backend.ts (the DbBackend
seam), lib/db.ts (getDb/useConnection), and a few lib/db/*.ts query modules
(transactions.ts, categories.ts) to see the better-sqlite3 API surface.

DECISION (do NOT revisit): use the Durable Object's NATIVE SQLite storage API
(ctx.storage.sql), which is SYNCHRONOUS, instead of WASM. lib/db/*.ts must stay
UNCHANGED — they're synchronous better-sqlite3 code, and ctx.storage.sql is also
synchronous, so a better-sqlite3-SHAPED ADAPTER bridges them.

Task:
1. Write a `DoSqlDatabase` adapter (new lib/repo/do-sql-adapter.ts) exposing the
   slice of better-sqlite3's API that lib/db uses: `.prepare(sql)` ->
   `{ get(...p), all(...p), run(...p), iterate?(...p) }`, `.transaction(fn)`,
   `.exec(sql)`, `.pragma(x)` (mostly a no-op). Implement over ctx.storage.sql:
   - exec() -> sql cursor (.one()/.toArray()/.raw()/columnNames/rowsWritten).
   - CRITICAL: DO sql.exec takes POSITIONAL `?` params only, but lib/db uses NAMED
     params (`@statement_id`, `stmt.run(rowObject)`). The adapter MUST translate
     named placeholders -> positional and reorder bindings from the passed object.
     Support both `stmt.run(obj)` (named) and `stmt.get(a, b)` (positional).
   - `.run()` returns `{ changes, lastInsertRowid }` (use rowsWritten; get
     lastInsertRowid via `SELECT last_insert_rowid()` when needed — dedup code
     checks `stmt.run(row).changes > 0`).
   - `.transaction(fn)` -> ctx.storage.transactionSync(fn) (callbacks are sync).
2. New `DoSqlBackend implements DbBackend` (lib/repo/do-sql-backend.ts): open()
   constructs the adapter over the DO's ctx.storage.sql, runs MIGRATIONS at first
   access, and routes getDb() at it via useConnection(); persist() is a NO-OP
   (writes are native/immediate — no serialize). Wire UserDataObject to use
   DoSqlBackend instead of the blob DoBackend. Keep DoBackend/EncryptedBlobBackend
   in tree (other uses); don't delete them.
3. Self-host FileBackend + lib/db stay byte-for-byte unchanged.

VERIFY IN THE FIRST HOUR (the two documented unknowns), before building the rest:
- Foreign-key enforcement: schema uses FKs and `PRAGMA foreign_keys = ON`. Confirm
  whether DO SQLite enforces them; if not, document the behavior delta (the app
  already does explicit delete-ordering, so likely fine).
- `CREATE VIEW` (the v_transactions view) works on DO SQLite.
Report findings before proceeding if either is a real problem.

Test under miniflare / @cloudflare/vitest-pool-workers against a real DO with
ctx.storage.sql (model lib/repo/do-backend.test.ts). Prove: migrations build the
full schema, the named-param adapter round-trips writes/reads, v_transactions
resolves, and the existing Repo namespace methods work unchanged over DoSqlBackend.

Constraints: do NOT edit lib/repo/index.ts beyond pointing UserDataObject's backend
at DoSqlBackend. Keep npm test / test:repo / test:auth / next build green.
Commit on your branch (Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>),
don't push. Report: the adapter design (esp. named-param translation), the FK/view
findings, and test output.
```

---

## P2 — Parser container (Python + poppler + HTTP)

```
Project: parse/ (hosted pivot). The PDF parser lib/parser/parse_statements.py runs
locally via child_process + poppler (pdftotext). On Workers there's no Python/
poppler/child_process, so hosted parsing runs in a Cloudflare Container. Read
lib/parser/parse_statements.py (note `--json` mode outputs
{transactions:[...], statements:[...]}) and lib/parser/run-parser.ts.

Task: containerize the parser as an HTTP service. DO NOT modify the parser logic —
the tests/ suite guards it and it's balance-reconciled.
- A ~50-line HTTP wrapper: `POST /parse` accepts PDF bytes (or multipart), writes
  to a temp file, runs the existing parser in --json mode, returns
  {transactions, statements} JSON. `GET /health`. Keep it stateless.
- Dockerfile: python3 + poppler-utils + the wrapper. Small base image.
- Cloudflare Containers config (the Container class + wrangler bindings stub) per
  current CF Containers docs — verify against docs, don't guess the API.
- The tests/ Python suite must still pass unchanged (`npm test`).

Test standalone: `docker build` then `curl -F file=@sample.pdf localhost:PORT/parse`
returns the same rows the local parser produces for that PDF. (Use a synthetic/
fixture PDF — never commit real statements; data/ and repo-root PDFs are gitignored.)

Independent of the data layer. Commit on your branch (Co-Authored-By: Claude Opus
4.8 <noreply@anthropic.com>), don't push. Report the wrapper, Dockerfile, CF
Containers wiring, and the curl round-trip proof.
```

---

## P3 — ParserService seam + R2 PDF store

```
Project: parse/ (hosted pivot). Today app/api/upload/route.ts calls parsePdf()
(lib/parser/run-parser.ts -> child_process). Hosted mode can't do that; it needs a
remote parser (the P2 container) and object storage for the PDF. Read
app/api/upload/route.ts and lib/parser/run-parser.ts. Mirror the existing Repo seam
(lib/repo/) as the structural template for the abstraction.

Task:
1. ParserService seam (new lib/parser/service.ts): an interface
   `parse(pdf: Uint8Array | path) -> Promise<{transactions, statements}>` with two
   impls — `LocalParser` (wraps run-parser/child_process, self-host) and
   `RemoteParser` (HTTP POST to the P2 container's /parse). A factory selects on
   PARE_DEPLOY_TARGET=hosted (like getRepo). Keep the return shape identical to
   parsePdf so call sites don't change semantics.
2. R2 PDF store (new lib/storage/pdf-store.ts): `put(userId, filename, bytes)`,
   `get(key)`, `delete(key)` over an R2 bucket binding, keys PREFIXED PER USER
   (e.g. `u/<userId>/<uuid>-<filename>`). Retention default = DELETE-AFTER-PARSE
   (no persistence unless a future user setting opts in). Declare the R2 binding
   shape; a real bucket is wired in P6.

This delivers the CONTRACTS P4 (queue consumer) and P5 (upload endpoint) consume —
keep both interfaces minimal and documented. Don't wire the queue or the endpoint
here. Test with miniflare R2 (put/get/delete round-trip, per-user prefixing) and a
mocked RemoteParser. Commit on your branch (Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>), don't push.
```

---

## P4 — Queues parse pipeline (after P3 + P2)

```
Project: parse/ (hosted pivot). Wire the async parse job. Depends on P3's
ParserService + R2 PdfStore and P2's container. Read lib/repo/index.ts
(getRepoForUser), lib/repo/scoped.ts, app/api/upload/route.ts (the insert+
recategorize batch pattern to reuse).

Task:
- Producer: enqueue a message {userId, r2Key, filename} onto a Cloudflare Queue.
- Consumer Worker (queue handler): for each message — get the PDF from R2 (P3
  PdfStore) -> ParserService.parse (RemoteParser -> container) -> write rows to
  THAT user's DO via getRepoForUser(userId): statements.insert + transactions.
  insertMany + categories.recategorizeAll, all inside ONE repo.batch() (see the
  fixed app/api/upload/route.ts pattern) -> on success, delete the PDF from R2.
  On failure, leave the job for retry and DON'T delete the PDF; record job status.
- Job status store: enough state for P5's status endpoint to report
  queued/parsing/done/failed + counts (a small per-user record, or KV/DO).

Test with miniflare Queues + R2, container mocked. Prove a message round-trips to
rows in the right user's DO and the PDF is deleted on success. Commit on your
branch (Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>), don't push.
```

---

## P5 — Hosted upload endpoint + job status (after P3/P4)

```
Project: parse/ (hosted pivot). Rework app/api/upload/route.ts for hosted mode and
add a status endpoint. Depends on P3 (PdfStore) + P4 (producer + job status). Read
the current app/api/upload/route.ts and lib/repo/scoped.ts (getScopedRepo).

Task:
- Hosted branch of POST /api/upload: authenticate via getScopedRepo/resolveUser
  (cookie OR bearer), accept multipart PDF, stream it to R2 (PdfStore, per-user
  prefix), enqueue the parse job (P4 producer), return { jobId } immediately (202).
  SELF-HOST branch keeps today's synchronous parsePdf path unchanged.
- GET /api/upload/status?jobId=... (or similar): returns the job state
  (queued/parsing/done/failed + inserted/skipped counts) for the authenticated
  caller; reject jobs not owned by the caller.
- Design the multipart + bearer contract so the future Expo share-sheet upload uses
  the SAME endpoint (the two gated "[Mobile app only]" backlog cards).

Keep self-host + MCP unchanged. Test the hosted branch against miniflare (R2 +
Queue producer) with auth resolved via a bearer token, asserting 202 + a readable
job status. Commit on your branch (Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>), don't push.
```

---

## P6 — Wire bindings + end-to-end (convergence, last)

```
Project: parse/ (hosted pivot). Final Phase 3 step: integrate P1–P5 and wire the
Cloudflare bindings. Depends on all prior P's landing/merging first.

Task:
- wrangler.toml: add the R2 bucket binding, the Queue (producer + consumer)
  bindings, and the Container binding/class; ensure UserDataObject uses DoSqlBackend
  (P1). Update DEPLOY.md with the create/apply commands (r2 bucket create, queue
  create, container deploy) and any new secrets.
- End-to-end test (the Phase 3 exit gate): a PDF upload in hosted mode flows
  upload -> R2 -> queue -> (container) parse -> rows written to the caller's DO ->
  categorized -> PDF deleted from R2. Where Cloudflare Containers can't run locally,
  mock the parser endpoint and clearly log that the container leg is mocked.
- Keep npm test / test:repo / test:auth / next build green; self-host + MCP intact.

Commit on your branch (Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>),
don't push. Report the wiring, the e2e test + output, and what (if anything) was
mocked vs real.
```
