import type { HealthStatus, HealthWindow } from "./status";

export const MINUTE_MS = 60_000;

/**
 * Communication health from the last packet time. Missing timestamps are
 * OFFLINE: a sensor that has never reported has no data to trust.
 */
export function healthFromLastSeen(
  lastSeenAt: Date | null,
  now: Date,
  window: HealthWindow,
): HealthStatus {
  if (!lastSeenAt) return "OFFLINE";
  const ageMs = now.getTime() - lastSeenAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "STALE";
  if (ageMs >= window.offlineAfterMinutes * MINUTE_MS) return "OFFLINE";
  if (ageMs >= window.staleAfterMinutes * MINUTE_MS) return "STALE";
  return "ONLINE";
}

export function ageInMinutes(lastSeenAt: Date | null, now: Date): number | null {
  if (!lastSeenAt) return null;
  return Math.max(0, Math.round((now.getTime() - lastSeenAt.getTime()) / MINUTE_MS));
}

/** Human-friendly "3 min ago" for tables and map popups. */
export function formatAge(lastSeenAt: Date | null, now: Date = new Date()): string {
  const minutes = ageInMinutes(lastSeenAt, now);
  if (minutes === null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h ago`;
}

/**
 * Retransmission guard key. LoRa nodes re-send the same packet when a gateway
 * misses it, and sequence numbers reset on reboot, so the key binds the device,
 * the sequence number and a coarse timestamp bucket.
 */
export function buildDedupeKey(input: {
  deviceId: string;
  packetSequence: number | null;
  deviceReportedAt: Date | null;
  receivedAt: Date;
  bucketSeconds?: number;
}): string {
  const bucketSeconds = input.bucketSeconds ?? 300;
  const anchor = input.deviceReportedAt ?? input.receivedAt;
  const bucket = Math.floor(anchor.getTime() / (bucketSeconds * 1000));
  const seq = input.packetSequence ?? "noseq";
  return `${input.deviceId}:${seq}:${bucket}`;
}
