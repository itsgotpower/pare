"""Stateless HTTP wrapper around the existing PDF statement parser.

Runs inside the Cloudflare Container (see lib/parser/Dockerfile). It does NOT
reimplement any parsing — it shells the request PDF to a temp dir and invokes the
UNCHANGED parser in --json mode, returning `{transactions, statements}` exactly as
parse_statements.main(..., '--json') prints it.

Endpoints:
  POST /parse   — body is a PDF (raw `application/pdf` bytes, or a multipart/form-data
                  upload). Writes it to a temp file, runs the parser, returns the JSON.
                  The temp dir is always cleaned up.
  GET  /health  — liveness probe (also the container readiness ping target).

Python stdlib only (http.server) so the image needs no pip deps beyond poppler.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PARSER = os.path.join(HERE, "parse_statements.py")


def _extract_pdf(content_type, body):
    """Return the raw PDF bytes from a request body, or None when a multipart
    body contains no PDF part.

    Supports raw application/pdf and multipart/form-data (grabs the first part
    whose payload starts with the %PDF signature). A multipart body with no
    %PDF part returns None (-> 400) rather than the raw body — boundary lines
    and part headers are not a PDF, and handing them to pdftotext produced a
    confusing parser error instead of a clean client error.
    """
    if content_type and content_type.lower().startswith("multipart/form-data"):
        m = re.search(r"boundary=(.+)", content_type)
        if m:
            boundary = ("--" + m.group(1).strip().strip('"')).encode()
            for part in body.split(boundary):
                head, _, payload = part.partition(b"\r\n\r\n")
                if payload:
                    payload = payload.rstrip(b"\r\n")
                    if payload.startswith(b"%PDF"):
                        return payload
        return None
    return body


def _run_parser(pdf_bytes):
    """Write the PDF to a temp dir and run the unchanged parser in --json mode."""
    tmp = tempfile.mkdtemp(prefix="parse-")
    try:
        with open(os.path.join(tmp, "statement.pdf"), "wb") as fh:
            fh.write(pdf_bytes)
        out = subprocess.run(
            [sys.executable, PARSER, tmp, "--json"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            raise RuntimeError(out.stderr or "parser failed")
        return out.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        payload = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/ping", ""):
            return self._send(200, json.dumps({"status": "ok"}))
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if self.path.rstrip("/") != "/parse":
            return self._send(404, json.dumps({"error": "not found"}))
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        pdf = _extract_pdf(self.headers.get("Content-Type", ""), body)
        if not pdf:
            return self._send(400, json.dumps({"error": "empty body"}))
        try:
            self._send(200, _run_parser(pdf))
        except Exception as exc:  # noqa: BLE001 — surface parser failure to caller
            self._send(500, json.dumps({"error": str(exc)}))

    def log_message(self, *args):  # quiet the default per-request stderr noise
        pass


def main():
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
