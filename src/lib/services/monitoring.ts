import {
  FLOW_UNAVAILABLE_NOTICE,
  LOCATION_UNAVAILABLE_NOTICE,
  RAW_READING_NOTICE,
  SEVERITY_RANK,
  WAITING_FOR_DATA_NOTICE,
  DEFAULT_HEALTH_WINDOW,
  DEFAULT_THRESHOLDS,
  type EffectiveStatus,
  type HealthWindow,
  type LevelStatus,
  type Thresholds,
} from "../status";
import { classifyLevel } from "../calibration";
import { ageInMinutes, healthFromLastSeen } from "../health";
import { hasLocation, isWithinZone } from "../geo";
import type {
  DeviceSnapshot,
  DeviceView,
  GatewayView,
  LatestReadingView,
  ZoneSummary,
  ZoneView,
} from "../views";

export const GATEWAY_OFFLINE_AFTER_MINUTES = 15;

export function mergeThresholds(
  global: Thresholds,
  override?: Partial<Thresholds> | null,
): Thresholds {
  if (!override) return global;
  return {
    watchCm: numberOr(override.watchCm, global.watchCm),
    warningCm: numberOr(override.warningCm, global.warningCm),
    criticalCm: numberOr(override.criticalCm, global.criticalCm),
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Level for a single stored reading. Recalibrated devices re-derive the level
 * from the raw count so that changing calibration immediately changes the
 * classification of historic points.
 */
export function levelForReading(
  reading: LatestReadingView | null,
  thresholds: Thresholds,
  calibrationVerified: boolean,
): LevelStatus {
  if (!reading) return "CALIBRATION_REQUIRED";
  const cm = calibrationVerified ? reading.calibratedWaterLevelCm : null;
  return classifyLevel(cm, thresholds);
}

export function buildSnapshot(input: {
  device: DeviceView;
  latestReading: LatestReadingView | null;
  zones: ZoneView[];
  thresholds: Thresholds;
  healthWindow?: HealthWindow;
  now?: Date;
}): DeviceSnapshot {
  const {
    device,
    latestReading,
    zones,
    thresholds,
    healthWindow = DEFAULT_HEALTH_WINDOW,
    now = new Date(),
  } = input;

  const effectiveThresholds = mergeThresholds(thresholds, device.thresholdsOverride);
  const levelStatus = levelForReading(
    latestReading,
    effectiveThresholds,
    device.calibrationVerified,
  );
  const healthStatus = healthFromLastSeen(device.lastSeenAt, now, healthWindow);
  const effectiveStatus: EffectiveStatus =
    healthStatus === "OFFLINE"
      ? "SENSOR_OFFLINE"
      : healthStatus === "STALE"
        ? "DATA_STALE"
        : levelStatus;

  const locationAvailable =
    device.locationVerified && hasLocation(device);

  const zoneIds = locationAvailable
    ? zones
        .filter((z) =>
          isWithinZone(
            { latitude: device.latitude as number, longitude: device.longitude as number },
            z,
          ),
        )
        .map((z) => z.zoneId)
    : [];
  if (device.zoneId && !zoneIds.includes(device.zoneId)) zoneIds.push(device.zoneId);

  const flowValue =
    device.flowSupported && latestReading?.waterFlowLpm != null
      ? latestReading.waterFlowLpm
      : null;

  const notices: string[] = [];
  if (!latestReading) notices.push(WAITING_FOR_DATA_NOTICE);
  if (latestReading && !device.calibrationVerified) notices.push(RAW_READING_NOTICE);
  if (!locationAvailable) notices.push(LOCATION_UNAVAILABLE_NOTICE);
  if (flowValue === null) notices.push(FLOW_UNAVAILABLE_NOTICE);

  return {
    ...device,
    thresholdsOverride: effectiveThresholds,
    levelStatus,
    healthStatus,
    effectiveStatus,
    lastReading: latestReading,
    ageMinutes: ageInMinutes(device.lastSeenAt, now),
    hasLocation: locationAvailable,
    zoneIds,
    flowValue,
    flowIsEstimated: false,
    notices,
  };
}

export function buildSnapshots(
  devices: DeviceView[],
  latestByDevice: Map<string, LatestReadingView>,
  zones: ZoneView[],
  thresholds: Thresholds,
  healthWindow: HealthWindow = DEFAULT_HEALTH_WINDOW,
  now: Date = new Date(),
): DeviceSnapshot[] {
  return devices.map((device) =>
    buildSnapshot({
      device,
      latestReading: latestByDevice.get(device.deviceId) ?? null,
      zones,
      thresholds,
      healthWindow,
      now,
    }),
  );
}

/**
 * Zone roll-ups. A device inside overlapping zones is counted once per zone and
 * never twice within the same zone, because membership is a Set of device ids.
 */
export function summarizeZones(
  zones: ZoneView[],
  snapshots: DeviceSnapshot[],
): ZoneSummary[] {
  return zones.map((zone) => {
    const ids = new Set<string>();
    const members: DeviceSnapshot[] = [];
    for (const s of snapshots) {
      if (!s.zoneIds.includes(zone.zoneId)) continue;
      if (ids.has(s.deviceId)) continue;
      ids.add(s.deviceId);
      members.push(s);
    }

    const calibrated = members.filter(
      (m) => m.lastReading && m.calibrationVerified,
    );
    const levels = calibrated
      .map((m) => m.lastReading?.calibratedWaterLevelCm)
      .filter((v): v is number => typeof v === "number");

    const highestStatus = members.length
      ? members.reduce<EffectiveStatus>(
          (best, m) =>
            (SEVERITY_RANK[m.effectiveStatus] ?? 0) > (SEVERITY_RANK[best] ?? 0)
              ? m.effectiveStatus
              : best,
          "NORMAL",
        )
      : "NO_DATA";

    const lastUpdate = members
      .map((m) => m.lastReading?.receivedAt ?? null)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const newest = calibrated
      .filter((m) => m.lastReading)
      .sort(
        (a, b) =>
          (b.lastReading?.receivedAt.getTime() ?? 0) -
          (a.lastReading?.receivedAt.getTime() ?? 0),
      )[0];

    const withData = members.filter((m) => m.lastReading);

    return {
      ...zone,
      deviceIds: [...ids],
      deviceCount: ids.size,
      highestStatus,
      highestLevelCm: levels.length ? Math.max(...levels) : null,
      latestLevelCm: newest?.lastReading?.calibratedWaterLevelCm ?? null,
      lastUpdate,
      hasAnyCalibratedData: calibrated.length > 0,
      hasFlowData: members.some((m) => m.flowValue !== null),
      containsSimulatedOnly:
        withData.length > 0 && withData.every((m) => m.lastReading?.simulated),
    } satisfies ZoneSummary;
  });
}

export function gatewayStatus(
  gateway: GatewayView,
  now: Date = new Date(),
  offlineAfterMinutes = GATEWAY_OFFLINE_AFTER_MINUTES,
): "ONLINE" | "OFFLINE" | "UNKNOWN" {
  if (!gateway.lastSeenAt) return "UNKNOWN";
  const age = now.getTime() - gateway.lastSeenAt.getTime();
  return age <= offlineAfterMinutes * 60_000 ? "ONLINE" : "OFFLINE";
}

export const FALLBACK_THRESHOLDS = DEFAULT_THRESHOLDS;
