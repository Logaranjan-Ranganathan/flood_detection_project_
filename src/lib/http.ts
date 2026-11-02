import { NextResponse } from "next/server";

/**
 * Every API error is a stable machine-readable code plus a short safe message.
 * Internal exceptions are logged server-side only, never echoed to devices.
 */
export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, ...data }, init);
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Logs without secrets: never print Authorization headers or tokens. */
export function logError(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[floodguard] ${scope}: ${message}`);
}
