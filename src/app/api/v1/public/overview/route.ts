import { apiError, apiOk, logError } from "@/lib/http";
import { getOverview } from "@/lib/services/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live snapshot for the dashboard, map and history charts. */
export async function GET() {
  try {
    const overview = await getOverview();
    return apiOk(overview);
  } catch (err) {
    logError("public overview", err);
    return apiError(500, "internal_error", "Could not load the flood overview");
  }
}
