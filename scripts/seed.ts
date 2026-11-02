/**
 * Development demo data.
 *
 * Everything this writes is flagged `simulated = true`, and it refuses to run
 * against a database that already holds real measurements. Simulated readings
 * are rendered with a SIMULATED badge everywhere in the UI and are excluded
 * from any claim about an actual flood.
 */
import "./load-env";
import { closeDb, getDb } from "../src/db/client";
import {
  countAdmins,
  createAdmin,
  createCredential,
  getThresholds,
  insertReading,
  listCredentials,
  listDevices,
  markDeviceSeen,
  raiseAlert,
  recordGatewayStatus,
  setDeviceCalibration,
  upsertDevice,
  upsertGateway,
  upsertZone,
} from "../src/db/repo";
import { generateToken, hashPassword } from "../src/lib/auth";
import { classifyLevel, calibrateRawToCm } from "../src/lib/calibration";
import { buildDedupeKey } from "../src/lib/health";
import { sql } from "drizzle-orm";
import { sensorReadings } from "../src/db/schema";

const GATEWAY_ID = "FG-GATEWAY-002";

const ZONES = [
  {
    zoneId: "FG-ZONE-001",
    name: "Mahaweli canal bridge",
    centerLatitude: 6.9271,
    centerLongitude: 79.8612,
    localityNote: "Demo monitoring point — not an official ward boundary",
  },
  {
    zoneId: "FG-ZONE-002",
    name: "Kolonnawa outfall",
    centerLatitude: 6.9387,
    centerLongitude: 79.8731,
    localityNote: "Demo monitoring point — not an official ward boundary",
  },
  {
    zoneId: "FG-ZONE-003",
    name: "Attidiya drain culvert",
    centerLatitude: 6.9006,
    centerLongitude: 79.8558,
    localityNote: "Demo monitoring point — not an official ward boundary",
  },
];

interface SeedDevice {
  deviceId: string;
  label: string;
  zoneId: string;
  latitude: number | null;
  longitude: number | null;
  locationVerified: boolean;
  calibrated: boolean;
  flowSupported: boolean;
  /** Starting water level in cm for the generated series. */
  baseCm: number;
  trendCm: number;
  /** Minutes since the last packet — simulates an offline node. */
  silenceMinutes: number;
  batteryVoltage: number;
}

const DEVICES: SeedDevice[] = [
  { deviceId: "FG-SENSOR-001", label: "Canal bridge — upstream", zoneId: "FG-ZONE-001", latitude: 6.9273, longitude: 79.8615, locationVerified: true, calibrated: true, flowSupported: false, baseCm: 9, trendCm: 26, silenceMinutes: 1, batteryVoltage: 3.92 },
  { deviceId: "FG-SENSOR-002", label: "Canal bridge — downstream", zoneId: "FG-ZONE-001", latitude: 6.9269, longitude: 79.8609, locationVerified: true, calibrated: true, flowSupported: false, baseCm: 12, trendCm: 40, silenceMinutes: 2, batteryVoltage: 3.87 },
  { deviceId: "FG-SENSOR-003", label: "Kolonnawa outfall", zoneId: "FG-ZONE-002", latitude: 6.9385, longitude: 79.8734, locationVerified: true, calibrated: true, flowSupported: true, baseCm: 6, trendCm: 14, silenceMinutes: 1, batteryVoltage: 4.01 },
  { deviceId: "FG-SENSOR-004", label: "Attidiya culvert", zoneId: "FG-ZONE-003", latitude: 6.9008, longitude: 79.8556, locationVerified: true, calibrated: false, flowSupported: false, baseCm: 0, trendCm: 0, silenceMinutes: 3, batteryVoltage: 3.76 },
  { deviceId: "FG-SENSOR-005", label: "Unplaced test node", zoneId: "FG-ZONE-003", latitude: null, longitude: null, locationVerified: false, calibrated: true, flowSupported: false, baseCm: 4, trendCm: 8, silenceMinutes: 260, batteryVoltage: 3.41 },
];

