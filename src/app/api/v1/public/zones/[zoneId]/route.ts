import { apiError, apiOk, logError } from "@/lib/http";
import { getZoneDetail } from "@/lib/services/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ zoneId: string }> },
) {
  const { zoneId } = await context.params;
  try {
    const detail = await getZoneDetail(zoneId);
    if (!detail) return apiError(404, "unknown_zone", "No such monitoring zone");
    return apiOk({ zone: detail.zone, members: detail.members });
  } catch (err) {
    logError("public zone detail", err);
    return apiError(500, "internal_error", "Could not load this zone");
  }
}
