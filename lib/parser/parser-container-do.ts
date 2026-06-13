// The Container-backed Durable Object class for the PDF parser service.
//
// Cloudflare Containers (GA 2026-04) model a container image as a Durable Object:
// the `Container` base from `@cloudflare/containers` manages the lifecycle (start,
// idle sleep, readiness ping) and `containerFetch`/`fetch` proxy HTTP to the
// process inside. The image is lib/parser/Dockerfile — a Python http.server
// wrapping the unchanged parser (server.py). See wrangler.toml [[containers]].
//
// This class is exported from worker.ts (alongside UserDataObject) and registered
// by wrangler.toml's [[durable_objects.bindings]] + [[migrations]].new_sqlite_classes.
//
// IMPORTANT: it lives in its OWN module (separate from parser-container.ts) because
// `@cloudflare/containers` imports the `cloudflare:workers` virtual module, which
// only resolves on Workers. Keeping the Container base out of parser-container.ts
// lets the request-side helper (parsePdfViaContainer) + its binding type stay
// import-safe in Node/dev/tests; only the Workers entrypoint loads this file.
//
import { Container } from "@cloudflare/containers";

export class ParserContainer extends Container {
  // The port server.py listens on (matches Dockerfile ENV PORT / EXPOSE).
  defaultPort = 8080;
  // Hibernate after a short idle window — parsing is bursty and stateless, so we
  // don't pay to keep an instance warm between uploads.
  sleepAfter = "5m";
  // Readiness probe; the wrapper answers GET /health (and /ping) with 200.
  pingEndpoint = "/health";
}
