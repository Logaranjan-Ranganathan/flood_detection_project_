import { apiError, apiOk, logError } from "@/lib/http";
import { getSensorDetail } from "@/lib/services/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const { deviceId } = await context.params;
  const hours = Number(
    new URL(request.url).searchParams.get("hours") ?? "24",
  );
  const window = Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 24 * 30) : 24;

  try {
    const detail = await getSensorDetail(deviceId, window);
    if (!detail) return apiError(404, "unknown_device", "No such sensor");
    return apiOk({
      device: detail.snapshot,
      zone_ids: detail.zoneIds,
      history: detail.history,
      history_count: detail.historyCount,
      window_hours: window,
    });
  } catch (err) {
    logError("public sensor detail", err);
    return apiError(500, "internal_error", "Could not load this sensor");
  }
}
