import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { disposeTempDb, useTempDb } from "./helpers";
import {
  acknowledgeAlert,
  authenticateDeviceToken,
  authenticateGatewayToken,
  createAdmin,
  createCredential,
  createSession,
  getAdminByEmail,
  getGateway,
  getSession,
  getThresholds,
  latestReadingsByDevice,
  listAlerts,
  listCredentials,
  revokeCredentialById,
  setDeviceCalibration,
  setHealthWindow,
  setThresholds,
  upsertDevice,
  upsertGateway,
  upsertZone,
  destroySession,
} from "@/db/repo";
import {
  ingestGatewayStatus,
  ingestReading,
  sweepHealth,
} from "@/lib/services/ingestion";
import {
  calibrateRawToCm,
  classifyLevel,
} from "@/lib/calibration";
import { generateToken, hashPassword, hashToken, verifyPassword } from "@/lib/auth";
import { getOverview } from "@/lib/services/overview";
import type { ReadingPayload } from "@/lib/schemas";

let dir: string;
const GATEWAY = "FG-GATEWAY-002";

const gatewayHeartbeat = () => ({
  gateway_id: GATEWAY,
  firmware_version: "1.0.0",
  ip_address: "10.10.4.21",
  latitude: 6.9271,
  longitude: 79.8612,
  gps_fix: true,
  lora_rssi: -88,
  lora_snr: 9,
  battery_mv: 4100,
  packets_received: 25,
  network_status: "ONLINE" as const,
  device_timestamp_ms: null,
  simulated: true,
});

const payload = (over: Partial<ReadingPayload> = {}): ReadingPayload => ({
  device_id: "FG-SENSOR-001",
  gateway_id: GATEWAY,
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
  device_timestamp_ms: Date.now(),
  simulated: true,
  ...over,
});

beforeAll(async () => {
  dir = await useTempDb();

  await upsertGateway({ gatewayId: GATEWAY, name: "ESP32-2 gateway" });
  await upsertZone({
    zoneId: "FG-ZONE-001",
    name: "Canal bridge",
    centerLatitude: 6.9271,
    centerLongitude: 79.8612,
    radiusMeters: 50,
  });
  // Deliberately different from the gateway position: a remote sensor must not
  // silently inherit the gateway's GPS coordinates.
  await upsertZone({
    zoneId: "FG-ZONE-002",
    name: "Far outfall",
    centerLatitude: 7.3,
    centerLongitude: 80.4,
    radiusMeters: 50,
  });
  await upsertDevice({
    deviceId: "FG-SENSOR-001",
    label: "Canal bridge — upstream",
    gatewayId: GATEWAY,
    zoneId: "FG-ZONE-001",
    latitude: 6.9273,
    longitude: 79.8615,
    locationVerified: true,
    locationSource: "MANUAL",
  });
  await upsertDevice({
    deviceId: "FG-SENSOR-002",
    label: "Flow instrumented node",
    gatewayId: GATEWAY,
    zoneId: "FG-ZONE-001",
    latitude: 6.9270,
    longitude: 79.8610,
    locationVerified: true,
    locationSource: "MANUAL",
    flowSupported: true,
  });

  const token = generateToken("fgdev");
  process.env.TEST_DEVICE_TOKEN = token;
  await createCredential({ deviceId: "FG-SENSOR-001", token, label: "test" });
  await createCredential({
    deviceId: "FG-SENSOR-002",
    token: generateToken("fgdev"),
    label: "test",
  });
});

afterAll(async () => {
  await disposeTempDb(dir);
});

