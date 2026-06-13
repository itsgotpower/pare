// Cloudflare Container class for the PDF parser service.
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

// Request-side helper: route a PDF to the parser container and return its JSON.
// Called from the Worker / a route handler with the `PARSER` binding (the
// Container Durable Object namespace) from wrangler.toml.
//
// One named instance ("default") is reused so warm containers are shared across
// requests; scale out by deriving the name (e.g. per user) if isolation is wanted.
export async function parsePdfViaContainer(
  binding: { getByName(name: string): { fetch(req: Request): Promise<Response> } },
  pdf: ArrayBuffer | Uint8Array,
): Promise<{ transactions: unknown[]; statements: unknown[] }> {
  const instance = binding.getByName("default");
  // Normalise to a fresh ArrayBuffer so the body type is unambiguously BodyInit.
  const body =
    pdf instanceof Uint8Array
      ? pdf.slice().buffer
      : pdf;
  const res = await instance.fetch(
    new Request("http://parser/parse", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body,
    }),
  );
  if (!res.ok) {
    throw new Error(`parser container ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { transactions: unknown[]; statements: unknown[] };
}
