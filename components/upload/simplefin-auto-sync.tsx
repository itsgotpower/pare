"use client";

// Renders nothing; fires ONE opportunistic SimpleFIN sync per dashboard visit.
// The server is the arbiter: {action:"sync", auto:true} no-ops (`skipped`)
// unless a connection exists, AUTO-SYNC is on, the last success is >20h old,
// and no attempt was made in the last hour — so mounting this on every
// dashboard load costs one cheap request, not one bridge call. Self-host has
// no cron; the daily "schedule" is simply the first dashboard visit of the
// day. Hosted answers 501 and the catch swallows it.

import { useEffect } from "react";

export function SimplefinAutoSync() {
  useEffect(() => {
    fetch("/api/simplefin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync", auto: true }),
    }).catch(() => {});
  }, []);
  return null;
}
