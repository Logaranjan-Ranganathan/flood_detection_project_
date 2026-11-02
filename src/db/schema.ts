import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Timezone-aware timestamp column with a server-side `now()` default.
 */
export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const timestamptzNow = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();

/**
 * Physical IoT gateways (ESP32-2 class devices) that forward LoRa packets to
 * the backend. Identified by a stable gateway_id, never by IP address.
 */
export const gateways = pgTable(
  "gateways",
  {
    gatewayId: text("gateway_id").primaryKey(),
    name: text("name").notNull(),
    firmwareVersion: text("firmware_version"),
    hardwareNote: text("hardware_note"),
    lastSeenAt: timestamptz("last_seen_at"),
    /** Latest IP the gateway reported about itself. Diagnostics only. */
    lastReportedIp: text("last_reported_ip"),
    /** ONLINE | OFFLINE | UNKNOWN — derived from lastSeenAt via settings. */
    networkStatus: text("network_status").notNull().default("UNKNOWN"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    gpsFix: boolean("gps_fix"),
    lastLoraRssi: integer("last_lora_rssi"),
    lastLoraSnr: doublePrecision("last_lora_snr"),
    batteryMv: integer("battery_mv"),
    packetsReceived: bigint("packets_received", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [index("gateways_last_seen_idx").on(t.lastSeenAt)],
);

/** 50-metre monitoring circles. Explicitly NOT administrative wards. */
export const sensorZones = pgTable("sensor_zones", {
  zoneId: text("zone_id").primaryKey(),
  name: text("name").notNull(),
  centerLatitude: doublePrecision("center_latitude").notNull(),
  centerLongitude: doublePrecision("center_longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(50),
  /** Free-text locality label for humans; never presented as an official ward. */
  localityNote: text("locality_note"),
  createdAt: timestamptzNow("created_at"),
  updatedAt: timestamptzNow("updated_at"),
});

/** Remote water-level sensors (ESP32-1 class nodes). */
export const devices = pgTable(
  "devices",
  {
    deviceId: text("device_id").primaryKey(),
    label: text("label").notNull(),
    gatewayId: text("gateway_id").references(() => gateways.gatewayId),
    zoneId: text("zone_id").references(() => sensorZones.zoneId),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** True only when a human or a GPS fix has confirmed the coordinates. */
    locationVerified: boolean("location_verified").notNull().default(false),
    /** GPS | MANUAL | UNVERIFIED */
    locationSource: text("location_source").notNull().default("UNVERIFIED"),

    // --- calibration (two-point linear raw -> centimetres) ---
    calibZeroRaw: integer("calib_zero_raw"),
    calibSpanRaw: integer("calib_span_raw"),
    calibReferenceCm: doublePrecision("calib_reference_cm"),
    calibrationVerified: boolean("calibration_verified").notNull().default(false),

    /** A water-level sensor alone cannot measure flow. Only set when a real
     *  flow sensor is fitted, otherwise flow stays unavailable. */
    flowSupported: boolean("flow_supported").notNull().default(false),

    /** Optional per-device override of {watchCm, warningCm, criticalCm}. */
    thresholdsOverride: jsonb("thresholds_override"),

    lastSeenAt: timestamptz("last_seen_at"),
    lastLoraRssi: integer("last_lora_rssi"),
    lastLoraSnr: doublePrecision("last_lora_snr"),
    lastBatteryVoltage: doublePrecision("last_battery_voltage"),
    firmwareVersion: text("firmware_version"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    index("devices_gateway_idx").on(t.gatewayId),
    index("devices_zone_idx").on(t.zoneId),
    index("devices_last_seen_idx").on(t.lastSeenAt),
  ],
);

/**
 * Every measurement ever received. Historical readings are never kept only in
 * memory — this table is the system of record.
 */
export const sensorReadings = pgTable(
  "sensor_readings",
  {
    readingId: bigint("reading_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.deviceId, { onDelete: "cascade" }),
    gatewayId: text("gateway_id").references(() => gateways.gatewayId),
    rawSensorValue: integer("raw_sensor_value").notNull(),
    calibratedWaterLevelCm: doublePrecision("calibrated_water_level_cm"),
    waterFlowLpm: doublePrecision("water_flow_lpm"),
    /** NORMAL | WATCH | WARNING | CRITICAL | CALIBRATION_REQUIRED */
    floodStatus: text("flood_status").notNull(),
    /** OK | UNCALIBRATED | LOCATION_UNAVAILABLE | FLOW_NOT_SUPPORTED | OUT_OF_RANGE | SUSPECT_JUMP */
    dataQuality: text("data_quality").notNull().default("OK"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    batteryVoltage: doublePrecision("battery_voltage"),
    loraRssi: integer("lora_rssi"),
    loraSnr: doublePrecision("lora_snr"),
    packetSequence: integer("packet_sequence"),
    firmwareVersion: text("firmware_version"),
    /** Demo/test rows are flagged and can never be shown as real flood data. */
    simulated: boolean("simulated").notNull().default(false),
    deviceReportedAt: timestamptz("device_reported_at"),
    receivedAt: timestamptzNow("received_at"),
    /** Retransmission guard: device + sequence + coarse timestamp bucket. */
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("readings_dedupe_idx").on(t.dedupeKey),
    index("readings_device_time_idx").on(t.deviceId, t.receivedAt),
    index("readings_time_idx").on(t.receivedAt),
  ],
);

/**
 * Alerts raised by the server: threshold crossings, offline sensors, stale
 * data and gateways that stopped reporting.
 */
export const alerts = pgTable(
  "alerts",
  {
    alertId: bigint("alert_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** WARNING | CRITICAL | SENSOR_OFFLINE | DATA_STALE | GATEWAY_OFFLINE | CALIBRATION_REQUIRED */
    alertType: text("alert_type").notNull(),
    /** INFO | WARNING | CRITICAL */
    severity: text("severity").notNull(),
    deviceId: text("device_id").references(() => devices.deviceId, { onDelete: "set null" }),
    zoneId: text("zone_id").references(() => sensorZones.zoneId, { onDelete: "set null" }),
    gatewayId: text("gateway_id").references(() => gateways.gatewayId, { onDelete: "set null" }),
    message: text("message").notNull(),
    waterLevelCm: doublePrecision("water_level_cm"),
    /** Dedupe guard so a persistently-offline sensor does not spam alerts. */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamptzNow("created_at"),
    acknowledgedAt: timestamptz("acknowledged_at"),
    acknowledgedBy: integer("acknowledged_by"),
  },
  (t) => [
    uniqueIndex("alerts_dedupe_idx").on(t.dedupeKey),
    index("alerts_created_idx").on(t.createdAt),
    index("alerts_ack_idx").on(t.acknowledgedAt),
  ],
);

export const admins = pgTable(
  "admins",
  {
    adminId: serial("admin_id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt hash, `salt:hash` hex form. Plaintext is never stored. */
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamptzNow("created_at"),
    lastLoginAt: timestamptz("last_login_at"),
  },
  (t) => [uniqueIndex("admins_email_idx").on(t.email)],
);

export const adminSessions = pgTable("admin_sessions", {
  /** SHA-256 of the opaque session token; the token itself is never stored. */
  tokenHash: text("token_hash").primaryKey(),
  adminId: integer("admin_id")
    .notNull()
    .references(() => admins.adminId, { onDelete: "cascade" }),
  createdAt: timestamptzNow("created_at"),
  expiresAt: timestamptz("expires_at").notNull(),
});

/**
 * Ingestion credentials for sensors and gateways. Only the SHA-256 hash is
 * stored, and the plaintext token is shown exactly once at registration.
 * A gateway such as ESP32-2 authenticates with its gateway id, so an IP address
 * is never an identity and a sensor token cannot rewrite gateway diagnostics.
 */
export const deviceCredentials = pgTable(
  "device_credentials",
  {
    credentialId: serial("credential_id").primaryKey(),
    deviceId: text("device_id").references(() => devices.deviceId, {
      onDelete: "cascade",
    }),
    gatewayId: text("gateway_id").references(() => gateways.gatewayId, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    /** First characters, so admins can tell tokens apart without exposing them. */
    tokenPrefix: text("token_prefix").notNull(),
    label: text("label").notNull(),
    createdAt: timestamptzNow("created_at"),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [
    uniqueIndex("device_credentials_token_idx").on(t.tokenHash),
    index("device_credentials_device_idx").on(t.deviceId),
    index("device_credentials_gateway_idx").on(t.gatewayId),
    check(
      "device_credentials_principal_chk",
      sql`(device_id is not null) <> (gateway_id is not null)`,
    ),
  ],
);

/** Admin-configurable global settings: thresholds, stale/offline windows. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamptzNow("updated_at"),
});

export type GatewayRow = typeof gateways.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type ZoneRow = typeof sensorZones.$inferSelect;
export type ReadingRow = typeof sensorReadings.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
