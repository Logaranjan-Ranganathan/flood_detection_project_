import { z } from "zod";

/**
 * Payload contract shared by firmware, backend, database and website.
 * Keep in sync with `firmware/` and `docs/api.md`.
 */

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export const deviceIdSchema = z.string().regex(idPattern, {
  message: "device_id must be 3-64 chars of letters, digits, dot, dash or underscore",
});

export const gatewayIdSchema = z.string().regex(idPattern, {
  message: "gateway_id must be 3-64 chars of letters, digits, dot, dash or underscore",
});

/**
 * A LoRa packet cannot carry every field, so optional telemetry may be omitted
 * entirely. Absent is normalised to null instead of being rejected.
 */
const nullableNumber = (min: number, max: number) =>
  z
    .number()
    .finite()
    .nullable()
    .refine((v) => v === null || (v >= min && v <= max), {
      message: `Value must be between ${min} and ${max} or null`,
    })
    .default(null);

const nullableInt = (min: number, max: number) =>
  z
    .number()
    .int()
    .nullable()
    .refine((v) => v === null || (v >= min && v <= max), {
      message: `Value must be an integer between ${min} and ${max} or null`,
    })
    .default(null);

const nullableText = (max: number) => z.string().max(max).nullable().default(null);

export const levelStatusSchema = z.enum([
  "NORMAL",
  "WATCH",
  "WARNING",
  "CRITICAL",
  "CALIBRATION_REQUIRED",
]);

export const readingPayloadSchema = z
  .object({
    device_id: deviceIdSchema,
    gateway_id: gatewayIdSchema,
    raw_sensor_value: z.number().int().min(-1_000_000).max(1_000_000),
    calibrated_water_level_cm: nullableNumber(-5, 10_000),
    water_flow_lpm: nullableNumber(0, 1_000_000),
    flood_status: levelStatusSchema.nullable().default(null),
    latitude: nullableNumber(-90, 90),
    longitude: nullableNumber(-180, 180),
    battery_voltage: nullableNumber(0, 100),
    lora_rssi: nullableInt(-200, 0),
    lora_snr: nullableNumber(-50, 50),
    packet_sequence: nullableInt(0, 2_147_483_647),
    firmware_version: nullableText(32),
    /** Device clock epoch ms. Optional: many nodes have no GPS/RTC fix. */
    device_timestamp_ms: nullableInt(0, Number.MAX_SAFE_INTEGER),
    simulated: z.boolean().default(false),
  })
  .strict();

export type ReadingPayload = z.infer<typeof readingPayloadSchema>;

/** Diagnostic heartbeat from a gateway such as ESP32-2. */
export const gatewayStatusPayloadSchema = z
  .object({
    gateway_id: gatewayIdSchema,
    firmware_version: nullableText(32),
    /** Reported by the device; diagnostic only and never used as identity. */
    ip_address: z
      .string()
      .max(64)
      .regex(/^[0-9a-fA-F:.]{1,64}$/)
      .nullable()
      .default(null),
    latitude: nullableNumber(-90, 90),
    longitude: nullableNumber(-180, 180),
    gps_fix: z.boolean().nullable().default(null),
    lora_rssi: nullableInt(-200, 0),
    lora_snr: nullableNumber(-50, 50),
    battery_mv: nullableInt(0, 100_000),
    packets_received: nullableInt(0, 2_147_483_647),
    network_status: z
      .enum(["ONLINE", "OFFLINE", "NO_LINK", "UNKNOWN"])
      .nullable()
      .default(null),
    device_timestamp_ms: nullableInt(0, Number.MAX_SAFE_INTEGER),
    simulated: z.boolean().default(false),
  })
  .strict();

export type GatewayStatusPayload = z.infer<typeof gatewayStatusPayloadSchema>;

