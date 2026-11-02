import {
  getHealthWindow,
  getThresholds,
  lastIngestAt,
  latestReadingsByDevice,
  listAlerts,
  listDevices,
  listGateways,
  listZones,
  readingsForDevice,
  getDevice,
  getZone,
  readingCountForDevice,
} from "@/db/repo";
import { buildSnapshots, gatewayStatus, summarizeZones } from "./monitoring";
import { sweepHealth } from "./ingestion";
import type { DeviceSnapshot, GatewayView, ZoneSummary } from "@/lib/views";
import type { AlertView } from "@/db/repo";
import type { HealthWindow, Thresholds } from "@/lib/status";

export interface DashboardStats {
  totalSensors: number;
  onlineSensors: number;
  offlineSensors: number;
  staleSensors: number;
  warningSensors: number;
  criticalSensors: number;
  watchSensors: number;
  uncalibratedSensors: number;
  zoneCount: number;
  gatewayCount: number;
  onlineGateways: number;
  activeAlerts: number;
  lastUpdate: Date | null;
}

export interface Overview {
  stats: DashboardStats;
  devices: DeviceSnapshot[];
  zones: ZoneSummary[];
  gateways: (GatewayView & { status: string; ageMinutes: number | null })[];
  alerts: AlertView[];
  thresholds: Thresholds;
  healthWindow: HealthWindow;
  lastUpdate: Date | null;
  demoMode: boolean;
  generatedAt: Date;
}

let lastSweepAt = 0;

/**
 * Refresh health alerts while the page is being read, but at most once a
 * minute per process so a busy dashboard cannot turn every poll into a scan.
 */
async function maybeSweep(now: Date): Promise<void> {
  if (now.getTime() - lastSweepAt < 60_000) return;
  lastSweepAt = now.getTime();
  try {
    await sweepHealth(now);
  } catch {
    // A failed sweep must never break the public dashboard.
  }
}

export async function getOverview(now: Date = new Date()): Promise<Overview> {
  await maybeSweep(now);

  const [devices, latest, zones, gatewaysRaw, thresholds, healthWindow, alerts, lastUpdate] =
    await Promise.all([
      listDevices(),
      latestReadingsByDevice(),
      listZones(),
      listGateways(),
      getThresholds(),
      getHealthWindow(),
      listAlerts({ limit: 50 }),
      lastIngestAt(),
    ]);

  const snapshots = buildSnapshots(devices, latest, zones, thresholds, healthWindow, now);
  const zoneSummaries = summarizeZones(zones, snapshots);

  const stats: DashboardStats = {
    totalSensors: snapshots.length,
    onlineSensors: snapshots.filter((s) => s.healthStatus === "ONLINE").length,
    offlineSensors: snapshots.filter((s) => s.effectiveStatus === "SENSOR_OFFLINE").length,
    staleSensors: snapshots.filter((s) => s.effectiveStatus === "DATA_STALE").length,
    warningSensors: snapshots.filter((s) => s.levelStatus === "WARNING").length,
    criticalSensors: snapshots.filter((s) => s.levelStatus === "CRITICAL").length,
    watchSensors: snapshots.filter((s) => s.levelStatus === "WATCH").length,
    uncalibratedSensors: snapshots.filter(
      (s) => !s.calibrationVerified,
    ).length,
    zoneCount: zoneSummaries.length,
    gatewayCount: gatewaysRaw.length,
    onlineGateways: gatewaysRaw.filter(
      (g) => gatewayStatus(g, now) === "ONLINE",
    ).length,
    activeAlerts: alerts.length,
    lastUpdate,
  };

  return {
    stats,
    devices: snapshots,
    zones: zoneSummaries,
    gateways: gatewaysRaw.map((g) => ({
      ...g,
      status: gatewayStatus(g, now),
      ageMinutes: g.lastSeenAt
        ? Math.max(0, Math.round((now.getTime() - g.lastSeenAt.getTime()) / 60_000))
        : null,
    })),
    alerts,
    thresholds,
    healthWindow,
    lastUpdate,
    demoMode: process.env.DEMO_MODE !== "false",
    generatedAt: now,
  };
}

export interface SensorDetail {
  snapshot: DeviceSnapshot;
  history: Awaited<ReturnType<typeof readingsForDevice>>;
  historyCount: number;
  zoneIds: string[];
}

export async function getSensorDetail(
  deviceId: string,
  hours = 24,
  now: Date = new Date(),
): Promise<SensorDetail | null> {
  const device = await getDevice(deviceId);
  if (!device) return null;

  const [latest, zones, thresholds, healthWindow, since, total] = await Promise.all([
    latestReadingsByDevice(),
    listZones(),
    getThresholds(),
    getHealthWindow(),
    readingsForDevice(deviceId, {
      since: new Date(now.getTime() - hours * 3_600_000),
    }),
    readingCountForDevice(deviceId),
  ]);

  const snapshot = buildSnapshots(
    [device],
    latest,
    zones,
    thresholds,
    healthWindow,
    now,
  )[0];

  return { snapshot, history: since, historyCount: total, zoneIds: snapshot.zoneIds };
}

export interface ZoneDetail {
  zone: ZoneSummary;
  members: DeviceSnapshot[];
  /** Snapshot time, so pages can age readings without calling Date in render. */
  generatedAt: Date;
}

export async function getZoneDetail(
  zoneId: string,
  now: Date = new Date(),
): Promise<ZoneDetail | null> {
  const zone = await getZone(zoneId);
  if (!zone) return null;

  const [devices, latest, zones, thresholds, healthWindow] = await Promise.all([
    listDevices(),
    latestReadingsByDevice(),
    listZones(),
    getThresholds(),
    getHealthWindow(),
  ]);
  const snapshots = buildSnapshots(devices, latest, zones, thresholds, healthWindow, now);
  const summary = summarizeZones(zones, snapshots).find(
    (z) => z.zoneId === zoneId,
  );
  if (!summary) return null;
  return {
    zone: summary,
    members: snapshots.filter((s) => s.zoneIds.includes(zoneId)),
    generatedAt: now,
  };
}
