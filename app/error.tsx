"use client";

import { useChunkRecovery } from "@/lib/chunk-recovery";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Post-deploy chunk mismatch → auto-recover (clear SW caches + reload) and
  // show "UPDATING…" while it happens; anything else (incl. a recovery the
  // loop guard declined) → real error UI, reported to the beacon. All the
  // branching lives in the hook, shared with app/global-error.tsx.
  const recovering = useChunkRecovery(error);

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh]">
      <h2 className="font-mono text-xl font-bold tracking-tight uppercase mb-4">
        {recovering ? "UPDATING…" : "SOMETHING WENT WRONG"}
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
        {recovering
          ? "A new version of Pare shipped. Reloading…"
          : error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={recovering ? () => window.location.reload() : reset}
        className="px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase hover:bg-foreground hover:text-background transition-colors"
      >
        {recovering ? "RELOAD" : "TRY AGAIN"}
      </button>
    </div>
  );
}
