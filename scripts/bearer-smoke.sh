#!/usr/bin/env bash
#
# Bearer-auth smoke test — proves the MOBILE auth + data path against a live
# hosted deploy WITHOUT writing a line of Expo code (deploy-unblock.md → post-deploy
# verification step 3). It exercises exactly what the Expo app will do:
#
#   1. POST /api/auth/sign-in/email   -> better-auth signs in; the bearer() plugin
#                                        returns the session token in a
#                                        `set-auth-token` response header.
#   2. GET  /api/summary              -> replay it as `Authorization: Bearer <token>`;
#                                        a native client sends no cookie, so a 200
#                                        here proves bearer resolution end-to-end
#                                        (getSession -> the caller's Durable Object).
#
# A 200 with that user's data means D1 (auth), the per-user DO (data), and the
# bearer plugin are all wired. Run it after `cf:deploy` and after creating + (email-)
# verifying a test account.
#
# Usage:
#   HOST=https://pare.<sub>.workers.dev \
#   EMAIL=tester@example.com \
#   PASSWORD='…' \
#   scripts/bearer-smoke.sh
#
# The account must already exist AND be email-verified (requireEmailVerification is
# on — an unverified account can sign in but is blocked from acting).

set -euo pipefail

HOST="${HOST:?set HOST, e.g. https://pare.<sub>.workers.dev (no trailing slash)}"
EMAIL="${EMAIL:?set EMAIL of an existing, email-verified test account}"
PASSWORD="${PASSWORD:?set PASSWORD for that account}"

HOST="${HOST%/}" # tolerate a trailing slash

hdrs="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$hdrs" "$body"' EXIT

echo "→ [1/2] POST $HOST/api/auth/sign-in/email"
sign_in_code="$(
  curl -sS -o "$body" -D "$hdrs" -w '%{http_code}' \
    -X POST "$HOST/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"email":%s,"password":%s}' \
      "$(printf '%s' "$EMAIL" | sed 's/"/\\"/g; s/^/"/; s/$/"/')" \
      "$(printf '%s' "$PASSWORD" | sed 's/"/\\"/g; s/^/"/; s/$/"/')")"
)"

if [ "$sign_in_code" != "200" ]; then
  echo "✗ sign-in returned HTTP $sign_in_code (expected 200)" >&2
  echo "  response body:" >&2
  cat "$body" >&2
  exit 1
fi

# The bearer plugin emits `set-auth-token: <token>` (header name is case-insensitive).
token="$(grep -i '^set-auth-token:' "$hdrs" | head -n1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r\n')"
if [ -z "$token" ]; then
  echo "✗ no set-auth-token header in the sign-in response — is the bearer() plugin enabled?" >&2
  echo "  response headers:" >&2
  cat "$hdrs" >&2
  exit 1
fi
echo "  ✓ captured bearer token (${#token} chars)"

echo "→ [2/2] GET $HOST/api/summary  (Authorization: Bearer …)"
summary_code="$(
  curl -sS -o "$body" -w '%{http_code}' \
    "$HOST/api/summary" \
    -H "Authorization: Bearer $token"
)"

if [ "$summary_code" != "200" ]; then
  echo "✗ /api/summary returned HTTP $summary_code (expected 200)" >&2
  echo "  response body:" >&2
  cat "$body" >&2
  exit 1
fi

echo "  ✓ authed data request returned 200"
echo "  response (first 400 chars):"
head -c 400 "$body"; echo
echo
echo "✓ PASS — bearer sign-in → authed data round-trip works. Mobile auth path is live."
