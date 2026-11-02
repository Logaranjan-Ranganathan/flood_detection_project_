import {
  ensureGatewayRegistered,
  getDeviceRow,
  getGateway,
  getHealthWindow,
  getThresholds,
  insertReading,
  latestReadingForDevice,
  listGateways,
  markDeviceSeen,
  noteGatewayPacket,
  raiseAlert,
  devicesNotSeenSince,
  recordGatewayStatus,
} from "@/db/repo";
import { calibrateRawToCm, classifyLevel, isPlausibleWaterLevel } from "../calibration";
import { buildDedupeKey } from "../health";
import { STATUS_LABELS, type DataQuality, type Thresholds } from "../status";
import { GATEWAY_OFFLINE_AFTER_MINUTES } from "./monitoring";
import type { GatewayStatusPayload, ReadingPayload } from "../schemas";

export type IngestOutcome =
  | {
      status: "accepted";
      deviceId: string;
      rawSensorValue: number;
      calibratedWaterLevelCm: number | null;
      waterFlowLpm: number | null;
      floodStatus: string;
      dataQuality: DataQuality;
      receivedAt: Date;
      duplicate: false;
      alertsRaised: string[];
    }
  | {
      status: "duplicate";
      deviceId: string;
      dedupeKey: string;
      duplicate: true;
    }
  | {
      status: "rejected";
      code:
        | "unknown_device"
        | "device_mismatch"
        | "out_of_range"
        | "invalid_payload";
      message: string;
      duplicate: false;
    };

function mergeThresholds(
  global: Thresholds,
  override: Partial<Thresholds> | null | undefined,
): Thresholds {
  if (!override) return global;
  const pick = (k: keyof Thresholds) =>
    typeof override[k] === "number" ? override[k]! : global[k];
  return {
    watchCm: pick("watchCm"),
    warningCm: pick("warningCm"),
    criticalCm: pick("criticalCm"),
  };
}

/** Hour bucket so a sustained level condition raises one alert, not one per packet. */
function hourBucket(at: Date): number {
  return Math.floor(at.getTime() / 3_600_000);
}

/**
 * Identifies one communication outage: the last time we heard from the device.
 * Keying health alerts on this rather than on the sweep clock means a device
 * that stays silent gets exactly one alert, and re-alerts only when it reports
 * again and then goes quiet.
 */
function outageBucket(lastSeenAt: Date | null): string {
  return lastSeenAt ? String(Math.floor(lastSeenAt.getTime() / 60_000)) : "never";
}

/**
 * Store one authenticated sensor packet.
 *
 * The server is authoritative for the calibrated level and the flood
 * classification: it recomputes both from the raw count using the calibration
 * and thresholds held in the database, so a device cannot talk itself into a
 * different severity, and a mis-labelled firmware value cannot reach the map.
 */