export const thresholdsSchema = z
  .object({
    watchCm: z.number().finite().min(0).max(10_000),
    warningCm: z.number().finite().min(0).max(10_000),
    criticalCm: z.number().finite().min(0).max(10_000),
  })
  .refine((t) => t.watchCm <= t.warningCm && t.warningCm <= t.criticalCm, {
    message: "Thresholds must satisfy watchCm <= warningCm <= criticalCm",
    path: ["criticalCm"],
  });

export const healthWindowSchema = z
  .object({
    staleAfterMinutes: z.number().int().min(1).max(10_080),
    offlineAfterMinutes: z.number().int().min(1).max(43_200),
  })
  .refine((h) => h.staleAfterMinutes <= h.offlineAfterMinutes, {
    message: "staleAfterMinutes must be <= offlineAfterMinutes",
    path: ["offlineAfterMinutes"],
  });

export const calibrationSchema = z
  .object({
    zeroRaw: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .nullable()
      .default(null),
    spanRaw: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .nullable()
      .default(null),
    referenceCm: z.number().finite().min(0).max(10_000).nullable().default(null),
    verified: z.boolean(),
  })
  .refine(
    (c) =>
      !c.verified ||
      (c.zeroRaw !== null &&
        c.spanRaw !== null &&
        c.referenceCm !== null &&
        c.spanRaw !== c.zeroRaw &&
        c.referenceCm > 0),
    {
      message:
        "Verified calibration needs zeroRaw, spanRaw (different from zeroRaw) and a positive referenceCm",
    },
  );

export const deviceUpsertSchema = z.object({
  device_id: deviceIdSchema,
  label: z.string().min(1).max(120),
  gateway_id: gatewayIdSchema.nullable().default(null),
  zone_id: z.string().max(64).nullable().default(null),
  latitude: nullableNumber(-90, 90),
  longitude: nullableNumber(-180, 180),
  location_verified: z.boolean().default(false),
  location_source: z.enum(["GPS", "MANUAL", "UNVERIFIED"]).default("UNVERIFIED"),
  flow_supported: z.boolean().default(false),
  firmware_version: nullableText(32),
});

export const gatewayUpsertSchema = z.object({
  gateway_id: gatewayIdSchema,
  name: z.string().min(1).max(120),
  firmware_version: nullableText(32),
  hardware_note: nullableText(240),
});

export const zoneUpsertSchema = z.object({
  zone_id: z.string().regex(idPattern),
  name: z.string().min(1).max(120),
  center_latitude: z.number().finite().min(-90).max(90),
  center_longitude: z.number().finite().min(-180).max(180),
  radius_meters: z.number().int().min(10).max(5_000).default(50),
  locality_note: nullableText(240),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

/**
 * Admin edit of a sensor. An omitted key means "leave unchanged"; an explicit
 * null clears the field, so these must stay `.nullish()` rather than defaulted.
 */
export const devicePatchSchema = z
  .object({
    label: z.string().min(1).max(120),
    gateway_id: gatewayIdSchema.nullable(),
    zone_id: z.string().max(64).nullable(),
    location: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        verified: z.boolean(),
        source: z.enum(["GPS", "MANUAL", "UNVERIFIED"]),
      })
      .nullable(),
    calibration: calibrationSchema.nullable(),
    thresholds_override: thresholdsSchema.nullable(),
    flow_supported: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

/**
 * Issue a token for one principal. A sensor token may only post sensor readings
 * and a gateway token may only post gateway diagnostics, so exactly one of
 * `device_id` / `gateway_id` has to be given.
 */
export const credentialCreateSchema = z
  .object({
    device_id: deviceIdSchema.optional(),
    gateway_id: gatewayIdSchema.optional(),
    label: z.string().min(1).max(120).default("primary"),
    /** When present with device_id, the device is registered first. */
    create_device: z
      .object({
        label: z.string().min(1).max(120),
        gateway_id: gatewayIdSchema.nullish(),
        zone_id: z.string().max(64).nullish(),
      })
      .optional(),
  })
  .strict()
  .refine((c) => (c.device_id == null) !== (c.gateway_id == null), {
    message: "Provide exactly one of device_id or gateway_id",
    path: ["device_id"],
  });

