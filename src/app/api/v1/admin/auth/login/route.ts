import { apiError, apiOk, clientIp, logError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { loginAdmin } from "@/lib/session";
import { loginSchema } from "@/lib/schemas";

export const runtime = "nodejs";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`login:${ip}`, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return apiError(429, "too_many_attempts", "Too many sign-in attempts", {
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }

  const body = await readJson(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Email and password are required");
  }

  try {
    const result = await loginAdmin(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      return apiError(401, "invalid_credentials", result.error);
    }
    return apiOk({ signed_in: true });
  } catch (err) {
    logError("admin login", err);
    return apiError(500, "internal_error", "Could not sign in");
  }
}
