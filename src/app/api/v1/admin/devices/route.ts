import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import { getDeviceRow, listCredentials, upsertDevice } from "@/db/repo";
import { deviceUpsertSchema } from "@/lib/schemas";
import { getOverview } from "@/lib/services/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;
  try {
    const overview = await getOverview();
    return apiOk({ devices: overview.devices, thresholds: overview.thresholds });
  } catch (err) {
    logError("admin devices list", err);
    return apiError(500, "internal_error", "Could not list devices");
  }
}

/** Register a sensor (ESP32-1 node). */
export async function POST(request: Request) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const body = await readJson(request);
  const parsed = deviceUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Device details are incomplete", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const existing = await getDeviceRow(parsed.data.device_id);
    const row = await upsertDevice({
      deviceId: parsed.data.device_id,
      label: parsed.data.label,
      gatewayId: parsed.data.gateway_id,
      zoneId: parsed.data.zone_id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      locationVerified: parsed.data.location_verified,
      locationSource: parsed.data.location_source,
      flowSupported: parsed.data.flow_supported,
      firmwareVersion: parsed.data.firmware_version,
    });
    const credentials = await listCredentials({ deviceId: row.deviceId });
    return apiOk({
      device: {
        deviceId: row.deviceId,
        label: row.label,
        gatewayId: row.gatewayId,
        zoneId: row.zoneId,
        calibrationVerified: row.calibrationVerified,
        flowSupported: row.flowSupported,
        credentialCount: credentials.length,
      },
      created: !existing,
    });
  } catch (err) {
    logError("admin device create", err);
    return apiError(500, "internal_error", "Could not register this device");
  }
}
