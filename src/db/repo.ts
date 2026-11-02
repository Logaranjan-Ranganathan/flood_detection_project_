import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "./client";
import {
  adminSessions,
  admins,
  alerts,
  appSettings,
  deviceCredentials,
  devices,
  gateways,
  sensorReadings,
  sensorZones,
  type AlertRow,
  type DeviceRow,
  type ReadingRow,
  type ZoneRow,
} from "./schema";
import {
  DEFAULT_HEALTH_WINDOW,
  DEFAULT_THRESHOLDS,
  type HealthWindow,
  type Thresholds,
} from "@/lib/status";
import { hashToken } from "@/lib/auth";
import type {
  DeviceView,
  GatewayView,
  LatestReadingView,
  ZoneView,
} from "@/lib/views";
import { thresholdsSchema, healthWindowSchema } from "@/lib/schemas";

export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return true;
  const message = String((err as Error)?.message ?? err);
  return message.includes("duplicate key value") || message.includes('duplicate key value violates unique constraint');
}

// ---------------------------------------------------------------- settings

const KEY_THRESHOLDS = "flood_thresholds";
const KEY_HEALTH = "health_windows";

export async function getThresholds(): Promise<Thresholds> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, KEY_THRESHOLDS))
    .limit(1);
  if (!rows.length) return DEFAULT_THRESHOLDS;
  const parsed = thresholdsSchema.safeParse(rows[0].value);
  return parsed.success ? parsed.data : DEFAULT_THRESHOLDS;
}

export async function setThresholds(next: Thresholds): Promise<Thresholds> {
  const db = await getDb();
  const value = thresholdsSchema.parse(next);
  await db
    .insert(appSettings)
    .values({ key: KEY_THRESHOLDS, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  return value;
}

export async function getHealthWindow(): Promise<HealthWindow> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, KEY_HEALTH))
    .limit(1);
  if (!rows.length) return DEFAULT_HEALTH_WINDOW;
  const parsed = healthWindowSchema.safeParse(rows[0].value);
  return parsed.success ? parsed.data : DEFAULT_HEALTH_WINDOW;
}

export async function setHealthWindow(
  next: HealthWindow,
): Promise<HealthWindow> {
  const db = await getDb();
  const value = healthWindowSchema.parse(next);
  await db
    .insert(appSettings)
    .values({ key: KEY_HEALTH, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  return value;
}

// ------------------------------------------------------------------ devices

function toDeviceView(row: DeviceRow): DeviceView {
  return {
    deviceId: row.deviceId,
    label: row.label,
    gatewayId: row.gatewayId,
    zoneId: row.zoneId,
    latitude: row.latitude,
    longitude: row.longitude,
    locationVerified: row.locationVerified,
    locationSource: row.locationSource,
    calibrationVerified: row.calibrationVerified,
    flowSupported: row.flowSupported,
    thresholdsOverride: (row.thresholdsOverride as Partial<Thresholds> | null) ?? null,
    lastSeenAt: row.lastSeenAt,
    firmwareVersion: row.firmwareVersion,
  };
}

export async function listDevices(): Promise<DeviceView[]> {
  const db = await getDb();
  const rows = await db.select().from(devices).orderBy(asc(devices.deviceId));
  return rows.map(toDeviceView);
}

export async function getDevice(deviceId: string): Promise<DeviceView | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);
  return rows.length ? toDeviceView(rows[0]) : null;
}

export async function getDeviceRow(deviceId: string): Promise<DeviceRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);
  return rows.length ? rows[0] : null;
}

export interface DeviceCreateInput {
  deviceId: string;
  label: string;
  gatewayId?: string | null;
  zoneId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationVerified?: boolean;
  locationSource?: "GPS" | "MANUAL" | "UNVERIFIED";
  flowSupported?: boolean;
  firmwareVersion?: string | null;
}

export async function upsertDevice(input: DeviceCreateInput): Promise<DeviceRow> {
  const db = await getDb();
  const now = new Date();
  const values = {
    deviceId: input.deviceId,
    label: input.label,
    gatewayId: input.gatewayId ?? null,
    zoneId: input.zoneId ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    locationVerified: input.locationVerified ?? false,
    locationSource: input.locationSource ?? "UNVERIFIED",
    flowSupported: input.flowSupported ?? false,
    firmwareVersion: input.firmwareVersion ?? null,
    updatedAt: now,
  };

  const rows = await db
    .insert(devices)
    .values(values)
    .onConflictDoUpdate({
      target: devices.deviceId,
      set: {
        label: values.label,
        gatewayId: values.gatewayId,
        zoneId: values.zoneId,
        latitude: values.latitude,
        longitude: values.longitude,
        locationVerified: values.locationVerified,
        locationSource: values.locationSource,
        flowSupported: values.flowSupported,
        firmwareVersion: values.firmwareVersion,
        updatedAt: now,
      },
    })
    .returning();
  return rows[0];
}

