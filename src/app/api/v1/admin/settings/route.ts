import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import {
  getHealthWindow,
  getThresholds,
  setHealthWindow,
  setThresholds,
} from "@/db/repo";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { healthWindowSchema, thresholdsSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    return apiOk({
      thresholds: await getThresholds(),
      health_window: await getHealthWindow(),
    });
  } catch (err) {
    logError("admin settings get", err);
    return apiError(500, "internal_error", "Could not load settings");
  }
}

/**
 * Flood thresholds and stale/offline windows. Changes apply to how future
 * packets are classified and re-classify what the dashboard shows.
 */
export async function PUT(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body) return apiError(400, "invalid_payload", "A JSON body is required");

  try {
    const out: Record<string, unknown> = {};
    if ("thresholds" in body) {
      const parsed = thresholdsSchema.safeParse(body.thresholds);
      if (!parsed.success) {
        return apiError(400, "invalid_thresholds", "Thresholds are invalid", {
          issues: parsed.error.issues.map((i) => i.message),
        });
      }
      out.thresholds = await setThresholds(parsed.data);
    }
    if ("health_window" in body) {
      const parsed = healthWindowSchema.safeParse(body.health_window);
      if (!parsed.success) {
        return apiError(400, "invalid_health_window", "Health windows are invalid", {
          issues: parsed.error.issues.map((i) => i.message),
        });
      }
      out.health_window = await setHealthWindow(parsed.data);
    }
    if (!Object.keys(out).length) {
      return apiError(400, "invalid_payload", "Provide thresholds or health_window");
    }
    return apiOk(out);
  } catch (err) {
    logError("admin settings update", err);
    return apiError(500, "internal_error", "Could not save settings");
  }
}
