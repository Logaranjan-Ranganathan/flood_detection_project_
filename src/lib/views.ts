import type {
  DataQuality,
  EffectiveStatus,
  HealthStatus,
  LevelStatus,
  Thresholds,
} from "./status";

export interface LatestReadingView {
  deviceId: string;
  rawSensorValue: number;
  calibratedWaterLevelCm: number | null;
  waterFlowLpm: number | null;
  floodStatus: LevelStatus;
  dataQuality: DataQuality;
  receivedAt: Date;
  deviceReportedAt: Date | null;
  batteryVoltage: number | null;
  loraRssi: number | null;
  loraSnr: number | null;
  packetSequence: number | null;
  firmwareVersion: string | null;
  simulated: boolean;
}

export interface DeviceView {
  deviceId: string;
  label: string;
  gatewayId: string | null;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  locationVerified: boolean;
  locationSource: string;
  calibrationVerified: boolean;
  flowSupported: boolean;
  thresholdsOverride: Partial<Thresholds> | null;
  lastSeenAt: Date | null;
  firmwareVersion: string | null;
}

export interface ZoneView {
  zoneId: string;
  name: string;
  centerLatitude: number;
  centerLongitude: number;
  radiusMeters: number;
  localityNote: string | null;
}

export interface GatewayView {
  gatewayId: string;
  name: string;
  firmwareVersion: string | null;
  lastSeenAt: Date | null;
  lastReportedIp: string | null;
  networkStatus: string;
  latitude: number | null;
  longitude: number | null;
  gpsFix: boolean | null;
  lastLoraRssi: number | null;
  lastLoraSnr: number | null;
  batteryMv: number | null;
  packetsReceived: number;
  hardwareNote: string | null;
}

/** Everything the UI shows for one sensor, derived from stored rows only. */
export interface DeviceSnapshot extends DeviceView {
  levelStatus: LevelStatus;
  healthStatus: HealthStatus;
  effectiveStatus: EffectiveStatus;
  lastReading: LatestReadingView | null;
  ageMinutes: number | null;
  hasLocation: boolean;
  /** Zone ids whose 50 m circle contains this device. */
  zoneIds: string[];
  flowValue: number | null;
  flowIsEstimated: false;
  notices: string[];
}

export interface ZoneSummary extends ZoneView {
  deviceIds: string[];
  deviceCount: number;
  highestStatus: EffectiveStatus | "NO_DATA";
  highestLevelCm: number | null;
  latestLevelCm: number | null;
  lastUpdate: Date | null;
  hasAnyCalibratedData: boolean;
  hasFlowData: boolean;
  containsSimulatedOnly: boolean;
}
