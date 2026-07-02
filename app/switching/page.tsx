// Alias for the primary migration landing. "/switch" is canonical (Scott's call,
// 2026-07-02); this route shipped in the pain-relief pass (PR #56) and is linked
// from live copy, so it keeps rendering the same page + wizard as /switch — the
// same one-source-of-truth re-export pattern as /switch-from-monarch. Also listed
// in middleware PUBLIC_PATHS + WAITLIST_PUBLIC and the Sidebar's chromeless set.
export { metadata } from "../switch/page";
export { default } from "../switch/page";
