interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

/**
 * Fixed-window limiter. Enough to blunt a runaway or spoofed firmware loop;
 * a shared store (Redis) is the documented upgrade path for multi-instance
 * deployments.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
  }
  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - existing.count),
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
