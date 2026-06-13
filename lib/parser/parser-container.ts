// Request-side helpers for the PDF parser CONTAINER (the Container-backed Durable
// Object). This module is deliberately import-safe EVERYWHERE: it does NOT import
// `@cloudflare/containers`, which pulls in the Workers-only `cloudflare:workers`
// virtual module. The Container base CLASS (ParserContainer) lives in
// parser-container-do.ts and is loaded only by the Workers entrypoint (worker.ts).
// ContainerParser (lib/parser/service.ts) + parsePdfViaContainer here run against
// the `PARSER` binding, whose surface is the structural ParserContainerBinding —
// so service.ts and its Node tests can import this file without the Workers runtime.

// The minimal structural slice of the `PARSER` Container binding we depend on —
// declared here (no @cloudflare/workers-types) so ContainerParser and the consumer
// can type env.PARSER against it and tests can inject a fake.
export interface ParserContainerBinding {
  getByName(name: string): { fetch(req: Request): Promise<Response> };
}

// Request-side helper: route a PDF to the parser container and return its JSON.
// Called from the Worker / a route handler with the `PARSER` binding (the
// Container Durable Object namespace) from wrangler.toml.
//
// One named instance ("default") is reused so warm containers are shared across
// requests; scale out by deriving the name (e.g. per user) if isolation is wanted.
export async function parsePdfViaContainer(
  binding: ParserContainerBinding,
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