export async function ingestReading(
  payload: ReadingPayload,
  opts: { authenticatedDeviceId: string; receivedAt?: Date },
): Promise<IngestOutcome> {
  const receivedAt = opts.receivedAt ?? new Date();

  if (opts.authenticatedDeviceId !== payload.device_id) {
    return {
      status: "rejected",
      code: "device_mismatch",
      message: "Device token is not valid for the reported device_id",
      duplicate: false,
    };
  }

  const device = await getDeviceRow(payload.device_id);
  if (!device) {
    return {
      status: "rejected",
      code: "unknown_device",
      message: "Sensor is not registered. Register it in the admin console first.",
      duplicate: false,
    };
  }

  // Unknown gateways are enrolled automatically so bring-up works, but they are
  // flagged so an admin confirms where the box actually sits.
  await ensureGatewayRegistered(payload.gateway_id);

  const calibrated = device.calibrationVerified
    ? calibrateRawToCm(payload.raw_sensor_value, {
        zeroRaw: device.calibZeroRaw,
        spanRaw: device.calibSpanRaw,
        referenceCm: device.calibReferenceCm,
        verified: device.calibrationVerified,
      })
    : null;

  if (calibrated !== null && !isPlausibleWaterLevel(calibrated)) {
    return {
      status: "rejected",
      code: "out_of_range",
      message: "Calibrated water level is implausible for this calibration",
      duplicate: false,
    };
  }

  const thresholds = mergeThresholds(await getThresholds(), device.thresholdsOverride as Partial<Thresholds> | null);
  const floodStatus = classifyLevel(calibrated, thresholds);

  const qualityNotes: DataQuality[] = [];

  // Flow can only be stored for a device that really has a flow sensor.
  const flow = device.flowSupported ? payload.water_flow_lpm : null;
  if (!device.flowSupported && payload.water_flow_lpm !== null) {
    qualityNotes.push("FLOW_NOT_SUPPORTED");
  }

  // Coordinates come from the *registered* device record. A sensor that ships
  // the gateway's GPS position must not silently inherit it.
  const deviceLocated =
    device.locationVerified &&
    device.latitude !== null &&
    device.longitude !== null;
  const latitude = deviceLocated ? device.latitude : null;
  const longitude = deviceLocated ? device.longitude : null;
  if (!deviceLocated) qualityNotes.push("LOCATION_UNAVAILABLE");

  if (!device.calibrationVerified) qualityNotes.push("UNCALIBRATED");

  const dataQuality: DataQuality = !device.calibrationVerified
    ? "UNCALIBRATED"
    : qualityNotes.includes("LOCATION_UNAVAILABLE")
      ? "LOCATION_UNAVAILABLE"
      : qualityNotes.includes("FLOW_NOT_SUPPORTED")
        ? "FLOW_NOT_SUPPORTED"
        : "OK";

  const deviceReportedAt = payload.device_timestamp_ms
    ? new Date(payload.device_timestamp_ms)
    : null;

  const dedupeKey = buildDedupeKey({
    deviceId: payload.device_id,
    packetSequence: payload.packet_sequence,
    deviceReportedAt,
    receivedAt,
  });

  // Read the previous state *before* storing, otherwise the new packet becomes
  // its own predecessor and an escalation is never detected.
  const previous = await latestReadingForDevice(payload.device_id);

  const inserted = await insertReading({
    deviceId: payload.device_id,
    gatewayId: payload.gateway_id,
    rawSensorValue: payload.raw_sensor_value,
    calibratedWaterLevelCm: calibrated,
    waterFlowLpm: flow,
    floodStatus,
    dataQuality,
    latitude,
    longitude,
    batteryVoltage: payload.battery_voltage,
    loraRssi: payload.lora_rssi,
    loraSnr: payload.lora_snr,
    packetSequence: payload.packet_sequence,
    firmwareVersion: payload.firmware_version,
    simulated: payload.simulated,
    deviceReportedAt,
    dedupeKey,
    receivedAt,
  });

  if (!inserted) {
    return { status: "duplicate", deviceId: payload.device_id, dedupeKey, duplicate: true };
  }

  await markDeviceSeen({
    deviceId: payload.device_id,
    at: receivedAt,
    loraRssi: payload.lora_rssi,
    loraSnr: payload.lora_snr,
    batteryVoltage: payload.battery_voltage,
    firmwareVersion: payload.firmware_version,
  });
  await noteGatewayPacket({
    gatewayId: payload.gateway_id,
    at: receivedAt,
    loraRssi: payload.lora_rssi,
    loraSnr: payload.lora_snr,
  });

  const alertsRaised: string[] = [];
  const previousLevel = previous?.floodStatus ?? "NORMAL";

  const escalated =
    (floodStatus === "WARNING" && previousLevel !== "WARNING" && previousLevel !== "CRITICAL") ||
    (floodStatus === "CRITICAL" && previousLevel !== "CRITICAL");

  if (escalated) {
    const created = await raiseAlert({
      alertType: floodStatus,
      severity: floodStatus,
      deviceId: payload.device_id,
      zoneId: device.zoneId,
      gatewayId: payload.gateway_id,
      message:
        calibrated === null
          ? `${payload.device_id} reported ${STATUS_LABELS[floodStatus]}`
          : `${device.label} is at ${calibrated} cm (${STATUS_LABELS[floodStatus]})`,
      waterLevelCm: calibrated,
      dedupeKey: `level:${payload.device_id}:${floodStatus}:${hourBucket(receivedAt)}`,
    });
    if (created) alertsRaised.push(floodStatus);
  }

  if (!device.calibrationVerified) {
    const created = await raiseAlert({
      alertType: "CALIBRATION_REQUIRED",
      severity: "INFO",
      deviceId: payload.device_id,
      zoneId: device.zoneId,
      message: `${device.label} is reporting raw values only — calibration required.`,
      dedupeKey: `calib:${payload.device_id}:${Math.floor(receivedAt.getTime() / 86_400_000)}`,
    });
    if (created) alertsRaised.push("CALIBRATION_REQUIRED");
  }

  return {
    status: "accepted",
    deviceId: payload.device_id,
    rawSensorValue: payload.raw_sensor_value,
    calibratedWaterLevelCm: calibrated,
    waterFlowLpm: flow,
    floodStatus,
    dataQuality,
    receivedAt,
    duplicate: false,
    alertsRaised,
  };
}

