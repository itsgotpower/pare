// Length-aware constant-time-ish string compare so admin-token checks don't leak
// via early-exit timing. Runtime-agnostic (no node:crypto) — runs on the Edge/
// Workers target too. Used by the waitlist and feedback admin exports.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
