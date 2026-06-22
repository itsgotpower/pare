"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UploadResult {
  inserted: number;
  skipped: number;
  total: number;
  filename: string;
  error?: string;
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
    },
    [uploadFile]
  );


  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
        UPLOAD
      </h1>

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

      {results.length > 0 && (
        <div className="mt-6 space-y-3">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            RESULTS
          </h2>
          {results.map((r, i) => (
            <Card key={i}>
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
    </div>
  );
}
