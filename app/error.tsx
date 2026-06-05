"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh]">
      <h2 className="font-mono text-xl font-bold tracking-tight uppercase mb-4">
        SOMETHING WENT WRONG
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase hover:bg-foreground hover:text-background transition-colors"
      >
        TRY AGAIN
      </button>
    </div>
  );
}