export async function deleteDevice(deviceId: string): Promise<void> {
  const db = await getDb();
  await db.delete(devices).where(eq(devices.deviceId, deviceId));
}

export async function markDeviceSeen(input: {
  deviceId: string;
  at: Date;
  loraRssi?: number | null;
  loraSnr?: number | null;
  batteryVoltage?: number | null;
  firmwareVersion?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(devices)
    .set({
      lastSeenAt: input.at,
      updatedAt: input.at,
      ...(input.loraRssi !== undefined ? { lastLoraRssi: input.loraRssi } : {}),
      ...(input.loraSnr !== undefined ? { lastLoraSnr: input.loraSnr } : {}),
      ...(input.batteryVoltage !== undefined
        ? { lastBatteryVoltage: input.batteryVoltage }
        : {}),
      ...(input.firmwareVersion
        ? { firmwareVersion: input.firmwareVersion }
        : {}),
    })
    .where(eq(devices.deviceId, input.deviceId));
}

export async function setDeviceCalibration(
  deviceId: string,
  calib: {
    zeroRaw: number | null;
    spanRaw: number | null;
    referenceCm: number | null;
    verified: boolean;
  },
): Promise<void> {
  const db = await getDb();
  await db
    .update(devices)
    .set({
      calibZeroRaw: calib.zeroRaw,
      calibSpanRaw: calib.spanRaw,
      calibReferenceCm: calib.referenceCm,
      calibrationVerified: calib.verified,
      updatedAt: new Date(),
    })
    .where(eq(devices.deviceId, deviceId));
}

export async function setDeviceLocation(
  deviceId: string,
  loc: {
    latitude: number | null;
    longitude: number | null;
    verified: boolean;
    source: "GPS" | "MANUAL" | "UNVERIFIED";
  },
): Promise<void> {
  const db = await getDb();
  await db
    .update(devices)
    .set({
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationVerified: loc.verified,
      locationSource: loc.source,
      updatedAt: new Date(),
    })
    .where(eq(devices.deviceId, deviceId));
}

export async function setDeviceThresholds(
  deviceId: string,
  override: Partial<Thresholds> | null,
): Promise<void> {
  const db = await getDb();
  await db
    .update(devices)
    .set({ thresholdsOverride: override, updatedAt: new Date() })
    .where(eq(devices.deviceId, deviceId));
}

// ----------------------------------------------------------------- gateways

export async function upsertGateway(input: {
  gatewayId: string;
  name: string;
  firmwareVersion?: string | null;
  hardwareNote?: string | null;
}): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(gateways)
    .values({
      gatewayId: input.gatewayId,
      name: input.name,
      firmwareVersion: input.firmwareVersion ?? null,
      hardwareNote: input.hardwareNote ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: gateways.gatewayId,
      set: {
        name: input.name,
        firmwareVersion: input.firmwareVersion ?? null,
        hardwareNote: input.hardwareNote ?? null,
        updatedAt: now,
      },
    });
}

