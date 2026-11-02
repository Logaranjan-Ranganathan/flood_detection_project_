"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the server components by refreshing the route tree. The values shown
 * always come from the database, never from a hardcoded client fixture.
 */
export function LiveRefresh({
  intervalMs = 30_000,
  paused = false,
}: {
  intervalMs?: number;
  paused?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, paused]);

  return null;
}
