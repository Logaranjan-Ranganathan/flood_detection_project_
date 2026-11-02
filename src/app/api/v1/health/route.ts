import { driverName, getDb } from "@/db/client";
import { apiError, apiOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + which database driver is actually serving this instance. */
export async function GET() {
  try {
    await getDb();
    return apiOk({
      service: "floodguard",
      status: "healthy",
      driver: driverName(),
      time: new Date().toISOString(),
    });
  } catch {
    return apiError(503, "database_unavailable", "Database is not reachable");
  }
}