export async function recordGatewayStatus(input: {
  gatewayId: string;
  at: Date;
  firmwareVersion?: string | null;
  ipAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gpsFix?: boolean | null;
  loraRssi?: number | null;
  loraSnr?: number | null;
  batteryMv?: number | null;
  packetsReceived?: number | null;
  networkStatus?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(gateways)
    .set({
      lastSeenAt: input.at,
      updatedAt: input.at,
      ...(input.firmwareVersion ? { firmwareVersion: input.firmwareVersion } : {}),
      ...(input.ipAddress !== undefined ? { lastReportedIp: input.ipAddress } : {}),
      ...(input.latitude !== undefined && input.latitude !== null
        ? { latitude: input.latitude }
        : {}),
      ...(input.longitude !== undefined && input.longitude !== null
        ? { longitude: input.longitude }
        : {}),
      ...(input.gpsFix !== undefined ? { gpsFix: input.gpsFix } : {}),
      ...(input.loraRssi !== undefined ? { lastLoraRssi: input.loraRssi } : {}),
      ...(input.loraSnr !== undefined ? { lastLoraSnr: input.loraSnr } : {}),
      ...(input.batteryMv !== undefined ? { batteryMv: input.batteryMv } : {}),
      ...(input.packetsReceived !== undefined && input.packetsReceived !== null
        ? { packetsReceived: input.packetsReceived }
        : {}),
      ...(input.networkStatus ? { networkStatus: input.networkStatus } : {}),
    })
    .where(eq(gateways.gatewayId, input.gatewayId));
}

export async function listGateways(): Promise<GatewayView[]> {
  const db = await getDb();
  const rows = await db.select().from(gateways).orderBy(asc(gateways.gatewayId));
  return rows.map((r) => ({
    gatewayId: r.gatewayId,
    name: r.name,
    firmwareVersion: r.firmwareVersion,
    lastSeenAt: r.lastSeenAt,
    lastReportedIp: r.lastReportedIp,
    networkStatus: r.networkStatus,
    latitude: r.latitude,
    longitude: r.longitude,
    gpsFix: r.gpsFix,
    lastLoraRssi: r.lastLoraRssi,
    lastLoraSnr: r.lastLoraSnr,
    batteryMv: r.batteryMv,
    packetsReceived: r.packetsReceived,
    hardwareNote: r.hardwareNote,
  }));
}

export async function getGateway(gatewayId: string): Promise<GatewayView | null> {
  const all = await listGateways();
  return all.find((g) => g.gatewayId === gatewayId) ?? null;
}

/** Create a gateway row if it does not exist yet. Returns true when new. */
export async function ensureGatewayRegistered(
  gatewayId: string,
): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const inserted = await db
    .insert(gateways)
    .values({
      gatewayId,
      name: gatewayId,
      hardwareNote:
        "Auto-enrolled from an incoming packet. Confirm its placement in the admin console.",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ gatewayId: gateways.gatewayId });
  return inserted.length > 0;
}

/** Count one forwarded packet and refresh the gateway's last-seen time. */
export async function noteGatewayPacket(input: {
  gatewayId: string;
  at: Date;
  loraRssi?: number | null;
  loraSnr?: number | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .update(gateways)
    .set({
      lastSeenAt: input.at,
      updatedAt: input.at,
      networkStatus: "ONLINE",
      packetsReceived: sql`${gateways.packetsReceived} + 1`,
      ...(input.loraRssi !== undefined && input.loraRssi !== null
        ? { lastLoraRssi: input.loraRssi }
        : {}),
      ...(input.loraSnr !== undefined && input.loraSnr !== null
        ? { lastLoraSnr: input.loraSnr }
        : {}),
    })
    .where(eq(gateways.gatewayId, input.gatewayId));
}

// -------------------------------------------------------------------- zones

function toZoneView(row: ZoneRow): ZoneView {
  return {
    zoneId: row.zoneId,
    name: row.name,
    centerLatitude: row.centerLatitude,
    centerLongitude: row.centerLongitude,
    radiusMeters: row.radiusMeters,
    localityNote: row.localityNote,
  };
}

export async function listZones(): Promise<ZoneView[]> {
  const db = await getDb();
  const rows = await db.select().from(sensorZones).orderBy(asc(sensorZones.zoneId));
  return rows.map(toZoneView);
}

export async function getZone(zoneId: string): Promise<ZoneView | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sensorZones)
    .where(eq(sensorZones.zoneId, zoneId))
    .limit(1);
  return rows.length ? toZoneView(rows[0]) : null;
}

export async function upsertZone(input: {
  zoneId: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  localityNote?: string | null;
}): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(sensorZones)
    .values({
      zoneId: input.zoneId,
      name: input.name,
      centerLatitude: input.centerLatitude,
      centerLongitude: input.centerLongitude,
      radiusMeters: input.radiusMeters,
      localityNote: input.localityNote ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sensorZones.zoneId,
      set: {
        name: input.name,
        centerLatitude: input.centerLatitude,
        centerLongitude: input.centerLongitude,
        radiusMeters: input.radiusMeters,
        localityNote: input.localityNote ?? null,
        updatedAt: now,
      },
    });
}

export async function deleteZone(zoneId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(devices)
    .set({ zoneId: null })
    .where(eq(devices.zoneId, zoneId));
  await db.delete(sensorZones).where(eq(sensorZones.zoneId, zoneId));
}

// ----------------------------------------------------------------- readings

