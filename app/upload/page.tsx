"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BankGuides } from "@/components/upload/bank-guides";
import { SimplefinCard } from "@/components/upload/simplefin-card";

interface UploadResult {
  inserted: number;
  skipped: number;
  total: number;
  filename: string;
  error?: string;
}

// Chrome's install-prompt event (not in lib.dom — spec is still WICG).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Cache the service worker stashes Web Share Target files into (see
// handleShareTarget in public/sw.js).
const SHARE_CACHE = "pare-share-intake";

// Hosted parse-job record (GET /api/upload/status). "done" and "failed" are the
// only terminal states; "queued"/"parsing"/"retrying" mean keep polling.
interface ParseJobStatus {
  status: "queued" | "parsing" | "retrying" | "done" | "failed";
  inserted: number | null;
  skipped: number | null;
  error: string | null;
}

// Poll a hosted parse job until it reaches a terminal state. Returns null on
// timeout (~3 min) — parsing normally finishes in seconds.
async function pollJob(jobId: string): Promise<ParseJobStatus | null> {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`/api/upload/status?jobId=${encodeURIComponent(jobId)}`);
      if (!res.ok) continue;
      const job: ParseJobStatus = await res.json();
      if (job.status === "done" || job.status === "failed") return job;
    } catch {
      // transient network blip — keep polling
    }
  }
  return null;
}

export default function UploadPage() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      // Hosted mode: the upload is queued (202 { jobId }) and parsed in the
      // background — poll the job to its terminal state so failures (unsupported
      // PDF, plan account cap, …) actually surface here.
      if (res.status === 202 && data.jobId) {
        const job = await pollJob(data.jobId);
        if (!job) {
          setError("Still parsing — check back in a minute.");
          return;
        }
        if (job.status === "failed") {
          setError(job.error || "Parsing failed");
          return;
        }
        const inserted = job.inserted ?? 0;
        const skipped = job.skipped ?? 0;
        setResults((prev) => [
          { filename: file.name, inserted, skipped, total: inserted + skipped },
          ...prev,
        ]);
        return;
      }

      setResults((prev) => [data, ...prev]);
    } catch {
      setError("Upload failed — check the server console");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        uploadFile(file);
      }
      // Clear the input so picking the SAME file again re-fires change —
      // without this, re-uploading a statement (the dedup flow) does nothing.
      e.target.value = "";
    },
    [uploadFile]
  );

  // Web Share Target intake (Android): arriving as /upload?share-target=1
  // means the SW stashed shared files in Cache Storage. Read them back, clear
  // the stash, and run them through the normal upload flow.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("share-target")) return;
    if (!("caches" in window)) return;
    (async () => {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const name = decodeURIComponent(
          res.headers.get("X-File-Name") ?? "statement.pdf"
        );
        await cache.delete(req);
        uploadFile(new File([blob], name, { type: blob.type }));
      }
      // Drop the query so a refresh doesn't re-run the (now empty) intake.
      window.history.replaceState(null, "", "/upload");
    })();
  }, [uploadFile]);

  // Add-to-Home-Screen: capture Chrome's install prompt and offer it only
  // after a successful upload (per the build plan — not on landing).
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Web push opt-in, offered alongside the install prompt after a successful
  // upload. "unavailable" = unsupported browser, permission denied, or already
  // subscribed — in all three cases the card stays hidden.
  const [pushState, setPushState] = useState<
    "unavailable" | "available" | "enabling" | "enabled"
  >("unavailable");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setPushState(existing ? "unavailable" : "available");
    });
  }, []);

  const enablePush = useCallback(async () => {
    setPushState("enabling");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setPushState("unavailable");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      setPushState(res.ok ? "enabled" : "unavailable");
    } catch {
      setPushState("unavailable");
    }
  }, []);


  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
        UPLOAD
      </h1>
      <p className="text-xs text-muted-foreground mb-6">
        The 30 seconds that keep your bank logins yours — drop a statement you
        already have instead of handing your credentials to an aggregator. Files
        are parsed and discarded; only the transactions stay.
      </p>

      <Card
        className={`border-2 transition-colors cursor-pointer ${
          dragOver ? "border-foreground bg-accent" : "border-dashed border-muted-foreground/30"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="font-mono text-sm tracking-widest uppercase text-muted-foreground">
            {uploading ? "PROCESSING..." : "DROP STATEMENT OR OFX/QFX HERE"}
          </p>
          <p className="text-xs text-muted-foreground">
            PDF credit-card / bank statements, or .ofx / .qfx exports
          </p>
          <label className="mt-2">
            <span className="inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase cursor-pointer hover:bg-foreground hover:text-background transition-colors">
              BROWSE FILES
            </span>
            <input
              type="file"
              accept=".pdf,.ofx,.qfx"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </CardContent>
      </Card>

      {error && (
        <Card className="mt-6 border-destructive">
          <CardContent className="py-4">
            <p className="font-mono text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Opt-in SimpleFIN sync — renders nothing on hosted or when disabled. */}
      <SimplefinCard />

      {results.length > 0 && installPrompt && (
        <Card className="mt-6 pare-reveal" style={{ animationDelay: "220ms" }}>
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-sm font-medium uppercase tracking-wide">
                ADD PARE TO YOUR HOME SCREEN
              </p>
              <p className="text-xs text-muted-foreground">
                Full-screen app, works offline with your last-synced data
              </p>
            </div>
            <button
              className="shrink-0 inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase cursor-pointer hover:bg-foreground hover:text-background transition-colors"
              onClick={async () => {
                await installPrompt.prompt();
                setInstallPrompt(null);
              }}
            >
              INSTALL
            </button>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && pushState !== "unavailable" && (
        <Card className="mt-6 pare-reveal" style={{ animationDelay: "280ms" }}>
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-sm font-medium uppercase tracking-wide">
                {pushState === "enabled" ? "ALERTS ON" : "GET PARSE ALERTS"}
              </p>
              <p className="text-xs text-muted-foreground">
                {pushState === "enabled"
                  ? "Check your notifications for the confirmation"
                  : "A notification when a statement finishes parsing"}
              </p>
            </div>
            {pushState !== "enabled" && (
              <button
                className="shrink-0 inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase cursor-pointer hover:bg-foreground hover:text-background transition-colors disabled:opacity-50"
                disabled={pushState === "enabling"}
                onClick={enablePush}
              >
                {pushState === "enabling" ? "ENABLING..." : "ENABLE"}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            RESULTS
          </h2>
          {results.map((r, i) => (
            <Card
              key={i}
              className="pare-reveal"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm font-medium">{r.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.total} transactions parsed
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">
                    <span className="text-foreground">{r.inserted}</span> inserted
                  </p>
                  {r.skipped > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {r.skipped} duplicates skipped
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BankGuides />
    </div>
  );
}
