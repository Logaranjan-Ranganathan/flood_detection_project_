import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fg-smoke-"));
process.env.PGLITE_DATA_DIR = dir;
process.env.DB_DRIVER = "pglite";

async function main() {
  const { getDb, closeDb } = await import("../src/db/client");
  const repo = await import("../src/db/repo");
  const { ingestReading, sweepHealth } = await import(
    "../src/lib/services/ingestion"
  );
  const { generateToken, hashPassword } = await import("../src/lib/auth");

  await getDb();

  await repo.upsertGateway({
    gatewayId: "FG-GATEWAY-002",
    name: "ESP32-2 gateway",
    hardwareNote: "SIM800L + NEO-6M",
  });
  await repo.upsertZone({
    zoneId: "FG-ZONE-001",
    name: "Canal bridge",
    centerLatitude: 6.9271,
    centerLongitude: 79.8612,
    radiusMeters: 50,
  });
  await repo.upsertDevice({
    deviceId: "FG-SENSOR-001",
    label: "Canal bridge sensor",
    gatewayId: "FG-GATEWAY-002",
    zoneId: "FG-ZONE-001",
    latitude: 6.9271,
    longitude: 79.8612,
    locationVerified: true,
    locationSource: "MANUAL",
  });

  const token = generateToken("fgdev");
  await repo.createCredential({ deviceId: "FG-SENSOR-001", token, label: "primary" });
  const who = await repo.authenticateDeviceToken(token);
  console.log("authenticateDeviceToken:", who);
  if (who !== "FG-SENSOR-001") throw new Error("device auth failed");

  const gatewayToken = generateToken("fggw");
  await repo.createCredential({ gatewayId: "FG-GATEWAY-002", token: gatewayToken, label: "primary" });
  if ((await repo.authenticateGatewayToken(gatewayToken)) !== "FG-GATEWAY-002") {
    throw new Error("gateway auth failed");
  }
  if ((await repo.authenticateDeviceToken(gatewayToken)) !== null) {
    throw new Error("a gateway token must not resolve to a sensor");
  }

  const payload = {
    device_id: "FG-SENSOR-001",
    gateway_id: "FG-GATEWAY-002",
    raw_sensor_value: 812,
    calibrated_water_level_cm: null,
    water_flow_lpm: 42,
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
  } as const;

  const first = await ingestReading(payload as never, {
    authenticatedDeviceId: "FG-SENSOR-001",
  });
  console.log("first:", first.status, JSON.stringify(first));

  const second = await ingestReading(payload as never, {
    authenticatedDeviceId: "FG-SENSOR-001",
  });
  console.log("repeat:", second.status);
  if (second.status !== "duplicate") throw new Error("dedupe failed");

  const mismatch = await ingestReading(payload as never, {
    authenticatedDeviceId: "FG-SENSOR-999",
  });
  console.log("mismatch:", mismatch.status);

  await repo.setDeviceCalibration("FG-SENSOR-001", {
    zeroRaw: 200,
    spanRaw: 1000,
    referenceCm: 40,
    verified: true,
  });
  const high = await ingestReading(
    { ...payload, raw_sensor_value: 900, packet_sequence: 2, device_timestamp_ms: Date.now() } as never,
    { authenticatedDeviceId: "FG-SENSOR-001" },
  );
  console.log("calibrated:", JSON.stringify(high));

  const latest = await repo.latestReadingsByDevice();
  console.log("latest count:", latest.size);

  const { listDevices, listZones, getThresholds } = repo;
  const { buildSnapshots, summarizeZones } = await import(
    "../src/lib/services/monitoring"
  );
  const snapshots = buildSnapshots(
    await listDevices(),
    latest,
    await listZones(),
    await getThresholds(),
  );
  console.log("snapshot:", JSON.stringify(snapshots[0], null, 1).slice(0, 700));
  console.log("zones:", JSON.stringify(summarizeZones(await listZones(), snapshots)));

  await repo.setHealthWindow({ staleAfterMinutes: 1, offlineAfterMinutes: 1 });
  console.log("sweep:", JSON.stringify(await sweepHealth(new Date(Date.now() + 3_600_000))));

  await repo.createAdmin({
    email: "admin@example.org",
    name: "Test admin",
    passwordHash: hashPassword("correct horse battery"),
  });
  const admin = await repo.getAdminByEmail("ADMIN@example.org");
  console.log("admin:", admin?.email, admin?.adminId);
  console.log("alerts:", (await repo.listAlerts({ limit: 10 })).length);

  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