function toLatestReading(row: ReadingRow): LatestReadingView {
  return {
    deviceId: row.deviceId,
    rawSensorValue: row.rawSensorValue,
    calibratedWaterLevelCm: row.calibratedWaterLevelCm,
    waterFlowLpm: row.waterFlowLpm,
    floodStatus: row.floodStatus as LatestReadingView["floodStatus"],
    dataQuality: row.dataQuality as LatestReadingView["dataQuality"],
    receivedAt: row.receivedAt,
    deviceReportedAt: row.deviceReportedAt,
    batteryVoltage: row.batteryVoltage,
    loraRssi: row.loraRssi,
    loraSnr: row.loraSnr,
    packetSequence: row.packetSequence,
    firmwareVersion: row.firmwareVersion,
    simulated: row.simulated,
  };
}

export interface NewReadingInput {
  deviceId: string;
  gatewayId: string | null;
  rawSensorValue: number;
  calibratedWaterLevelCm: number | null;
  waterFlowLpm: number | null;
  floodStatus: string;
  dataQuality: string;
  latitude: number | null;
  longitude: number | null;
  batteryVoltage: number | null;
  loraRssi: number | null;
  loraSnr: number | null;
  packetSequence: number | null;
  firmwareVersion: string | null;
  simulated: boolean;
  deviceReportedAt: Date | null;
  dedupeKey: string;
  receivedAt?: Date;
}

/**
 * Insert a reading, refusing a retransmission of the same packet.
 * Returns false when the row was already present.
 */
export async function insertReading(row: NewReadingInput): Promise<boolean> {
  const db = await getDb();
  const { receivedAt, ...rest } = row;
  const inserted = await db
    .insert(sensorReadings)
    .values({
      ...rest,
      deviceId: rest.deviceId,
      ...(receivedAt ? { receivedAt } : {}),
    })
    .onConflictDoNothing()
    .returning({ readingId: sensorReadings.readingId });
  return inserted.length > 0;
}

/** Latest reading per device, in one round trip. */
export async function latestReadingsByDevice(): Promise<
  Map<string, LatestReadingView>
> {
  const db = await getDb();
  const latest = db
    .select({
      deviceId: sensorReadings.deviceId,
      maxAt: max(sensorReadings.receivedAt).as("max_at"),
    })
    .from(sensorReadings)
    .groupBy(sensorReadings.deviceId)
    .as("latest_readings");

  const rows = await db
    .select({ r: sensorReadings })
    .from(sensorReadings)
    .innerJoin(
      latest,
      and(
        eq(sensorReadings.deviceId, latest.deviceId),
        eq(sensorReadings.receivedAt, latest.maxAt),
      ),
    );

  const map = new Map<string, LatestReadingView>();
  for (const row of rows) {
    if (!map.has(row.r.deviceId)) map.set(row.r.deviceId, toLatestReading(row.r));
  }
  return map;
}

export interface ReadingPoint {
  receivedAt: Date;
  rawSensorValue: number;
  calibratedWaterLevelCm: number | null;
  waterFlowLpm: number | null;
  floodStatus: string;
  simulated: boolean;
  batteryVoltage: number | null;
  loraRssi: number | null;
}

export async function readingsForDevice(
  deviceId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<ReadingPoint[]> {
  const db = await getDb();
  const conditions = [eq(sensorReadings.deviceId, deviceId)];
  if (opts.since) conditions.push(gte(sensorReadings.receivedAt, opts.since));

  const rows = await db
    .select({
      receivedAt: sensorReadings.receivedAt,
      rawSensorValue: sensorReadings.rawSensorValue,
      calibratedWaterLevelCm: sensorReadings.calibratedWaterLevelCm,
      waterFlowLpm: sensorReadings.waterFlowLpm,
      floodStatus: sensorReadings.floodStatus,
      simulated: sensorReadings.simulated,
      batteryVoltage: sensorReadings.batteryVoltage,
      loraRssi: sensorReadings.loraRssi,
    })
    .from(sensorReadings)
    .where(and(...conditions))
    .orderBy(asc(sensorReadings.receivedAt))
    .limit(opts.limit ?? 5000);
  return rows;
}

/** Newest stored reading for one device — used for escalation comparisons. */
export async function latestReadingForDevice(
  deviceId: string,
): Promise<LatestReadingView | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sensorReadings)
    .where(eq(sensorReadings.deviceId, deviceId))
    .orderBy(desc(sensorReadings.receivedAt), desc(sensorReadings.readingId))
    .limit(1);
  return rows.length ? toLatestReading(rows[0]) : null;
}