describe("device authentication", () => {
  it("accepts a valid bearer token", async () => {
    const deviceId = await authenticateDeviceToken(process.env.TEST_DEVICE_TOKEN!);
    expect(deviceId).toBe("FG-SENSOR-001");
  });

  it("rejects an unknown token", async () => {
    expect(await authenticateDeviceToken("fgdev_not_a_real_token")).toBeNull();
  });

  it("rejects a revoked token", async () => {
    const token = generateToken("fgdev");
    await createCredential({ deviceId: "FG-SENSOR-001", token, label: "temp" });
    expect(await authenticateDeviceToken(token)).toBe("FG-SENSOR-001");

    const rows = await listCredentials({ deviceId: "FG-SENSOR-001" });
    const temp = rows.find((row) => row.label === "temp");
    if (!temp) throw new Error("temp credential missing");
    expect(await revokeCredentialById(temp.credentialId)).toBe(true);

    expect(await authenticateDeviceToken(token)).toBeNull();
    // Revoking one credential must not lock out the device's other token.
    expect(await authenticateDeviceToken(process.env.TEST_DEVICE_TOKEN!)).toBe("FG-SENSOR-001");
  });

  it("never stores the plaintext token", async () => {
    const rows = await listCredentials({ deviceId: "FG-SENSOR-001" });
    const plaintext = process.env.TEST_DEVICE_TOKEN!;
    expect(rows.every((r) => !r.tokenPrefix.includes(plaintext.slice(6)))).toBe(true);
    expect(rows[0].tokenPrefix.length).toBeLessThanOrEqual(10);
  });

  it("refuses a reading whose device_id does not match its credential", async () => {
    const result = await ingestReading(payload({ device_id: "FG-SENSOR-002" }), {
      authenticatedDeviceId: "FG-SENSOR-001",
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("device_mismatch");
  });

  it("refuses an unregistered device", async () => {
    const result = await ingestReading(payload({ device_id: "FG-SENSOR-777" }), {
      authenticatedDeviceId: "FG-SENSOR-777",
    });
    expect(result.status === "rejected" && result.code).toBe("unknown_device");
  });
});

describe("gateway credentials", () => {
  const gatewayToken = generateToken("fggw");

  beforeAll(async () => {
    await createCredential({ gatewayId: GATEWAY, token: gatewayToken, label: "test" });
  });

  it("resolves a gateway token to the gateway and never to a sensor", async () => {
    expect(await authenticateGatewayToken(gatewayToken)).toBe(GATEWAY);
    expect(await authenticateDeviceToken(gatewayToken)).toBeNull();
  });

  it("rejects a heartbeat naming a different gateway", async () => {
    const result = await ingestGatewayStatus(
      { ...gatewayHeartbeat(), gateway_id: "FG-GATEWAY-009" },
      { authenticatedGatewayId: GATEWAY },
    );
    expect(result.status === "rejected" && result.code).toBe("gateway_mismatch");
  });

  it("stores diagnostics and only trusts GPS when the module reports a fix", async () => {
    const at = new Date("2026-11-02T11:00:00Z");
    const accepted = await ingestGatewayStatus(gatewayHeartbeat(), {
      authenticatedGatewayId: GATEWAY,
      receivedAt: at,
    });
    expect(accepted.status).toBe("accepted");

    const row = await getGateway(GATEWAY);
    expect(row?.lastReportedIp).toBe("10.10.4.21");
    expect(row?.latitude).toBe(6.9271);
    expect(row?.gpsFix).toBe(true);

    // No fix: the last known position must not be overwritten with a drift value.
    await ingestGatewayStatus(
      { ...gatewayHeartbeat(), gps_fix: false, latitude: 0, longitude: 0, ip_address: null },
      { authenticatedGatewayId: GATEWAY, receivedAt: new Date(at.getTime() + 60_000) },
    );
    const after = await getGateway(GATEWAY);
    expect(after?.latitude).toBe(6.9271);
    expect(after?.lastReportedIp).toBeNull();
  });

  it("refuses a heartbeat for a gateway that is not registered", async () => {
    const result = await ingestGatewayStatus(
      { ...gatewayHeartbeat(), gateway_id: "FG-GATEWAY-008" },
      { authenticatedGatewayId: "FG-GATEWAY-008" },
    );
    expect(result.status === "rejected" && result.code).toBe("unknown_gateway");
  });
});

describe("duplicate packet handling", () => {
  it("stores a packet once and flags the retransmission", async () => {
    const at = new Date("2026-11-02T10:00:00Z");
    const body = payload({ packet_sequence: 5001, device_timestamp_ms: at.getTime() });
    const first = await ingestReading(body, {
      authenticatedDeviceId: "FG-SENSOR-001",
      receivedAt: at,
    });
    expect(first.status).toBe("accepted");

    const resent = await ingestReading(body, {
      authenticatedDeviceId: "FG-SENSOR-001",
      receivedAt: new Date(at.getTime() + 4000),
    });
    expect(resent.status).toBe("duplicate");
  });

  it("accepts the next sequence number", async () => {
    const at = new Date("2026-11-02T10:05:00Z");
    const result = await ingestReading(
      payload({ packet_sequence: 5002, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    expect(result.status).toBe("accepted");
  });
});

describe("sensor classification and calibration", () => {
  it("labels an uncalibrated device as needing calibration", async () => {
    const at = new Date("2026-11-02T10:10:00Z");
    const result = await ingestReading(
      payload({ raw_sensor_value: 999, packet_sequence: 5003, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;
    expect(result.floodStatus).toBe("CALIBRATION_REQUIRED");
    expect(result.calibratedWaterLevelCm).toBeNull();
    expect(result.dataQuality).toBe("UNCALIBRATED");
  });

  it("reclassifies the same raw value once calibration is on file", async () => {
    await setDeviceCalibration("FG-SENSOR-001", {
      zeroRaw: 200,
      spanRaw: 1000,
      referenceCm: 40,
      verified: true,
    });
    const at = new Date("2026-11-02T10:15:00Z");
    const result = await ingestReading(
      payload({ raw_sensor_value: 812, packet_sequence: 5004, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.calibratedWaterLevelCm).toBeCloseTo(30.6, 1);
    expect(result.floodStatus).toBe("WARNING");
  });

  it("records a WARNING alert when a device escalates", async () => {
    const raised = await listAlerts({ limit: 50 });
    expect(raised.some((a) => a.alertType === "WARNING" && a.deviceId === "FG-SENSOR-001")).toBe(
      true,
    );
  });

  it("does not spam a duplicate alert inside the same hour", async () => {
    const before = (await listAlerts({ limit: 100 })).length;
    const at = new Date("2026-11-02T10:16:00Z");
    await ingestReading(
      payload({ raw_sensor_value: 900, packet_sequence: 5005, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    const after = (await listAlerts({ limit: 100 })).length;
    expect(after).toBe(before);
  });

  it("honours admin-configured thresholds", async () => {
    await setThresholds({ watchCm: 5, warningCm: 35, criticalCm: 60 });
    const at = new Date("2026-11-02T10:20:00Z");
    const result = await ingestReading(
      payload({ raw_sensor_value: 812, packet_sequence: 5006, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    if (result.status !== "accepted") throw new Error("expected accepted");
    // 30.6 cm is now WATCH, not WARNING.
    expect(result.floodStatus).toBe("WATCH");
    expect(await getThresholds()).toEqual({ watchCm: 5, warningCm: 35, criticalCm: 60 });
    await setThresholds({ watchCm: 15, warningCm: 30, criticalCm: 50 });
  });
});

describe("flow data", () => {
  it("discards flow reported by a node without a flow sensor", async () => {
    const at = new Date("2026-11-02T10:25:00Z");
    const result = await ingestReading(
      payload({ water_flow_lpm: 42, packet_sequence: 5007, device_timestamp_ms: at.getTime() }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.waterFlowLpm).toBeNull();
  });

  it("stores flow for a node that really has a flow sensor", async () => {
    const at = new Date("2026-11-02T10:26:00Z");
    await setDeviceCalibration("FG-SENSOR-002", {
      zeroRaw: 200,
      spanRaw: 1000,
      referenceCm: 40,
      verified: true,
    });
    const result = await ingestReading(
      payload({
        device_id: "FG-SENSOR-002",
        water_flow_lpm: 42,
        packet_sequence: 6001,
        device_timestamp_ms: at.getTime(),
      }),
      { authenticatedDeviceId: "FG-SENSOR-002", receivedAt: at },
    );
    if (result.status !== "accepted") throw new Error(JSON.stringify(result));
    expect(result.waterFlowLpm).toBe(42);
  });
});

describe("location integrity", () => {
  it("uses the sensor's own verified coordinates, never the gateway's", async () => {
    const at = new Date("2026-11-02T10:30:00Z");
    await ingestReading(
      payload({
        packet_sequence: 5008,
        device_timestamp_ms: at.getTime(),
        latitude: 7.3,
        longitude: 80.4,
      }),
      { authenticatedDeviceId: "FG-SENSOR-001", receivedAt: at },
    );
    const latest = await latestReadingsByDevice();
    const snapshot = await getOverview(at);
    const device = snapshot.devices.find((d) => d.deviceId === "FG-SENSOR-001");
    expect(device?.latitude).toBe(6.9273);
    expect(device?.zoneIds).toContain("FG-ZONE-001");
    expect(device?.zoneIds).not.toContain("FG-ZONE-002");
    expect(latest.size).toBeGreaterThan(0);
  });

  it("marks a sensor with no verified position as location unavailable", async () => {
    await upsertDevice({
      deviceId: "FG-SENSOR-003",
      label: "Unplaced",
      gatewayId: GATEWAY,
      locationVerified: false,
    });
    await createCredential({
      deviceId: "FG-SENSOR-003",
      token: generateToken("fgdev"),
      label: "test",
    });
    const snapshot = await getOverview();
    const device = snapshot.devices.find((d) => d.deviceId === "FG-SENSOR-003");
    expect(device?.hasLocation).toBe(false);
    expect(device?.notices).toContain("Location unavailable");
  });
});

describe("stale and offline detection", () => {
  it("raises one stale alert then one offline alert per device", async () => {
    await setHealthWindow({ staleAfterMinutes: 30, offlineAfterMinutes: 120 });

    const future = new Date(Date.now() + 61 * 60_000);
    const sweep = await sweepHealth(future);
    expect(sweep.offlineDevices).toContain("FG-SENSOR-001");
    expect(sweep.offlineGateways).toContain(GATEWAY);

    const offlineAlerts = (await listAlerts({ limit: 200 })).filter(
      (a) => a.alertType === "SENSOR_OFFLINE" && a.deviceId === "FG-SENSOR-001",
    );
    expect(offlineAlerts.length).toBe(1);

    // Sweeping again while the device stays silent must not duplicate the alert.
    await sweepHealth(new Date(future.getTime() + 60_000));
    const again = (await listAlerts({ limit: 200 })).filter(
      (a) => a.alertType === "SENSOR_OFFLINE" && a.deviceId === "FG-SENSOR-001",
    );
    expect(again.length).toBe(1);
  });
});

describe("administrator accounts", () => {
  it("stores only a password hash and verifies the right password", async () => {
    await createAdmin({
      email: "Admin@Example.org",
      name: "Test admin",
      passwordHash: hashPassword("correct horse battery staple"),
    });
    const admin = await getAdminByEmail("admin@example.org");
    expect(admin).not.toBeNull();
    expect(admin?.passwordHash).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", admin!.passwordHash)).toBe(true);
    expect(verifyPassword("wrong password", admin!.passwordHash)).toBe(false);
  });

  it("resolves a session by token hash and expires it", async () => {
    const admin = await getAdminByEmail("admin@example.org");
    const token = generateToken("fgadmin");
    await createSession({
      tokenHash: hashToken(token),
      adminId: admin!.adminId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const session = await getSession(hashToken(token));
    expect(session?.adminId).toBe(admin!.adminId);

    const expired = generateToken("fgadmin");
    await createSession({
      tokenHash: hashToken(expired),
      adminId: admin!.adminId,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await getSession(hashToken(expired))).toBeNull();

    await destroySession(hashToken(token));
    expect(await getSession(hashToken(token))).toBeNull();
  });

  it("acknowledges an alert exactly once", async () => {
    const open = await listAlerts({ limit: 5 });
    expect(open.length).toBeGreaterThan(0);
    const target = open[0];
    const first = await acknowledgeAlert(target.alertId, 1);
    expect(first).toBe(true);
    const second = await acknowledgeAlert(target.alertId, 1);
    expect(second).toBe(false);
  });
});

describe("pure reclassification of stored rows", () => {
  it("applies new thresholds to the same stored raw count", async () => {
    const raw = 812;
    const cm = calibrateRawToCm(raw, {
      zeroRaw: 200,
      spanRaw: 1000,
      referenceCm: 40,
      verified: true,
    });
    expect(classifyLevel(cm, { watchCm: 15, warningCm: 30, criticalCm: 50 })).toBe("WARNING");
    expect(classifyLevel(cm, { watchCm: 40, warningCm: 60, criticalCm: 80 })).toBe("NORMAL");
  });
});
