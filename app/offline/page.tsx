// Offline fallback, precached by the service worker and served when a
// navigation fails with nothing cached. Public (middleware matcher excludes
// /offline) so the SW can precache it signed-out. Static by design — no data.
export const metadata = { title: "pare | Offline" };

export default function OfflinePage() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="border border-foreground p-8 max-w-sm w-full text-center">
        <p className="font-mono text-2xl font-bold tracking-tight uppercase mb-3">
          OFFLINE
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          No connection, and this page isn&apos;t cached yet. Pages you&apos;ve
          visited before stay readable offline.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase hover:bg-foreground hover:text-background transition-colors"
        >
          BACK TO DASHBOARD
        </a>
      </div>
    </div>
  );
}
