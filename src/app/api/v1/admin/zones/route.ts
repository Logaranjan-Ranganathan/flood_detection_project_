import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { deleteZone, getZone, listZones, upsertZone } from "@/db/repo";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { DEFAULT_MONITORING_ZONE_RADIUS_M } from "@/lib/status";
import { zoneUpsertSchema } from "@/lib/schemas";
import { getOverview } from "@/lib/services/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    const overview = await getOverview();
    return apiOk({ zones: overview.zones });
  } catch (err) {
    logError("admin zones list", err);
    return apiError(500, "internal_error", "Could not list zones");
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const parsed = zoneUpsertSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Zone definition is invalid", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const existing = await getZone(parsed.data.zone_id);
    await upsertZone({
      zoneId: parsed.data.zone_id,
      name: parsed.data.name,
      centerLatitude: parsed.data.center_latitude,
      centerLongitude: parsed.data.center_longitude,
      radiusMeters: parsed.data.radius_meters ?? DEFAULT_MONITORING_ZONE_RADIUS_M,
      localityNote: parsed.data.locality_note,
    });
    return apiOk({ zone_id: parsed.data.zone_id, created: !existing });
  } catch (err) {
    logError("admin zone create", err);
    return apiError(500, "internal_error", "Could not save this zone");
  }
}

export async function DELETE(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const zoneId = new URL(request.url).searchParams.get("zone_id");
  if (!zoneId) return apiError(400, "invalid_payload", "zone_id is required");
  const existing = await getZone(zoneId);
  if (!existing) return apiError(404, "unknown_zone", "No such zone");

  try {
    await deleteZone(zoneId);
    const remaining = await listZones();
    return apiOk({ deleted: zoneId, zones: remaining.length });
  } catch (err) {
    logError("admin zone delete", err);
    return apiError(500, "internal_error", "Could not delete this zone");
  }
}