const RAW_ZERO = 180;
const RAW_SPAN = 1020;
const RAW_REF_CM = 60;

function rawForCm(cm: number): number {
  return Math.round(RAW_ZERO + (cm * (RAW_SPAN - RAW_ZERO)) / RAW_REF_CM);
}

function jitter(seed: number): number {
  // Deterministic pseudo-noise so repeated seeding looks the same.
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2.4 - 1.2;
}

async function main() {
  const db = await getDb();

  const real = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(sensorReadings)
    .where(sql`${sensorReadings.simulated} = false`);
  if (Number(real[0]?.c ?? 0) > 0 && !process.argv.includes("--force")) {
    console.error(
      "Refusing to seed: this database already contains real (non-simulated) readings.\n" +
        "Use --force only if you understand the demo rows will be clearly flagged as SIMULATED.",
    );
    process.exit(1);
  }

  await upsertGateway({
    gatewayId: GATEWAY_ID,
    name: "ESP32-2 gateway",
    firmwareVersion: "1.0.0",
    hardwareNote:
      "ESP32-2 + SX1278 LoRa 433 MHz receiver + SIM800L GPRS + NEO-6M GPS",
  });

  const gatewayCreds = await listCredentials({ gatewayId: GATEWAY_ID });
  let gatewayToken: string | null = null;
  if (gatewayCreds.filter((c) => !c.revokedAt).length === 0) {
    gatewayToken = generateToken("fggw");
    await createCredential({
      gatewayId: GATEWAY_ID,
      token: gatewayToken,
      label: "seed",
    });
  }

  await db
    .update(sensorReadings)
    .set({ gatewayId: GATEWAY_ID })
    .where(sql`true`);

  for (const zone of ZONES) {
    await upsertZone({
      zoneId: zone.zoneId,
      name: zone.name,
      centerLatitude: zone.centerLatitude,
      centerLongitude: zone.centerLongitude,
      radiusMeters: 50,
      localityNote: zone.localityNote,
    });
  }

  const thresholds = await getThresholds();
  const tokens: { deviceId: string; token: string }[] = [];
  const now = new Date();
  const seriesMinutes = 12 * 60;
  const stepMinutes = 10;

  for (const device of DEVICES) {
    await upsertDevice({
      deviceId: device.deviceId,
      label: device.label,
      gatewayId: GATEWAY_ID,
      zoneId: device.zoneId,
      latitude: device.latitude,
      longitude: device.longitude,
      locationVerified: device.locationVerified,
      locationSource: device.locationVerified ? "MANUAL" : "UNVERIFIED",
      flowSupported: device.flowSupported,
      firmwareVersion: "1.0.0",
    });

    if (device.calibrated) {
      await setDeviceCalibration(device.deviceId, {
        zeroRaw: RAW_ZERO,
        spanRaw: RAW_SPAN,
        referenceCm: RAW_REF_CM,
        verified: true,
      });
    }

    const existing = await listCredentials({ deviceId: device.deviceId });
    if (existing.filter((c) => !c.revokedAt).length === 0) {
      const token = generateToken("fgdev");
      await createCredential({ deviceId: device.deviceId, token, label: "seed" });
      tokens.push({ deviceId: device.deviceId, token });
    }

    const lastPacket = new Date(
      now.getTime() - device.silenceMinutes * 60_000,
    );
    const steps = Math.max(1, Math.floor(seriesMinutes / stepMinutes));

    for (let i = 0; i < steps; i += 1) {
      const progress = i / (steps - 1 || 1);
      const cm = Math.max(
        0,
        device.baseCm + device.trendCm * progress + jitter(i + device.deviceId.length),
      );
      const raw = device.calibrated ? rawForCm(cm) : Math.round(200 + cm * 8 + jitter(i) * 30);
      const receivedAt = new Date(
        lastPacket.getTime() - (steps - 1 - i) * stepMinutes * 60_000,
      );
      const calibrated = device.calibrated
        ? calibrateRawToCm(raw, {
            zeroRaw: RAW_ZERO,
            spanRaw: RAW_SPAN,
            referenceCm: RAW_REF_CM,
            verified: true,
          })
        : null;

      await insertReading({
        deviceId: device.deviceId,
        gatewayId: GATEWAY_ID,
        rawSensorValue: raw,
        calibratedWaterLevelCm: calibrated,
        waterFlowLpm: device.flowSupported && cm > 4 ? Math.round(cm * 3.2) : null,
        floodStatus: classifyLevel(calibrated, thresholds),
        dataQuality: device.calibrated ? "OK" : "UNCALIBRATED",
        latitude: device.locationVerified ? device.latitude : null,
        longitude: device.locationVerified ? device.longitude : null,
        batteryVoltage: device.batteryVoltage,
        loraRssi: -78 - (i % 12),
        loraSnr: 8 + (i % 3) * 0.4,
        packetSequence: 10_000 + i,
        firmwareVersion: "1.0.0",
        simulated: true,
        deviceReportedAt: receivedAt,
        receivedAt,
        dedupeKey: buildDedupeKey({
          deviceId: device.deviceId,
          packetSequence: 10_000 + i,
          deviceReportedAt: receivedAt,
          receivedAt,
        }),
      });
    }

    /*
      The device must look as fresh as the series it just received. Without this the
      demo showed twelve hours of history beside "last report: never" and every sensor
      flagged offline, which is the opposite of the mix these rows are meant to show.
    */
    const last = steps - 1;
    await markDeviceSeen({
      deviceId: device.deviceId,
      at: lastPacket,
      loraRssi: -78 - (last % 12),
      loraSnr: 8 + (last % 3) * 0.4,
      batteryVoltage: device.batteryVoltage,
      firmwareVersion: "1.0.0",
    });
  }

  await recordGatewayStatus({
    gatewayId: GATEWAY_ID,
    at: new Date(now.getTime() - 60_000),
    firmwareVersion: "1.0.0",
    ipAddress: "10.10.4.21",
    latitude: 6.9271,
    longitude: 79.8612,
    gpsFix: true,
    loraRssi: -88,
    batteryMv: 4090,
    packetsReceived: 4820,
    networkStatus: "ONLINE",
  });

  // One alert so the alerts page is not empty on a fresh install.
  await raiseAlert({
    alertType: "CALIBRATION_REQUIRED",
    severity: "INFO",
    deviceId: "FG-SENSOR-004",
    zoneId: "FG-ZONE-003",
    message:
      "Attidiya culvert is reporting raw values only — calibration required.",
    dedupeKey: `seed:calib:FG-SENSOR-004:${now.getUTCFullYear()}`,
  });

  const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@floodguard.local";
  const password =
    process.env.SEED_ADMIN_PASSWORD?.trim() || generateToken("dev").replace("dev_", "");

  if ((await countAdmins()) === 0) {
    await createAdmin({
      email,
      name: "FloodGuard administrator",
      passwordHash: hashPassword(password),
    });
  } else {
    console.log("Admin already exists — leaving accounts untouched.");
  }

  const devices = await listDevices();
  console.log(`\nSeeded ${devices.length} sensors, ${ZONES.length} zones, 1 gateway.`);
  console.log("All seeded readings are marked SIMULATED and are never shown as real flood data.\n");

  if (tokens.length) {
    console.log("Sensor tokens (shown once — keep them out of Git):");
    for (const t of tokens) console.log(`  ${t.deviceId}  ${t.token}`);
    console.log("");
  }

  if (gatewayToken) {
    console.log("Gateway token for ESP32-2 heartbeat uploads (shown once):");
    console.log(`  ${GATEWAY_ID}  ${gatewayToken}`);
    console.log("");
  }

  if (process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Admin login: ${email} (password from SEED_ADMIN_PASSWORD)`);
  } else if ((await countAdmins()) === 1) {
    console.log(`Admin login: ${email}`);
    console.log(`Admin password (generated, not stored anywhere): ${password}`);
  }

  await closeDb();
}

main().then(async () => {
  console.log("SEED OK");
  process.exit(0);
}).catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
