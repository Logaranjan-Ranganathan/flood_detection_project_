import { describe, expect, it } from "vitest";
import {
  calibrationSchema,
  credentialCreateSchema,
  gatewayStatusPayloadSchema,
  healthWindowSchema,
  readingPayloadSchema,
  thresholdsSchema,
  zoneUpsertSchema,
} from "@/lib/schemas";

const VALID = {
  device_id: "FG-SENSOR-001",
  gateway_id: "FG-GATEWAY-002",
  raw_sensor_value: 812,
  calibrated_water_level_cm: null,
  water_flow_lpm: null,
  flood_status: "CALIBRATION_REQUIRED",
  latitude: null,
  longitude: null,
  battery_voltage: 3.8,
  lora_rssi: -92,
  lora_snr: 8.5,
  packet_sequence: 1,
  firmware_version: "1.0.0",
  simulated: false,
};

describe("ingestion payload validation", () => {
  it("accepts the documented example schema", () => {
    const parsed = readingPayloadSchema.safeParse({
      ...VALID,
      battery_voltage: null,
      lora_rssi: null,
      lora_snr: null,
      firmware_version: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults a missing simulated flag to false", () => {
    const { simulated: _omit, ...rest } = VALID;
    const parsed = readingPayloadSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.simulated).toBe(false);
  });

  it.each([
    ["empty body", {}],
    ["missing device_id", { ...VALID, device_id: undefined }],
    ["missing raw value", { ...VALID, raw_sensor_value: undefined }],
    ["non-numeric raw value", { ...VALID, raw_sensor_value: "eight hundred" }],
    ["fractional raw value", { ...VALID, raw_sensor_value: 812.5 }],
    ["latitude off the planet", { ...VALID, latitude: 91.5 }],
    ["longitude out of range", { ...VALID, longitude: -181 }],
    ["negative RSSI beyond the floor", { ...VALID, lora_rssi: -250 }],
    ["positive RSSI (physically impossible)", { ...VALID, lora_rssi: 5 }],
    ["absurd water level", { ...VALID, calibrated_water_level_cm: 999_999 }],
    ["negative flow", { ...VALID, water_flow_lpm: -1 }],
    ["unknown flood status", { ...VALID, flood_status: "TSUNAMI" }],
    ["identifier with a space", { ...VALID, device_id: "FG SENSOR 1" }],
    ["identifier with a path", { ...VALID, device_id: "../etc/passwd" }],
    ["SQL-ish identifier", { ...VALID, gateway_id: "'; DROP TABLE--" }],
  ])("rejects %s", (_label, body) => {
    expect(readingPayloadSchema.safeParse(body).success).toBe(false);
  });

  it("rejects unknown keys so firmware drift is caught early", () => {
    const parsed = readingPayloadSchema.safeParse({ ...VALID, water_level: 12 });
    expect(parsed.success).toBe(false);
  });

  it("rejects a JSON array body", () => {
    expect(readingPayloadSchema.safeParse([]).success).toBe(false);
  });
});

describe("gateway status validation", () => {
  it("accepts a heartbeat without an IP address", () => {
    const parsed = gatewayStatusPayloadSchema.safeParse({
      gateway_id: "FG-GATEWAY-002",
      firmware_version: "1.0.0",
      ip_address: null,
      latitude: 6.9271,
      longitude: 79.8612,
      gps_fix: true,
      lora_rssi: -88,
      lora_snr: 9,
      battery_mv: 4100,
      packets_received: 12,
      network_status: "ONLINE",
      simulated: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a header-like value as an IP address", () => {
    const parsed = gatewayStatusPayloadSchema.safeParse({
      gateway_id: "FG-GATEWAY-002",
      ip_address: "evil\r\nX-Admin: true",
      simulated: false,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("configuration validation", () => {
  it("requires ordered thresholds", () => {
    expect(
      thresholdsSchema.safeParse({ watchCm: 15, warningCm: 30, criticalCm: 50 }).success,
    ).toBe(true);
    expect(
      thresholdsSchema.safeParse({ watchCm: 60, warningCm: 30, criticalCm: 50 }).success,
    ).toBe(false);
    expect(thresholdsSchema.safeParse({ watchCm: -5, warningCm: 30, criticalCm: 50 }).success).toBe(
      false,
    );
  });

  it("requires stale before offline", () => {
    expect(
      healthWindowSchema.safeParse({ staleAfterMinutes: 30, offlineAfterMinutes: 120 }).success,
    ).toBe(true);
    expect(
      healthWindowSchema.safeParse({ staleAfterMinutes: 200, offlineAfterMinutes: 120 }).success,
    ).toBe(false);
  });

  it("refuses a verified calibration with a zero span", () => {
    expect(
      calibrationSchema.safeParse({
        zeroRaw: 500,
        spanRaw: 500,
        referenceCm: 40,
        verified: true,
      }).success,
    ).toBe(false);
    expect(
      calibrationSchema.safeParse({
        zeroRaw: null,
        spanRaw: null,
        referenceCm: null,
        verified: false,
      }).success,
    ).toBe(true);
  });

  it("issues a credential for exactly one principal", () => {
    expect(
      credentialCreateSchema.safeParse({ device_id: "FG-SENSOR-001" }).success,
    ).toBe(true);
    expect(
      credentialCreateSchema.safeParse({ gateway_id: "FG-GATEWAY-002" }).success,
    ).toBe(true);
    expect(credentialCreateSchema.safeParse({ label: "no principal" }).success).toBe(false);
    expect(
      credentialCreateSchema
        .safeParse({ device_id: "FG-SENSOR-001", gateway_id: "FG-GATEWAY-002" })
        .success,
    ).toBe(false);
  });

  it("clamps zone radius to a sane range", () => {
    const base = {
      zone_id: "FG-ZONE-009",
      name: "Test",
      center_latitude: 6.9,
      center_longitude: 79.86,
    };
    expect(zoneUpsertSchema.safeParse({ ...base, radius_meters: 50 }).success).toBe(true);
    expect(zoneUpsertSchema.safeParse({ ...base, radius_meters: 5 }).success).toBe(false);
    expect(
      zoneUpsertSchema.safeParse({ ...base, radius_meters: 50, center_latitude: 120 }).success,
    ).toBe(false);
  });
});
