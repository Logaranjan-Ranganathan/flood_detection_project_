import { authenticateDeviceToken } from "@/db/repo";
import { apiError, apiOk, bearerToken, clientIp, logError, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ingestReading } from "@/lib/services/ingestion";
import { readingPayloadSchema } from "@/lib/schemas";

/** Per-device ceiling for a node that should report every couple of minutes. */
const LIMIT = Number(process.env.INGEST_RATE_LIMIT ?? 120);
const WINDOW_MS = 60_000;

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return apiError(401, "missing_token", "Authorization: Bearer <device token> is required");
  }

  const deviceId = await authenticateDeviceToken(token);
  if (!deviceId) {
    return apiError(401, "invalid_token", "Device token is not recognised or has been revoked");
  }

  const limit = rateLimit(`ingest:${deviceId}:${clientIp(request)}`, LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return apiError(429, "rate_limited", "Too many readings", {
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }

  const body = await readJson(request);
  const parsed = readingPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "invalid_payload", "Payload does not match the reading schema", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  try {
    const result = await ingestReading(parsed.data, {
      authenticatedDeviceId: deviceId,
      receivedAt: new Date(),
    });

    if (result.status === "duplicate") {
      return apiOk({
        duplicate: true,
        device_id: result.deviceId,
        message: "Packet already recorded",
      });
    }
    if (result.status === "rejected") {
      const status = result.code === "unknown_device" ? 404 : 403;
      return apiError(status, result.code, result.message);
    }

    return apiOk({
      duplicate: false,
      device_id: result.deviceId,
      raw_sensor_value: result.rawSensorValue,
      calibrated_water_level_cm: result.calibratedWaterLevelCm,
      water_flow_lpm: result.waterFlowLpm,
      flood_status: result.floodStatus,
      data_quality: result.dataQuality,
      received_at: result.receivedAt.toISOString(),
      alerts_raised: result.alertsRaised,
    });
  } catch (err) {
    logError("ingest reading", err);
    return apiError(500, "internal_error", "Could not record this reading");
  }
}
