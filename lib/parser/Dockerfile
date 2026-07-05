# Parser container for Cloudflare Containers (hosted parsing path).
#
# Cloudflare Workers have no Python / poppler / child_process, so hosted PDF
# parsing runs here: a slim Python image with poppler-utils (pdftotext) + the
# UNCHANGED parser + the stdlib http.server wrapper (server.py). Stateless: each
# /parse request writes a temp PDF, runs the parser, returns JSON, deletes the temp.
#
# Build context is the repo ROOT so we can COPY the parser sources:
#   docker build -f lib/parser/Dockerfile -t parse-parser .
#   docker run --rm -p 8080:8080 parse-parser
FROM python:3.12-slim

# pdftotext lives in poppler-utils; --no-install-recommends keeps the image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the WHOLE parser package (no pip deps — stdlib + poppler only). Use a glob,
# NEVER an explicit list: parse_statements.py imports sibling modules (registry,
# orchestrator, verify, categories) and enumerating them here silently drifts —
# an omitted module only surfaces as a runtime ModuleNotFoundError inside the
# container. lib/parser/ holds ONLY these parser sources (tests live in tests/).
COPY lib/parser/*.py ./

ENV PORT=8080
EXPOSE 8080

# Liveness check hits the same /health endpoint the CF readiness ping uses.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health').status==200 else 1)"

CMD ["python3", "server.py"]
