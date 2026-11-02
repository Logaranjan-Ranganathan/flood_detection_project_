import type { LevelStatus, Thresholds } from "./status";

export interface CalibrationParams {
  zeroRaw: number | null;
  spanRaw: number | null;
  referenceCm: number | null;
  verified: boolean;
}

/**
 * Two-point linear calibration: raw counts at a known dry point (0 cm) and at a
 * known reference depth. Returns null when calibration is absent or degenerate,
 * so callers can fall back to "raw reading, calibration required" instead of
 * pretending a raw count is a centimetre value.
 */
export function calibrateRawToCm(
  rawSensorValue: number,
  calib: CalibrationParams,
): number | null {
  const { zeroRaw, spanRaw, referenceCm, verified } = calib;
  if (!verified) return null;
  if (zeroRaw === null || spanRaw === null || referenceCm === null) return null;
  const spanCounts = spanRaw - zeroRaw;
  if (!Number.isFinite(spanCounts) || spanCounts === 0) return null;
  if (!Number.isFinite(referenceCm)) return null;

  const cm = ((rawSensorValue - zeroRaw) * referenceCm) / spanCounts;
  // A dry sensor can read slightly below its zero point; clamp the noise floor
  // but never clamp away a genuine negative that indicates a bad calibration.
  return Math.round(cm * 10) / 10;
}

/**
 * Classify a calibrated water level against admin-configured thresholds.
 * Uncalibrated devices never receive a severity claim.
 */
export function classifyLevel(
  calibratedCm: number | null,
  thresholds: Thresholds,
): LevelStatus {
  if (calibratedCm === null || !Number.isFinite(calibratedCm)) {
    return "CALIBRATION_REQUIRED";
  }
  if (calibratedCm >= thresholds.criticalCm) return "CRITICAL";
  if (calibratedCm >= thresholds.warningCm) return "WARNING";
  if (calibratedCm >= thresholds.watchCm) return "WATCH";
  return "NORMAL";
}

/** Sanity check used to flag implausible payloads rather than trust them. */
export function isPlausibleWaterLevel(cm: number | null): boolean {
  if (cm === null) return true;
  return cm >= -5 && cm <= 10_000;
}

export function effectiveStatus(
  level: LevelStatus,
  health: "ONLINE" | "STALE" | "OFFLINE",
): LevelStatus | "SENSOR_OFFLINE" | "DATA_STALE" {
  if (health === "OFFLINE") return "SENSOR_OFFLINE";
  if (health === "STALE") return "DATA_STALE";
  return level;
}
