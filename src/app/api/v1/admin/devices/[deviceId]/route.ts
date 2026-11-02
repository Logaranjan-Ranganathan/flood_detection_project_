import { isAdminPrincipal, requireAdminOr401 } from "@/lib/admin-guard";
import { apiError, apiOk, logError, readJson } from "@/lib/http";
import {
  deleteDevice,
  getDeviceRow,
  setDeviceCalibration,
  setDeviceLocation,
  setDeviceThresholds,
  upsertDevice,
} from "@/db/repo";
import { devicePatchSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const { deviceId } = await context.params;
  const existing = await getDeviceRow(deviceId);
  if (!existing) return apiError(404, "unknown_device", "No such sensor");

  const parsed = devicePatchSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Update was rejected", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const patch = parsed.data;
  try {
    if (
      patch.label !== undefined ||
      patch.gateway_id !== undefined ||
      patch.zone_id !== undefined ||
      patch.flow_supported !== undefined
    ) {
      await upsertDevice({
        deviceId,
        label: patch.label ?? existing.label,
        gatewayId:
          patch.gateway_id === undefined ? existing.gatewayId : patch.gateway_id,
        zoneId: patch.zone_id === undefined ? existing.zoneId : patch.zone_id,
        latitude: existing.latitude,
        longitude: existing.longitude,
        locationVerified: existing.locationVerified,
        locationSource: existing.locationSource as
          "GPS" | "MANUAL" | "UNVERIFIED",
        flowSupported: patch.flow_supported ?? existing.flowSupported,
        firmwareVersion: existing.firmwareVersion,
      });
    }

    if (patch.location !== undefined) {
      if (patch.location === null) {
        await setDeviceLocation(deviceId, {
          latitude: null,
          longitude: null,
          verified: false,
          source: "UNVERIFIED",
        });
      } else {
        await setDeviceLocation(deviceId, {
          latitude: patch.location.latitude,
          longitude: patch.location.longitude,
          verified: patch.location.verified,
          source: patch.location.source,
        });
      }
    }

    if (patch.calibration !== undefined) {
      const c = patch.calibration;
      await setDeviceCalibration(deviceId, {
        zeroRaw: c?.zeroRaw ?? null,
        spanRaw: c?.spanRaw ?? null,
        referenceCm: c?.referenceCm ?? null,
        verified: c?.verified ?? false,
      });
    }

    if (patch.thresholds_override !== undefined) {
      await setDeviceThresholds(deviceId, patch.thresholds_override);
    }

    const updated = await getDeviceRow(deviceId);
    return apiOk({
      device: {
        deviceId: updated?.deviceId,
        label: updated?.label,
        gatewayId: updated?.gatewayId,
        zoneId: updated?.zoneId,
        latitude: updated?.latitude,
        longitude: updated?.longitude,
        locationVerified: updated?.locationVerified,
        locationSource: updated?.locationSource,
        calibrationVerified: updated?.calibrationVerified,
        calibZeroRaw: updated?.calibZeroRaw,
        calibSpanRaw: updated?.calibSpanRaw,
        calibReferenceCm: updated?.calibReferenceCm,
        flowSupported: updated?.flowSupported,
        thresholdsOverride: updated?.thresholdsOverride,
      },
    });
  } catch (err) {
    logError("admin device patch", err);
    return apiError(500, "internal_error", "Could not update this device");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const admin = await requireAdminOr401();
  if (!isAdminPrincipal(admin)) return admin;

  const { deviceId } = await context.params;
  const existing = await getDeviceRow(deviceId);
  if (!existing) return apiError(404, "unknown_device", "No such sensor");

  try {
    await deleteDevice(deviceId);
    return apiOk({ deleted: deviceId });
  } catch (err) {
    logError("admin device delete", err);
    return apiError(500, "internal_error", "Could not delete this device");
  }
}