export interface SweepResult {
  staleDevices: string[];
  offlineDevices: string[];
  offlineGateways: string[];
  alertsRaised: number;
}

/**
 * Raise offline / stale-data alerts for devices that stopped talking.
 * One alert per outage per device, so a dead sensor does not spam the board.
 */
export async function sweepHealth(now: Date = new Date()): Promise<SweepResult> {
  const window = await getHealthWindow();
  const staleCutoff = new Date(now.getTime() - window.staleAfterMinutes * 60_000);
  const offlineCutoff = new Date(now.getTime() - window.offlineAfterMinutes * 60_000);

  const [staleCandidates, offlineCandidates] = await Promise.all([
    devicesNotSeenSince(staleCutoff),
    devicesNotSeenSince(offlineCutoff),
  ]);

  const offlineDevices: string[] = [];
  const staleDevices: string[] = [];
  let alertsRaised = 0;

  for (const device of offlineCandidates) {
    offlineDevices.push(device.deviceId);
    const created = await raiseAlert({
      alertType: "SENSOR_OFFLINE",
      severity: "WARNING",
      deviceId: device.deviceId,
      zoneId: device.zoneId,
      gatewayId: device.gatewayId,
      message: `${device.label} has not reported for over ${window.offlineAfterMinutes} minutes.`,
      dedupeKey: `offline:${device.deviceId}:${outageBucket(device.lastSeenAt)}`,
    });
    if (created) alertsRaised += 1;
  }

  for (const device of staleCandidates) {
    if (offlineDevices.includes(device.deviceId)) continue;
    staleDevices.push(device.deviceId);
    const created = await raiseAlert({
      alertType: "DATA_STALE",
      severity: "INFO",
      deviceId: device.deviceId,
      zoneId: device.zoneId,
      gatewayId: device.gatewayId,
      message: `${device.label} data is older than ${window.staleAfterMinutes} minutes and should not be treated as current.`,
      dedupeKey: `stale:${device.deviceId}:${outageBucket(device.lastSeenAt)}`,
    });
    if (created) alertsRaised += 1;
  }

  const gateways = await listGateways();
  const offlineGateways: string[] = [];
  for (const gw of gateways) {
    if (gw.lastSeenAt && now.getTime() - gw.lastSeenAt.getTime() <= GATEWAY_OFFLINE_AFTER_MINUTES * 60_000) {
      continue;
    }
    offlineGateways.push(gw.gatewayId);
    const created = await raiseAlert({
      alertType: "GATEWAY_OFFLINE",
      severity: "WARNING",
      gatewayId: gw.gatewayId,
      message: `${gw.name} has not reported for over ${GATEWAY_OFFLINE_AFTER_MINUTES} minutes. The map cannot be refreshed while the gateway is down.`,
      dedupeKey: `gateway-offline:${gw.gatewayId}:${outageBucket(gw.lastSeenAt)}`,
    });
    if (created) alertsRaised += 1;
  }

  return { staleDevices, offlineDevices, offlineGateways, alertsRaised };
}

export interface GatewayOutcome {
  status: "accepted" | "rejected";
  code?: string;
  message?: string;
}

/** Diagnostic heartbeat (ESP32-2 style) — never used as an identity check. */
export async function ingestGatewayStatus(
  payload: GatewayStatusPayload,
  opts: { authenticatedGatewayId?: string | null; receivedAt?: Date },
): Promise<GatewayOutcome> {
  if (opts.authenticatedGatewayId && opts.authenticatedGatewayId !== payload.gateway_id) {
    return {
      status: "rejected",
      code: "gateway_mismatch",
      message: "Credential is not valid for the reported gateway_id",
    };
  }
  const receivedAt = opts.receivedAt ?? new Date();
  const registered = await getGateway(payload.gateway_id);
  if (!registered) {
    return {
      status: "rejected",
      code: "unknown_gateway",
      message: "Gateway is not registered. Register it in the admin console first.",
    };
  }
  await recordGatewayStatus({
    gatewayId: payload.gateway_id,
    at: receivedAt,
    firmwareVersion: payload.firmware_version,
    ipAddress: payload.ip_address,
    latitude: payload.gps_fix ? payload.latitude : null,
    longitude: payload.gps_fix ? payload.longitude : null,
    gpsFix: payload.gps_fix,
    loraRssi: payload.lora_rssi,
    loraSnr: payload.lora_snr,
    batteryMv: payload.battery_mv,
    packetsReceived: payload.packets_received,
    networkStatus: payload.network_status,
  });
  return { status: "accepted" };
}
