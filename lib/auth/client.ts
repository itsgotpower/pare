"use client";

import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

// HOSTED-mode browser auth client. Talks to the better-auth handler mounted at
// /api/auth/* (app/api/auth/[...all]/route.ts). Same-origin — the web app is
// served from the same Worker as the auth endpoints — so baseURL is omitted and
// defaults to the current origin.
//
// SCOPE: this is the HOSTED path only. Self-hosted mode uses the single-user
// gate (app/api/auth/route.ts, driven by the plain fetch() in
// app/login/page.tsx) and never touches this client. Guard any call site on the
// deploy target (e.g. a NEXT_PUBLIC_PARE_DEPLOY_TARGET flag) before invoking.
//
// passkeyClient() runs the WebAuthn ceremony in the browser (navigator.
// credentials) and verifies against the passkey() server plugin. Verified entry
// points used by the UI:
//   authClient.signIn.passkey()      -> sign in with an existing passkey
//   authClient.passkey.addPasskey()  -> register a passkey (while signed in)
// The plugin also exposes list / delete actions (backed by /api/auth/passkey/*)
// for a passkey-management surface.
export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});
