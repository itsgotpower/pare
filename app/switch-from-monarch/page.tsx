// SEO alias for the migration landing. "/switch-from-monarch" is the high-intent
// search target ("Monarch alternative", "export Monarch data"); it renders the
// same page + wizard as /switch. Kept as a re-export so there's one source of
// truth for the UI. Also listed in middleware PUBLIC_PATHS + the Sidebar's
// chromeless set.
export { metadata } from "../switch/page";
export { default } from "../switch/page";
