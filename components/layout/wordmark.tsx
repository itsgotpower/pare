import Link from "next/link";

// The Pare wordmark, used everywhere the brand appears (sidebar, mobile top bar,
// marketing header, auth gate) so the mark stays identical globally. Rest state
// shows the pear; hovering swaps it for the scissors — "pare" as in trim/cut.
// Pure CSS group-hover, no JS. Pass `href` to render a link (with the group on
// the anchor); omit it for a non-navigating span (e.g. the public marketing
// header, where the app isn't reachable signed-out).
export function Wordmark({
  href,
  className = "",
}: {
  href?: string;
  className?: string;
}) {
  const cls = `group inline-flex items-center gap-1.5 ${className}`;
  const inner = (
    <>
      <span aria-hidden="true" className="inline-block">
        <span className="inline group-hover:hidden">🍐</span>
        <span className="hidden group-hover:inline">✂️</span>
      </span>
      <span>PARE</span>
    </>
  );
  return href ? (
    <Link href={href} aria-label="Pare — home" className={cls}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}