export async function lastIngestAt(): Promise<Date | null> {
  const db = await getDb();
  const rows = await db
    .select({ at: max(sensorReadings.receivedAt) })
    .from(sensorReadings);
  return rows[0]?.at ?? null;
}

export async function readingCountForDevice(deviceId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(sensorReadings)
    .where(eq(sensorReadings.deviceId, deviceId));
  return Number(rows[0]?.c ?? 0);
}

// ------------------------------------------------------------------- alerts

export async function raiseAlert(input: {
  alertType: string;
  severity: string;
  deviceId?: string | null;
  zoneId?: string | null;
  gatewayId?: string | null;
  message: string;
  waterLevelCm?: number | null;
  dedupeKey?: string | null;
}): Promise<boolean> {
  const db = await getDb();
  const inserted = await db
    .insert(alerts)
    .values({
      alertType: input.alertType,
      severity: input.severity,
      deviceId: input.deviceId ?? null,
      zoneId: input.zoneId ?? null,
      gatewayId: input.gatewayId ?? null,
      message: input.message,
      waterLevelCm: input.waterLevelCm ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ alertId: alerts.alertId });
  return inserted.length > 0;
}

export interface AlertView extends AlertRow {
  deviceLabel: string | null;
  zoneName: string | null;
}

export async function listAlerts(opts: {
  includeAcknowledged?: boolean;
  limit?: number;
} = {}): Promise<AlertView[]> {
  const db = await getDb();
  const where = opts.includeAcknowledged
    ? undefined
    : isNull(alerts.acknowledgedAt);

  const rows = await db
    .select({
      alert: alerts,
      deviceLabel: devices.label,
      zoneName: sensorZones.name,
    })
    .from(alerts)
    .leftJoin(devices, eq(alerts.deviceId, devices.deviceId))
    .leftJoin(sensorZones, eq(alerts.zoneId, sensorZones.zoneId))
    .where(where)
    .orderBy(desc(alerts.createdAt))
    .limit(opts.limit ?? 100);

  return rows.map((r) => ({
    ...r.alert,
    deviceLabel: r.deviceLabel,
    zoneName: r.zoneName,
  }));
}

export async function acknowledgeAlert(
  alertId: number,
  adminId: number,
): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: adminId })
    .where(and(eq(alerts.alertId, alertId), isNull(alerts.acknowledgedAt)))
    .returning({ alertId: alerts.alertId });
  return updated.length > 0;
}

export async function unacknowledgeAlert(alertId: number): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(alerts)
    .set({ acknowledgedAt: null, acknowledgedBy: null })
    .where(eq(alerts.alertId, alertId))
    .returning({ alertId: alerts.alertId });
  return updated.length > 0;
}

/** Devices whose last packet is older than the given window. */
export async function devicesNotSeenSince(cutoff: Date): Promise<DeviceView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(devices)
    .where(
      or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, cutoff)),
    )
    .orderBy(asc(devices.deviceId));
  return rows.map(toDeviceView);
}

// ------------------------------------------------------------- credentials

export interface TokenPrincipal {
  kind: "device" | "gateway";
  id: string;
}

/**
 * Issue a credential for one principal. The caller keeps the plaintext token;
 * only its hash is stored, so it can never be read back out of the database.
 */
export async function createCredential(input: {
  deviceId?: string | null;
  gatewayId?: string | null;
  token: string;
  label: string;
}): Promise<void> {
  const db = await getDb();
  const deviceId = input.deviceId ?? null;
  const gatewayId = input.gatewayId ?? null;
  if ((deviceId === null) === (gatewayId === null)) {
    throw new Error("A credential needs exactly one principal: deviceId or gatewayId");
  }
  await db.insert(deviceCredentials).values({
    deviceId,
    gatewayId,
    tokenHash: hashToken(input.token),
    tokenPrefix: input.token.slice(0, 10),
    label: input.label,
  });
}

export async function listCredentials(filter?: {
  deviceId?: string;
  gatewayId?: string;
}) {
  const db = await getDb();
  const conditions = [];
  if (filter?.deviceId) conditions.push(eq(deviceCredentials.deviceId, filter.deviceId));
  if (filter?.gatewayId)
    conditions.push(eq(deviceCredentials.gatewayId, filter.gatewayId));

  const selection = db
    .select({
      credentialId: deviceCredentials.credentialId,
      deviceId: deviceCredentials.deviceId,
      gatewayId: deviceCredentials.gatewayId,
      tokenPrefix: deviceCredentials.tokenPrefix,
      label: deviceCredentials.label,
      createdAt: deviceCredentials.createdAt,
      lastUsedAt: deviceCredentials.lastUsedAt,
      revokedAt: deviceCredentials.revokedAt,
    })
    .from(deviceCredentials);

  const rows =
    conditions.length > 0
      ? await selection
          .where(and(...conditions))
          .orderBy(desc(deviceCredentials.createdAt))
      : await selection.orderBy(desc(deviceCredentials.createdAt));
  return rows;
}

/** Revoke one credential. The plaintext token stopped working at this moment. */
export async function revokeCredentialById(credentialId: number): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .update(deviceCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceCredentials.credentialId, credentialId),
        isNull(deviceCredentials.revokedAt),
      ),
    )
    .returning({ credentialId: deviceCredentials.credentialId });
  return updated.length > 0;
}

/** Resolve a bearer token to the sensor or gateway it was issued for. */
export async function authenticateToken(
  token: string,
): Promise<TokenPrincipal | null> {
  const db = await getDb();
  const rows = await db
    .select({
      credentialId: deviceCredentials.credentialId,
      deviceId: deviceCredentials.deviceId,
      gatewayId: deviceCredentials.gatewayId,
    })
    .from(deviceCredentials)
    .where(
      and(
        eq(deviceCredentials.tokenHash, hashToken(token)),
        isNull(deviceCredentials.revokedAt),
      ),
    )
    .limit(1);
  if (!rows.length) return null;

  const row = rows[0];
  await db
    .update(deviceCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(deviceCredentials.credentialId, row.credentialId));

  if (row.deviceId) return { kind: "device", id: row.deviceId };
  if (row.gatewayId) return { kind: "gateway", id: row.gatewayId };
  return null;
}

/** Resolve a bearer token to an active sensor id. Gateway tokens are rejected. */
export async function authenticateDeviceToken(
  token: string,
): Promise<string | null> {
  const principal = await authenticateToken(token);
  return principal?.kind === "device" ? principal.id : null;
}

/** Resolve a bearer token to an active gateway id. Sensor tokens are rejected. */
export async function authenticateGatewayToken(
  token: string,
): Promise<string | null> {
  const principal = await authenticateToken(token);
  return principal?.kind === "gateway" ? principal.id : null;
}

// ---------------------------------------------------------- admin accounts

export async function getAdminByEmail(email: string) {
  const db = await getDb();
  const found = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email.toLowerCase()))
    .limit(1);
  return found[0] ?? null;
}

export async function getAdminById(adminId: number) {
  const db = await getDb();
  const found = await db
    .select()
    .from(admins)
    .where(eq(admins.adminId, adminId))
    .limit(1);
  return found[0] ?? null;
}

export async function createAdmin(input: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(admins)
    .values({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
    })
    .onConflictDoNothing();
}

export async function countAdmins(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ c: sql<number>`count(*)::int` }).from(admins);
  return Number(rows[0]?.c ?? 0);
}

export async function touchAdminLogin(adminId: number): Promise<void> {
  const db = await getDb();
  await db
    .update(admins)
    .set({ lastLoginAt: new Date() })
    .where(eq(admins.adminId, adminId));
}

export async function createSession(input: {
  tokenHash: string;
  adminId: number;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  await db.insert(adminSessions).values({
    tokenHash: input.tokenHash,
    adminId: input.adminId,
    expiresAt: input.expiresAt,
  });
}

export async function getSession(
  tokenHash: string,
): Promise<{ adminId: number; expiresAt: Date } | null> {
  const db = await getDb();
  const rows = await db
    .select({ adminId: adminSessions.adminId, expiresAt: adminSessions.expiresAt })
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, tokenHash))
    .limit(1);
  if (!rows.length) return null;
  if (rows[0].expiresAt.getTime() < Date.now()) {
    await db
      .delete(adminSessions)
      .where(eq(adminSessions.tokenHash, tokenHash));
    return null;
  }
  return rows[0];
}

export async function destroySession(tokenHash: string): Promise<void> {
  const db = await getDb();
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
}

// ------------------------------------------------------------------- device ids helper

export async function devicesInIds(ids: string[]): Promise<DeviceView[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(devices)
    .where(inArray(devices.deviceId, ids));
  return rows.map(toDeviceView);
}

export { sensorReadings, devices, gateways, sensorZones, alerts };
